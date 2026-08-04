#!/usr/bin/env bash
#
# check-steps.sh — assert the onboarding narrative matches the installer.
#
# The step files under install/scripts/ describe what each module does. Nothing
# forces them to be true: a step that describes behaviour the installer no
# longer has reads perfectly and is wrong, and the person reading it is deciding
# whether to let software change their machine. That is the failure this guards.
#
# Four assertions:
#   1. every module in ALL_MODULES has exactly one step file
#   2. every step file's `module:` names a real module
#   3. every step file's `fatal:` matches FATAL_MODULES
#   4. every step file has the five required sections
#
# EXIT: 0 all consistent · 1 at least one mismatch
set -uo pipefail

STEPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$STEPS_DIR/../.." && pwd)"
INSTALL_SH="$REPO_DIR/install.sh"

FAIL=0
ok()  { printf '  \033[32m✔\033[0m %s\n' "$1"; }
bad() { printf '  \033[31m✖\033[0m %s\n' "$1"; FAIL=1; }

# Read the lists from install.sh rather than duplicating them here. A copy would
# be one more thing that can drift, which is the problem this script exists for.
read_list() {
  sed -n "s/^$1=\"\(.*\)\"$/\1/p" "$INSTALL_SH" | head -1
}
ALL_MODULES="$(read_list ALL_MODULES)"
FATAL_MODULES="$(read_list FATAL_MODULES)"

if [[ -z "$ALL_MODULES" ]]; then
  bad "could not read ALL_MODULES from $INSTALL_SH"
  exit 1
fi

list_has() { case " $1 " in *" $2 "*) return 0 ;; *) return 1 ;; esac }

# frontmatter <file> <key> — the value of one key, from the leading --- block.
frontmatter() {
  sed -n '/^---$/,/^---$/p' "$1" | sed -n "s/^$2: *//p" | head -1
}

printf '\nonboarding step specs\n\n'

# 1 + 2 + 3: every step file resolves to a real module, with the right fatality.
declare -a seen=()
for f in "$STEPS_DIR"/[0-9]*.md; do
  [[ -f "$f" ]] || continue
  base="$(basename "$f")"
  mod="$(frontmatter "$f" module)"
  fat="$(frontmatter "$f" fatal)"

  if [[ -z "$mod" ]]; then
    bad "$base: no \`module:\` in frontmatter"
    continue
  fi
  if ! list_has "$ALL_MODULES" "$mod"; then
    bad "$base: module '$mod' is not in ALL_MODULES ($ALL_MODULES)"
    continue
  fi
  if list_has "${seen[*]:-}" "$mod"; then
    bad "$base: module '$mod' already has a step file"
    continue
  fi
  seen+=("$mod")

  expected=false
  list_has "$FATAL_MODULES" "$mod" && expected=true
  if [[ "$fat" != "$expected" ]]; then
    bad "$base: fatal is '$fat' but $mod is $([[ $expected == true ]] && echo 'in' || echo 'not in') FATAL_MODULES"
    continue
  fi

  # 4: the sections /run-agent-setup reads. A step missing "What it touches"
  # is one that asks for a yes without saying what it costs.
  missing=""
  for section in "## Why" "## What it touches" "## Run" "## Verify" "## Rollback"; do
    grep -qF "$section" "$f" || missing="$missing '$section'"
  done
  if [[ -n "$missing" ]]; then
    bad "$base: missing section(s):$missing"
    continue
  fi

  ok "$base → $mod (fatal: $fat)"
done

# 1, the other direction: a module with no step file is invisible to the
# onboarding flow — /run-agent-setup never mentions it, so nobody consents to it.
for m in $ALL_MODULES; do
  list_has "${seen[*]:-}" "$m" || bad "module '$m' has no step file in install/scripts/"
done

# INSTALL.md is the remote entry point: an agent fetches it and acts on it,
# before the user has a checkout to inspect. Every path and module it names has
# to be real, because a wrong one there fails on a stranger's machine at the
# moment they are deciding whether to trust this.
printf '\nremote entry point\n\n'
INSTALL_MD="$REPO_DIR/INSTALL.md"
if [[ ! -f "$INSTALL_MD" ]]; then
  bad "INSTALL.md is missing — the paste-a-link install has nothing to fetch"
else
  for path in install.sh .claude/commands/run-agent-setup.md; do
    if grep -qF "$path" "$INSTALL_MD"; then
      if [[ -e "$REPO_DIR/$path" ]]; then
        ok "INSTALL.md → $path exists"
      else
        bad "INSTALL.md names $path, which does not exist in this repo"
      fi
    else
      bad "INSTALL.md no longer mentions $path — the handoff is broken"
    fi
  done

  # The command file it hands off to must be the one onboarding.sh installs.
  # These drifted apart once already, during the /setup → /run-agent-setup rename.
  installed_cmd="$(sed -n 's/^ONBOARDING_COMMAND="\(.*\)"$/\1/p' "$REPO_DIR/installers/onboarding.sh" | head -1)"
  if [[ -n "$installed_cmd" ]] && grep -qF "$installed_cmd" "$INSTALL_MD"; then
    ok "INSTALL.md hands off to the command onboarding.sh installs ($installed_cmd)"
  else
    bad "INSTALL.md does not name ONBOARDING_COMMAND ($installed_cmd) from installers/onboarding.sh"
  fi

  if grep -qE 'only onboarding' "$INSTALL_MD"; then
    ok "INSTALL.md installs only the onboarding module"
  else
    bad "INSTALL.md no longer runs --only onboarding — it may be installing more than the entry point"
  fi

  # The config dir has to survive the handoff. INSTALL.md chooses it; the
  # walkthrough defaults to reading the environment, which is correct when it
  # runs as /run-agent-setup and wrong when it is invoked from here. If the
  # instruction to carry it across is ever dropped, the install silently
  # targets whatever dir the *agent's own* session reads — and when a baseline
  # link happens to exist there, nothing errors. Found by installing into a
  # scratch dir and watching the walkthrough resolve ~/.claude instead.
  if grep -qF -- '--config-dir' "$INSTALL_MD"; then
    ok "INSTALL.md passes --config-dir through the handoff"
  else
    bad "INSTALL.md no longer mentions --config-dir — the chosen config dir is lost at the handoff"
  fi

  CMD_MD="$REPO_DIR/.claude/commands/run-agent-setup.md"
  if [[ -f "$CMD_MD" ]]; then
    # A missing symlink must be detected by testing the link itself. `dirname`
    # of an empty string is ".", so any check keyed on empty output passes a
    # valid-looking relative path downstream instead of stopping.
    # shellcheck disable=SC2016  # literal $LINK is the point — this greps for the text
    if grep -qE '\[ +! +-L +"\$LINK" +\]' "$CMD_MD"; then
      ok "run-agent-setup.md tests the baseline link with -L"
    else
      bad "run-agent-setup.md no longer tests -L on the baseline link — a missing link resolves to '.' undetected"
    fi
  fi
fi

printf '\n'
if [[ $FAIL -eq 0 ]]; then
  printf '  \033[32mPASS\033[0m  %d step(s) + INSTALL.md, consistent with install.sh\n\n' "${#seen[@]}"
else
  printf '  \033[31mFAIL\033[0m  the onboarding steps and the installer disagree\n\n'
fi
exit $FAIL
