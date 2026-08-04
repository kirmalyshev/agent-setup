#!/usr/bin/env bash
#
# rtk.sh — rtk, a CLI proxy that filters and compacts command output before it
#          reaches the model's context. `git status`, `npm test`, `grep` and
#          forty other tools get rewritten into a `rtk <tool>` equivalent that
#          says the same thing in far fewer tokens.
#
# rtk owns its own installation: `rtk init -g --auto-patch` writes RTK.md, adds
# an `@RTK.md` line to CLAUDE.md, and registers a PreToolUse hook in
# settings.json. This module's job is only to get the binary onto PATH and then
# invoke that, against the config dir install.sh resolved. rtk honours
# $CLAUDE_CONFIG_DIR, which is what makes that possible.
#
# Non-fatal by design. Someone with no Homebrew still gets the security
# guardrails; they just install rtk by hand afterwards.
#
# What it touches:
#   <config-dir>/settings.json  → one PreToolUse hook entry (rtk backs it up)
#   <config-dir>/RTK.md         → the command reference
#   <config-dir>/CLAUDE.md      → an `@RTK.md` import line

RTK_DOCS_URL="https://www.rtk-ai.app/"

rtk_label() { printf 'rtk — token-compacting CLI proxy'; }

rtk_present() { command -v rtk >/dev/null 2>&1; }

# Bring the binary onto PATH. Homebrew is the only automated path: rtk is in
# homebrew-core, and shipping a curl|bash of someone else's installer from
# inside our own installer is a supply chain we do not want to own.
rtk_ensure_binary() {
  if rtk_present; then
    step "rtk already on PATH ($(rtk --version 2>/dev/null || echo 'version unknown'))"
    return 0
  fi

  if ! command -v brew >/dev/null 2>&1; then
    warn "rtk is not installed and Homebrew was not found."
    info "install rtk yourself, then re-run this installer:"
    info "  $RTK_DOCS_URL"
    return 1
  fi

  step "installing rtk via Homebrew"
  run brew install rtk || { err "brew install rtk failed."; return 1; }
  [[ $DRY_RUN -eq 1 ]] && return 0
  rtk_present || { err "rtk is still not on PATH after brew install."; return 1; }
  return 0
}

rtk_install() {
  rtk_ensure_binary || return 1

  if [[ $DRY_RUN -eq 1 ]]; then
    printf '  %s %s\n' "$(yellow 'would')" "rtk init -g --auto-patch  (CLAUDE_CONFIG_DIR=$DEST_ROOT)"
    return 0
  fi

  # --auto-patch is required: without it rtk detects a non-interactive shell,
  # declines to touch settings.json, and prints manual instructions that nobody
  # in a piped install will ever see.
  if ! CLAUDE_CONFIG_DIR="$DEST_ROOT" rtk init -g --auto-patch 2>&1 | sed 's/^/  /'; then
    err "rtk init failed."
    return 1
  fi

  rtk_verify
}

rtk_verify() {
  local rc=0

  # Functional, not cosmetic: ask the hook engine what it would do with a real
  # command. A binary that exists but rewrites nothing saves nothing.
  local rewrite
  rewrite="$(rtk hook check "git status" 2>&1)"
  if [[ "$rewrite" == rtk\ * ]]; then
    step "hook engine rewrites: git status → $rewrite"
  else
    err "rtk hook check did not rewrite \`git status\` (got: ${rewrite:0:80})"
    rc=1
  fi

  if grep -q 'rtk hook claude' "$LIVE_SETTINGS" 2>/dev/null; then
    step "PreToolUse hook registered in $(basename "$LIVE_SETTINGS")"
  else
    err "no \`rtk hook claude\` entry in $LIVE_SETTINGS."
    info "run: CLAUDE_CONFIG_DIR=$DEST_ROOT rtk init -g --auto-patch"
    rc=1
  fi

  return $rc
}

rtk_check() {
  local rc=0

  if rtk_present; then
    ok_line "rtk on PATH ($(rtk --version 2>/dev/null || echo 'version unknown'))"
  else
    bad_line "rtk NOT on PATH — see $RTK_DOCS_URL"
    return 1
  fi

  if grep -q 'rtk hook claude' "$LIVE_SETTINGS" 2>/dev/null; then
    ok_line "PreToolUse hook registered in $LIVE_SETTINGS"
  else
    bad_line "PreToolUse hook NOT registered in $LIVE_SETTINGS"; rc=1
  fi

  if [[ -f "$DEST_ROOT/RTK.md" ]]; then
    ok_line "RTK.md present"
  else
    note_line "no RTK.md in $DEST_ROOT — the model has no command reference"
  fi

  return $rc
}

rtk_uninstall() {
  rtk_present || { warn "rtk not on PATH — nothing to remove"; return 0; }

  if [[ $DRY_RUN -eq 1 ]]; then
    printf '  %s %s\n' "$(yellow 'would')" "rtk init -g --uninstall  (CLAUDE_CONFIG_DIR=$DEST_ROOT)"
    return 0
  fi

  # -g is required and pairs with the -g used at install: without it rtk targets
  # a project-local install, prints "Uninstall only works with --global flag",
  # and exits 0. An earlier version dropped the flag and reported success while
  # the hook entry, RTK.md and the CLAUDE.md line were all still in place.
  local out
  out="$(CLAUDE_CONFIG_DIR="$DEST_ROOT" rtk init -g --uninstall 2>&1)"
  printf '%s\n' "$out" | sed 's/^/  /'

  # rtk's exit code is not load-bearing here, so verify by state instead: the
  # hook entry is the thing that actually does something, and it is either gone
  # or it is not.
  if grep -q 'rtk hook claude' "$LIVE_SETTINGS" 2>/dev/null; then
    err "the \`rtk hook claude\` entry is still in $LIVE_SETTINGS."
    info "remove it by hand, or run: CLAUDE_CONFIG_DIR=$DEST_ROOT rtk init -g --uninstall"
  else
    step "rtk hook removed (the binary itself was left installed)"
  fi
  return 0
}
