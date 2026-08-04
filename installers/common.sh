#!/usr/bin/env bash
#
# common.sh — shared output helpers and symlink primitives for the installer
#             modules. Sourced by install.sh before any module; never executed.
#
# Every module (onboarding.sh, prereqs.sh, security.sh, rtk.sh, herdr.sh,
# plugins.sh, skills.sh) implements the same four-name contract, where <id> is
# the module's directory-free name:
#
#   <id>_label       one line, printed as the section heading
#   <id>_install     install or update; return non-zero on failure
#   <id>_check       report what is installed; return non-zero if incomplete
#   <id>_uninstall   remove what <id>_install added; best effort, always 0
#
# Modules read these globals, set by install.sh before dispatch:
#
#   REPO_DIR        absolute path of this checkout
#   SRC_CLAUDE      $REPO_DIR/.claude
#   DEST_ROOT       the resolved Claude Code config dir
#   DEST_LINK       $DEST_ROOT/agent-setup — the symlink to $SRC_CLAUDE
#   SETTINGS_FILE   where hook entries are written
#   LIVE_SETTINGS   $DEST_ROOT/settings.json — what a session actually reads
#   SEED_LIVE       1 when SETTINGS_FILE and LIVE_SETTINGS differ
#   DRY_RUN FORCE   flags
#
# and mutate exactly one: PROBLEMS, incremented per non-fatal defect found.

LINK_NAME="agent-setup"

green() { printf '\033[32m%s\033[0m' "$1"; }
red()   { printf '\033[31m%s\033[0m' "$1"; }
yellow(){ printf '\033[33m%s\033[0m' "$1"; }
bold()  { printf '\033[1m%s\033[0m' "$1"; }

step()  { printf '  %s %s\n' "$(green '›')" "$1"; }
warn()  { printf '  %s %s\n' "$(yellow '!')" "$1"; }
err()   { printf '  %s %s\n' "$(red '✖')" "$1" >&2; }
info()  { printf '    %s\n' "$1"; }

ok_line()   { printf '  %s %s\n' "$(green '✔')" "$1"; }
bad_line()  { printf '  %s %s\n' "$(red '✖')" "$1"; }
note_line() { printf '  %s %s\n' "$(yellow '!')" "$1"; }

# run <cmd...> — execute, or print the plan under --dry-run.
run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    printf '  %s %s\n' "$(yellow 'would')" "$*"
    return 0
  fi
  "$@"
}

# link_into <target> <link_path> <label>
#
# Idempotent: an existing symlink pointing at <target> is left alone. Anything
# else in the way is a refusal, not an overwrite — --force turns the refusal
# into a timestamped backup, so a hand-written file is never silently lost.
link_into() {
  local target="$1" link_path="$2" label="$3"

  if [[ -L "$link_path" ]]; then
    local current
    current="$(readlink "$link_path")"
    if [[ "$current" == "$target" ]]; then
      step "$label already linked"
      return 0
    fi
    if [[ $FORCE -eq 0 ]]; then
      err "$label is a symlink to a different location: $current"
      info "re-run with --force to replace it."
      PROBLEMS=$((PROBLEMS + 1))
      return 1
    fi
    run rm "$link_path"
  elif [[ -e "$link_path" ]]; then
    if [[ $FORCE -eq 0 ]]; then
      err "$label exists and is not a symlink: $link_path"
      info "move it aside, or re-run with --force to replace it."
      PROBLEMS=$((PROBLEMS + 1))
      return 1
    fi
    local backup
    backup="$link_path.pre-agent-setup.$(date +%Y%m%d-%H%M%S)"
    warn "moving existing $label to $(basename "$backup")"
    run mv "$link_path" "$backup"
  fi

  run mkdir -p "$(dirname "$link_path")"
  run ln -s "$target" "$link_path"
  step "$label linked → $target"
}

# ensure_baseline_link — create <config-dir>/agent-setup → <repo>/.claude.
#
# Every module that links a file links it THROUGH this base, so the base has to
# exist before any of them run. It used to be created as a side effect of the
# first link in security.sh, which meant `--only onboarding` against a fresh
# config dir produced a dangling commands/run-agent-setup.md — the onboarding entry point
# broken by the module that was supposed to install it. Idempotent, because
# link_into leaves a correct existing link alone, so call order stops mattering.
ensure_baseline_link() {
  link_into "$SRC_CLAUDE" "$DEST_LINK" "baseline"
}

# The skills split into two buckets, named here because two modules need to
# agree on the boundary and neither owns it.
#
# The guardrail skills ship with security.sh: they are how someone reasons about
# what a hook cannot catch, so they are part of the protection, not a
# convenience alongside it. Everything else lives in skills.sh and can be
# declined on its own — with all nine inside the security module, "no thanks to
# the skills" also meant "no thanks to the credential guardrails", which is not
# a choice anyone should be asked to make.
# shellcheck disable=SC2034  # read by security.sh and skills.sh, sourced later
GUARDRAIL_SKILLS="LlmDataBoundary SecretHygiene"

# all_skill_names — every skill directory in the checkout, one per line.
# Empty output is fine; a checkout with no skills/ dir is not an error.
all_skill_names() {
  [[ -d "$SRC_CLAUDE/skills" ]] || return 0
  local d
  for d in "$SRC_CLAUDE/skills"/*/; do
    [[ -d "$d" ]] || continue
    basename "$d"
  done
}

# link_skills <label> <name...> — link each named skill, reading names on stdin.
# Shared by security.sh and skills.sh so the two buckets cannot drift in how
# they link, check or report.
link_skill_list() {
  local s
  while IFS= read -r s; do
    [[ -n "$s" ]] || continue
    link_into "$DEST_LINK/skills/$s" "$DEST_ROOT/skills/$s" "skill $s"
  done
}

check_skill_list() {
  local s rc=0
  while IFS= read -r s; do
    [[ -n "$s" ]] || continue
    if [[ -L "$DEST_ROOT/skills/$s" ]]; then
      ok_line "skill linked: $s"
    else
      bad_line "skill NOT linked: $s"; rc=1
    fi
  done
  return $rc
}

unlink_skill_list() {
  local s
  while IFS= read -r s; do
    [[ -n "$s" ]] || continue
    unlink_if_ours "$DEST_ROOT/skills/$s" "skill $s"
  done
}

# unlink_if_ours <link_path> <label>
#
# Only removes a symlink that points into this installation. A path someone
# else created with the same name is reported and left where it is.
unlink_if_ours() {
  local link_path="$1" label="$2"
  if [[ -L "$link_path" ]] && [[ "$(readlink "$link_path")" == *"$LINK_NAME"* || "$(readlink "$link_path")" == "$SRC_CLAUDE"* ]]; then
    run rm "$link_path"
    step "$label unlinked"
  elif [[ -e "$link_path" ]]; then
    warn "$label is not ours — left in place"
  fi
}
