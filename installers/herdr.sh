#!/usr/bin/env bash
#
# herdr.sh — herdr, a terminal workspace manager built for coding agents. One
#            window instead of six, with per-agent state: which agent is
#            running, which is waiting on you, which is done.
#
# Like rtk, herdr owns its own Claude Code wiring: `herdr integration install
# claude` writes a hook script into the config dir and registers it. This
# module's job is to get the binary onto PATH and then invoke that against the
# dir install.sh resolved. herdr honours $CLAUDE_CONFIG_DIR, which is what makes
# targeting a non-default config dir possible — verified by reading back the
# path `herdr integration status` reports under that variable.
#
# THE BACKGROUND SERVER. herdr is the only thing this repo installs that leaves
# a process running. Sessions survive closing the window because a server holds
# them, and that server starts on first launch. This module does NOT run `brew
# services start herdr`: registering a login daemon is not a decision an
# installer should make quietly, and herdr does not need one to work.
#
# Non-fatal by design, same as rtk.
#
# What it touches:
#   <config-dir>/hooks/herdr-agent-state.sh  → written by herdr
#   <config-dir>/settings.json               → one hook entry, written by herdr
#
# What it deliberately leaves alone:
#   ~/.config/herdr/config.toml  — herdr's own config, outside this repo's
#                                  blast radius. Never written, never removed.

HERDR_DOCS_URL="https://herdr.dev/docs/install/"

herdr_label() { printf 'herdr — one terminal for every agent'; }

herdr_present() { command -v herdr >/dev/null 2>&1; }

# Homebrew is the only automated path, for the same reason rtk uses it: herdr
# publishes a `curl | sh` installer, and piping someone else's installer from
# inside our own is a supply chain we do not want to own on a user's behalf.
herdr_ensure_binary() {
  if herdr_present; then
    step "herdr already on PATH ($(herdr --version 2>/dev/null || echo 'version unknown'))"
    return 0
  fi

  if ! command -v brew >/dev/null 2>&1; then
    warn "herdr is not installed and Homebrew was not found."
    info "install herdr yourself, then re-run this installer:"
    info "  $HERDR_DOCS_URL"
    return 1
  fi

  step "installing herdr via Homebrew"
  run brew install herdr || { err "brew install herdr failed."; return 1; }
  [[ $DRY_RUN -eq 1 ]] && return 0
  herdr_present || { err "herdr is still not on PATH after brew install."; return 1; }
  return 0
}

# The integration state for Claude Code, as one word: current, outdated,
# not-installed, or unknown. herdr reports every agent it knows about on its own
# line; this reads the one line that concerns us.
#
# The line looks like:  claude: current (v3) (/path/to/hook.sh)
herdr_integration_state() {
  local line
  line="$(CLAUDE_CONFIG_DIR="$DEST_ROOT" herdr integration status 2>/dev/null \
    | grep '^claude:' | head -1)"
  case "$line" in
    *"not installed"*) printf 'not-installed' ;;
    *outdated*)        printf 'outdated' ;;
    *current*)         printf 'current' ;;
    *)                 printf 'unknown' ;;
  esac
}

herdr_install() {
  herdr_ensure_binary || return 1

  if [[ $DRY_RUN -eq 1 ]]; then
    printf '  %s %s\n' "$(yellow 'would')" \
      "herdr integration install claude  (CLAUDE_CONFIG_DIR=$DEST_ROOT)"
    return 0
  fi

  if ! CLAUDE_CONFIG_DIR="$DEST_ROOT" herdr integration install claude 2>&1 | sed 's/^/  /'; then
    err "herdr integration install claude failed."
    return 1
  fi

  herdr_verify
}

herdr_verify() {
  local state
  state="$(herdr_integration_state)"
  case "$state" in
    current)
      step "Claude Code integration registered in $DEST_ROOT"
      ;;
    outdated)
      # Not a failure: an older integration still reports agent state. Say it,
      # so it is visible rather than discovered later as odd behaviour.
      warn "the integration installed, but herdr reports it as outdated"
      info "run: CLAUDE_CONFIG_DIR=$DEST_ROOT herdr integration install claude"
      ;;
    *)
      err "herdr does not report a Claude Code integration after installing one (state: $state)."
      info "check: CLAUDE_CONFIG_DIR=$DEST_ROOT herdr integration status"
      return 1
      ;;
  esac

  # The hook script herdr writes is what actually reports state to the server.
  # A registration with no file behind it is the same looks-installed failure
  # this repo cares about everywhere else.
  if [[ -f "$DEST_ROOT/hooks/herdr-agent-state.sh" ]]; then
    step "agent-state hook present in $DEST_ROOT/hooks"
  else
    err "no herdr-agent-state.sh in $DEST_ROOT/hooks — the integration reports state to nothing."
    return 1
  fi

  step "herdr runs a background server; it starts the first time you run \`herdr\`"
  return 0
}

herdr_check() {
  local rc=0

  if herdr_present; then
    ok_line "herdr on PATH ($(herdr --version 2>/dev/null || echo 'version unknown'))"
  else
    bad_line "herdr NOT on PATH — see $HERDR_DOCS_URL"
    return 1
  fi

  case "$(herdr_integration_state)" in
    current)
      ok_line "Claude Code integration registered for $DEST_ROOT"
      ;;
    outdated)
      # A drift note, not a failure. The integration works; it is a version
      # behind. Failing --check over it would make --check useless as a health
      # signal, because every herdr release would turn it red.
      note_line "Claude Code integration is a version behind"
      info "refresh: CLAUDE_CONFIG_DIR=$DEST_ROOT herdr integration install claude"
      ;;
    not-installed)
      bad_line "Claude Code integration NOT registered for $DEST_ROOT"; rc=1
      ;;
    *)
      bad_line "could not read herdr integration status"; rc=1
      ;;
  esac

  return $rc
}

herdr_uninstall() {
  herdr_present || { warn "herdr not on PATH — nothing to remove"; return 0; }

  if [[ $DRY_RUN -eq 1 ]]; then
    printf '  %s %s\n' "$(yellow 'would')" \
      "herdr integration uninstall claude  (CLAUDE_CONFIG_DIR=$DEST_ROOT)"
    return 0
  fi

  CLAUDE_CONFIG_DIR="$DEST_ROOT" herdr integration uninstall claude 2>&1 | sed 's/^/  /'

  # Verify by state, not by exit code — the same lesson rtk_uninstall records.
  if [[ "$(herdr_integration_state)" == "not-installed" ]]; then
    step "herdr integration removed (the binary itself was left installed)"
  else
    err "the Claude Code integration is still registered with herdr."
    info "remove it by hand: CLAUDE_CONFIG_DIR=$DEST_ROOT herdr integration uninstall claude"
  fi
  return 0
}
