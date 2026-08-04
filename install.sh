#!/usr/bin/env bash
#
# install.sh — install the agent-setup baseline into a Claude Code configuration.
#
# This script resolves ONE thing — which config dir to write to — and then hands
# every actual decision to a module under installers/:
#
#   onboarding the /run-agent-setup command, and nothing else                (warn only)
#   prereqs    bun and Homebrew                                    (FATAL)
#   security   four credential hooks, 2 skills, /security-scan     (FATAL)
#   rtk        the token-compacting CLI proxy                      (warn only)
#   herdr      one terminal for every agent                        (warn only)
#   plugins    caveman and code-review                             (warn only)
#   skills     the seven workflow skills                           (warn only)
#
# A failure in `security` stops the install: it is the only module that protects
# anything, and a machine that thinks it has guardrails but does not is worse off
# than one that knows it has none. The rest are conveniences — someone with no
# Homebrew, or no network, should still end up protected.
#
# THIS SCRIPT IS THE ONLY THING THAT WRITES. The normal path to it is /run-agent-setup,
# which explains each module and asks before invoking `--only <module>` here.
# That command narrates and verifies; it never installs anything itself, so
# there is exactly one implementation of every change. Running this script
# directly, with --yes, is the unattended path — CI and re-installs use it.
#
#   ./install.sh                     install or update everything
#   ./install.sh --config-dir PATH   install into a specific config dir
#   ./install.sh --settings-file F   register hooks in a specific settings file
#   ./install.sh --only security     run just these modules (comma-separated)
#   ./install.sh --skip rtk,plugins  run everything except these
#   ./install.sh --check             report what is installed and whether it drifted
#   ./install.sh --uninstall         remove every link, hook entry and plugin
#   ./install.sh --dry-run           print the plan, change nothing
#   ./install.sh --force             replace a conflicting file or foreign symlink
#   ./install.sh --yes               skip the confirmation prompt (for automation)
#
# TARGET CONFIG DIR — resolved in this order, first match wins:
#   1. --config-dir PATH      explicit, always trusted, never warns
#   2. $CLAUDE_CONFIG_DIR     Claude Code's own override, if exported
#   3. $HOME/.claude          the default
#
# <config-dir>/settings.json is ALWAYS written — it is the file Claude Code
# reads, so nothing is enforced without it. --settings-file adds a SECOND write.
#
# It exists for generated settings: if a SessionStart hook rebuilds settings.json
# from sources, entries in the output are erased on the next start UNLESS the
# generator also back-propagates output edits into its source. A generator that
# runs a backport step before its merge is durable under a plain install; one
# without that step needs --settings-file pointed at its source. The installer
# flags the generated shape but cannot tell which case it is, so it asks you to
# verify with --check after a fresh session.
#
# Every mode takes --config-dir, and it must be the SAME value across install,
# --check, and --uninstall — otherwise you are inspecting or removing a different
# installation than the one you made. The resolved dir and its source are always
# printed, because a baseline registered in a config dir the session never reads
# looks installed and protects nothing, which is the worst failure a security
# control can have.
#
# EXIT: 0 ok · 1 problem · 2 usage error
set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_CLAUDE="$REPO_DIR/.claude"
DEFAULT_ROOT="$HOME/.claude"

# Order matters. onboarding is first because bootstrap.sh runs it alone, before
# anything has been consented to. prereqs installs the toolchain the rest of the
# list needs, so everything after it can assume bun exists.
ALL_MODULES="onboarding prereqs security rtk herdr plugins skills"
# Load-bearing modules, listed rather than inferred, so promoting one is a
# deliberate edit. prereqs is fatal because bun executes every hook; security is
# fatal because it is the thing this repo exists for.
FATAL_MODULES="prereqs security"
# Modules that run without bun. This is not an optimisation — onboarding is
# invoked by bootstrap.sh on a machine where bun does not exist yet, because
# installing bun is part of what the user has not agreed to at that point. Gate
# on this list, never on `!= prereqs`: that spelling made `--only onboarding`
# exit 1 on exactly the fresh machine the entry point is written for.
BUNLESS_MODULES="prereqs onboarding"
# Modules that symlink through <config-dir>/agent-setup. The link is shared, so
# no single module may tear it down — see the uninstall block.
LINKING_MODULES="onboarding security skills"

MODE="install"
DRY_RUN=0
FORCE=0
ASSUME_YES=0
CONFIG_DIR_ARG=""
SETTINGS_FILE_ARG=""
ONLY_ARG=""
SKIP_ARG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) MODE="check" ;;
    --uninstall) MODE="uninstall" ;;
    --dry-run) DRY_RUN=1 ;;
    --force) FORCE=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    --config-dir)
      shift
      if [[ $# -eq 0 || -z "${1:-}" || "${1:-}" == --* ]]; then
        printf 'install.sh: --config-dir needs a path\n' >&2; exit 2
      fi
      CONFIG_DIR_ARG="$1"
      ;;
    --config-dir=*) CONFIG_DIR_ARG="${1#--config-dir=}" ;;
    --settings-file)
      shift
      if [[ $# -eq 0 || -z "${1:-}" || "${1:-}" == --* ]]; then
        printf 'install.sh: --settings-file needs a path\n' >&2; exit 2
      fi
      SETTINGS_FILE_ARG="$1"
      ;;
    --settings-file=*) SETTINGS_FILE_ARG="${1#--settings-file=}" ;;
    --only)
      shift
      if [[ $# -eq 0 || -z "${1:-}" || "${1:-}" == --* ]]; then
        printf 'install.sh: --only needs a module list\n' >&2; exit 2
      fi
      ONLY_ARG="$1"
      ;;
    --only=*) ONLY_ARG="${1#--only=}" ;;
    --skip)
      shift
      if [[ $# -eq 0 || -z "${1:-}" || "${1:-}" == --* ]]; then
        printf 'install.sh: --skip needs a module list\n' >&2; exit 2
      fi
      SKIP_ARG="$1"
      ;;
    --skip=*) SKIP_ARG="${1#--skip=}" ;;
    # Range ends at the last line of the header block. Growing the header without
    # moving this silently truncates --help — it dropped the EXIT line once already.
    -h|--help) sed -n '3,51p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) printf 'install.sh: unknown argument: %s (try --help)\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

# ── which modules run ────────────────────────────────────────────────────────
list_has() { case " $1 " in *" $2 "*) return 0 ;; *) return 1 ;; esac }

MODULES=""
for m in $ALL_MODULES; do
  if [[ -n "$ONLY_ARG" ]] && ! list_has "${ONLY_ARG//,/ }" "$m"; then continue; fi
  if [[ -n "$SKIP_ARG" ]] && list_has "${SKIP_ARG//,/ }" "$m"; then continue; fi
  MODULES="$MODULES $m"
done
MODULES="${MODULES# }"

for m in ${ONLY_ARG//,/ } ${SKIP_ARG//,/ }; do
  list_has "$ALL_MODULES" "$m" || {
    printf 'install.sh: unknown module: %s (known: %s)\n' "$m" "$ALL_MODULES" >&2; exit 2
  }
done

if [[ -z "$MODULES" ]]; then
  printf 'install.sh: --only/--skip selected no modules\n' >&2; exit 2
fi

# The check battery drives bootstrap.sh, which ends here. Pinned to onboarding
# because that is what bootstrap.sh now runs, and because it is the only module
# that touches nothing global: rtk, herdr and plugins all reach the network and
# mutate machine state, so a self-test running them would brew-install and hit
# the plugin registry on every `bun check`. Belt and braces — bootstrap already
# passes --only onboarding — for anyone invoking install.sh with this exported.
if [[ -n "${AGENT_SETUP_BOOTSTRAP_SELFTEST:-}" ]]; then
  MODULES="onboarding"
fi

# ── resolve the target config dir ────────────────────────────────────────────
if [[ -n "$CONFIG_DIR_ARG" ]]; then
  DEST_ROOT="$CONFIG_DIR_ARG"
  DEST_SOURCE="--config-dir"
elif [[ -n "${CLAUDE_CONFIG_DIR:-}" ]]; then
  DEST_ROOT="$CLAUDE_CONFIG_DIR"
  DEST_SOURCE="\$CLAUDE_CONFIG_DIR"
else
  DEST_ROOT="$DEFAULT_ROOT"
  DEST_SOURCE="default"
fi

# Expand a leading ~ and make the path absolute, so every later comparison and
# every symlink target is unambiguous regardless of the caller's cwd.
# SC2088 is the point here, not a mistake: a quoted `--config-dir '~/.claude'`
# arrives as a literal tilde the shell never expanded, and this is what expands it.
# shellcheck disable=SC2088
case "$DEST_ROOT" in
  "~") DEST_ROOT="$HOME" ;;
  "~/"*) DEST_ROOT="$HOME/${DEST_ROOT#\~/}" ;;
esac
if [[ "$DEST_ROOT" != /* ]]; then DEST_ROOT="$PWD/$DEST_ROOT"; fi
# Collapse `/./` and duplicate slashes so the printed target and every symlink
# target are the same string a later --check will compute. `realpath` is not
# usable here: the dir may not exist yet.
while [[ "$DEST_ROOT" == *"/./"* ]]; do DEST_ROOT="${DEST_ROOT//\/.\///}"; done
while [[ "$DEST_ROOT" == *"//"* ]]; do DEST_ROOT="${DEST_ROOT//\/\///}"; done
DEST_ROOT="${DEST_ROOT%/.}"
DEST_ROOT="${DEST_ROOT%/}"

if [[ -e "$DEST_ROOT" && ! -d "$DEST_ROOT" ]]; then
  printf 'install.sh: config dir exists but is not a directory: %s\n' "$DEST_ROOT" >&2
  exit 2
fi

# ── where hook entries get written ───────────────────────────────────────────
if [[ -n "$SETTINGS_FILE_ARG" ]]; then
  SETTINGS_FILE="$SETTINGS_FILE_ARG"
  # shellcheck disable=SC2088  # same literal-tilde expansion as above
  case "$SETTINGS_FILE" in
    "~/"*) SETTINGS_FILE="$HOME/${SETTINGS_FILE#\~/}" ;;
  esac
  if [[ "$SETTINGS_FILE" != /* ]]; then SETTINGS_FILE="$PWD/$SETTINGS_FILE"; fi
  SETTINGS_SOURCE="--settings-file"
  if [[ -e "$SETTINGS_FILE" && ! -f "$SETTINGS_FILE" ]]; then
    printf 'install.sh: settings file exists but is not a regular file: %s\n' "$SETTINGS_FILE" >&2
    exit 2
  fi
else
  SETTINGS_FILE="$DEST_ROOT/settings.json"
  SETTINGS_SOURCE="default"
fi

# The file Claude Code actually reads. When --settings-file points elsewhere —
# a generator's source — this is a SECOND file that also needs the entries, or
# nothing is enforced until the generator next runs. Writing the source alone
# leaves the live file empty while --check reports success: the same
# looks-installed-enforces-nothing failure, one step removed.
LIVE_SETTINGS="$DEST_ROOT/settings.json"
# shellcheck disable=SC2034  # read by the modules sourced below, not by this file
if [[ "$SETTINGS_FILE" != "$LIVE_SETTINGS" ]]; then SEED_LIVE=1; else SEED_LIVE=0; fi

DEST_LINK="$DEST_ROOT/agent-setup"
PROBLEMS=0

# shellcheck source=installers/common.sh
. "$REPO_DIR/installers/common.sh"
for m in $MODULES; do
  # shellcheck disable=SC1090
  . "$REPO_DIR/installers/$m.sh"
done

# ── preflight ────────────────────────────────────────────────────────────────
printf '\n%s\n' "$(bold 'agent-setup installer')"
printf '  repo:    %s\n' "$REPO_DIR"
printf '  target:  %s  (%s)\n' "$DEST_ROOT" "$DEST_SOURCE"
printf '  hooks:   %s  (%s)\n' "$SETTINGS_FILE" "$SETTINGS_SOURCE"
printf '  modules: %s\n' "$MODULES"
if [[ ! -d "$DEST_ROOT" ]]; then
  printf '           %s\n' "$(yellow 'does not exist yet — will be created')"
fi
printf '\n'

# The silent-failure case: $CLAUDE_CONFIG_DIR points somewhere other than the
# default, AND a populated default config dir also exists. Registering hooks in
# the wrong one of those two leaves the baseline looking installed while reading
# nothing. This is exactly what happens when install.sh is run from inside an
# agent session that exports the variable, so it gets a stop rather than a note.
# An explicit --config-dir is a decision already made and never warns.
if [[ "$DEST_SOURCE" == "\$CLAUDE_CONFIG_DIR" ]] && [[ "$DEST_ROOT" != "$DEFAULT_ROOT" ]] && [[ -d "$DEFAULT_ROOT" ]]; then
  printf '  %s two candidate config dirs exist:\n' "$(yellow 'AMBIGUOUS TARGET')"
  # shellcheck disable=SC2016  # naming the variable, not reading it
  printf '      %s   ← chosen, from $CLAUDE_CONFIG_DIR\n' "$DEST_ROOT"
  printf '      %s   ← the default, also present\n' "$DEFAULT_ROOT"
  printf '\n'
  printf '    Hooks are only enforced in the dir your Claude Code sessions actually\n'
  printf '    read. Pick deliberately:\n'
  printf '      ./install.sh --config-dir %s\n' "$DEST_ROOT"
  printf '      ./install.sh --config-dir %s\n' "$DEFAULT_ROOT"
  printf '\n'
  if [[ $DRY_RUN -eq 1 || "$MODE" == "check" ]]; then
    printf '    %s\n\n' "$(yellow 'continuing — this mode changes nothing')"
  elif [[ $ASSUME_YES -eq 1 ]]; then
    printf '    %s\n\n' "$(yellow 'continuing — --yes given')"
  elif [[ -t 0 ]]; then
    printf '    Continue with %s? [y/N] ' "$DEST_ROOT"
    read -r reply
    case "$reply" in
      [yY]|[yY][eE][sS]) printf '\n' ;;
      *) printf '\n  aborted — nothing was changed.\n\n'; exit 1 ;;
    esac
  else
    err "refusing to guess with no TTY — pass --config-dir PATH or --yes."
    exit 2
  fi
fi

# bun is no longer a precondition of running this script — the prereqs module
# installs it. It IS a precondition of every module after prereqs, so this is
# called at the point where that becomes true rather than up front. Asserting it
# here would make the installer refuse to run on exactly the fresh machine it was
# written to set up.
require_bun() {
  command -v bun >/dev/null 2>&1 && return 0
  err "bun is required (the hooks are TypeScript) and was not found on PATH."
  info "the prereqs module installs it — do not pass --skip prereqs on a machine without it."
  info "or install it yourself: curl -fsSL https://bun.sh/install | bash"
  return 1
}

# ── check ────────────────────────────────────────────────────────────────────
if [[ "$MODE" == "check" ]]; then
  rc=0
  for m in $MODULES; do
    printf '%s\n' "$(bold "$("${m}_label")")"
    # Most modules inspect state through bun. Without it they would each report
    # their own thing as missing, which is a wrong reason dressed up as a
    # finding — say the real one once instead.
    if ! list_has "$BUNLESS_MODULES" "$m" && ! command -v bun >/dev/null 2>&1; then
      bad_line "cannot check — bun is not installed"
      rc=1
    else
      "${m}_check" || rc=1
    fi
    printf '\n'
  done
  exit $rc
fi

# ── uninstall ────────────────────────────────────────────────────────────────
if [[ "$MODE" == "uninstall" ]]; then
  # Removing hook entries means rewriting settings.json, which merge-settings.ts
  # does — so without bun this cannot take the entries out, and a half-removal
  # that leaves them pointing at a deleted symlink is worse than not starting.
  # Skipped when every selected module is a symlink-only one: `--only onboarding
  # --uninstall` rewrites no settings, and demanding bun to delete a symlink
  # would strand the one teardown a pre-prereqs machine can actually perform.
  needs_bun=0
  for m in $MODULES; do list_has "$BUNLESS_MODULES" "$m" || needs_bun=1; done
  [[ $needs_bun -eq 1 ]] && { require_bun || exit 1; }

  printf '%s\n' "$(bold 'removing')"
  # Reverse order: the conveniences first, the guardrails last, so an interrupted
  # uninstall leaves protection standing rather than removed.
  reversed=""
  for m in $MODULES; do reversed="$m $reversed"; done
  for m in $reversed; do
    printf '\n%s\n' "$(bold "$("${m}_label")")"
    "${m}_uninstall"
  done

  # The baseline link is shared: onboarding, security and skills all link
  # through it. Removing it belongs to whoever removed the last thing that used
  # it, which is only knowable here. Under a partial --only it stays, so the
  # modules that were NOT selected keep working.
  if [[ "$MODULES" == "$ALL_MODULES" ]]; then
    printf '\n%s\n' "$(bold 'baseline')"
    unlink_if_ours "$DEST_LINK" "baseline link"
  else
    # Only worth saying to someone who removed a module that used the link.
    # After `--only herdr --uninstall` it explains the absence of a thing they
    # never had, which is noise dressed up as transparency.
    for m in $MODULES; do
      if list_has "$LINKING_MODULES" "$m"; then
        printf '\n'
        warn "partial uninstall — the baseline link stays for the modules you kept"
        break
      fi
    done
  fi

  # Say which of the two happened. "agent-setup removed" after `--only skills
  # --uninstall` is the same class of overstatement as a summary claiming a
  # security posture that was never installed.
  if [[ "$MODULES" == "$ALL_MODULES" ]]; then
    printf '\n%s  agent-setup removed. Local overrides in %s were left alone.\n\n' \
      "$(green 'DONE')" "$DEST_ROOT/agent-setup.local.json"
  else
    printf '\n%s  removed: %s\n' "$(green 'DONE')" "$MODULES"
    printf '        The rest of agent-setup is still installed in %s\n\n' "$DEST_ROOT"
  fi
  exit 0
fi

# ── install ──────────────────────────────────────────────────────────────────
# The config dir has to exist before any module runs. It used to be created as a
# side effect of the security module's first symlink, which meant `--only rtk`
# against a fresh dir failed with an error from rtk about a path that this
# script was responsible for.
if [[ $DRY_RUN -eq 0 && ! -d "$DEST_ROOT" ]]; then
  mkdir -p "$DEST_ROOT" || { err "could not create $DEST_ROOT"; exit 1; }
fi

FAILED_MODULES=""
n=0
for m in $MODULES; do
  n=$((n + 1))
  printf '%s\n' "$(bold "$n. $("${m}_label")")"

  # Checked per module rather than once up front, because on a fresh machine bun
  # does not exist until prereqs has run. A dry run plans without it.
  if [[ $DRY_RUN -eq 0 ]] && ! list_has "$BUNLESS_MODULES" "$m" && ! require_bun; then
    printf '\n'
    exit 1
  fi

  if "${m}_install"; then
    printf '\n'
    continue
  fi
  printf '\n'
  if list_has "$FATAL_MODULES" "$m"; then
    err "$m failed, and nothing after it can work without it. Stopping."
    printf '\n'
    exit 1
  fi
  warn "$m did not complete — continuing without it."
  FAILED_MODULES="$FAILED_MODULES $m"
  PROBLEMS=$((PROBLEMS + 1))
  printf '\n'
done

printf '%s\n' "────────────────────────────────────────────────────────────"

if [[ $DRY_RUN -eq 1 ]]; then
  printf '%s  dry run complete — nothing was changed.\n\n' "$(yellow 'PLAN')"
  exit 0
fi

if [[ $PROBLEMS -gt 0 ]]; then
  printf '%s  installed with %d problem(s) above.%s\n' "$(red 'PARTIAL')" "$PROBLEMS" \
    "$([[ -n "$FAILED_MODULES" ]] && printf ' Incomplete:%s' "$FAILED_MODULES")"
  printf '        The security guardrails are active; re-run to retry the rest.\n\n'
  exit 1
fi

# The summary only claims what actually ran. Under `--only rtk` an unconditional
# block advertised a security posture, an audit trail and /security-scan that
# were never installed — a summary that overstates coverage is the same class of
# problem as a control registered in the wrong config dir.
# `--only onboarding` installs a command and nothing else. Claiming the baseline
# is "active" there would be the same overstatement this block was rewritten to
# avoid — the whole point of the onboarding flow is that nothing is active yet.
if [[ "$MODULES" == "onboarding" ]]; then
  printf '%s  /run-agent-setup is installed in %s\n\n' "$(green 'READY')" "$DEST_ROOT"
  printf '  Nothing else has been changed. Open Claude Code and run %s to\n' "$(bold '/run-agent-setup')"
  printf '  go through the rest one step at a time.\n\n'
  exit 0
fi

printf '%s  agent-setup is active in new Claude Code sessions reading\n' "$(green 'DONE')"
printf '      %s\n\n' "$DEST_ROOT"

if list_has "$MODULES" security; then
  printf "  Posture is 'balanced': high-confidence credential shapes are blocked,\n"
  printf '  medium ones raise a permission prompt, low ones are logged only.\n'
fi
if list_has "$MODULES" plugins; then
  printf '  caveman is installed but dormant — run /caveman to switch it on.\n'
fi
printf '\n'

printf '  Checkout       %s\n' "$REPO_DIR"
if list_has "$MODULES" security; then
  printf '  Audit trail    %s\n' "$DEST_ROOT/security/agent-setup/audit.jsonl"
  printf '  Your overrides %s   (create as needed)\n' "$DEST_ROOT/agent-setup.local.json"
  printf '  Scan on demand /security-scan   or   bun "%s" <path>\n' "$DEST_LINK/scripts/scan.ts"
  printf '  Re-verify      "%s"\n' "$DEST_LINK/scripts/run-security-checks.sh"
fi
if list_has "$MODULES" rtk; then
  printf '  Token savings  rtk gain\n'
fi
if list_has "$MODULES" herdr; then
  printf '  Agent terminal herdr\n'
fi
if list_has "$MODULES" onboarding; then
  printf '  Guided setup   /run-agent-setup   (in Claude Code)\n'
fi
printf '  Update         git -C "%s" pull\n' "$REPO_DIR"
printf '  Status / drift "%s" --check%s%s\n' "$REPO_DIR/install.sh" \
  "$([[ "$DEST_SOURCE" == "--config-dir" ]] && printf ' --config-dir "%s"' "$DEST_ROOT")" \
  "$([[ "$SETTINGS_SOURCE" == "--settings-file" ]] && printf ' --settings-file "%s"' "$SETTINGS_FILE")"

printf '\n  Restart any open session for the hooks to load.\n\n'
