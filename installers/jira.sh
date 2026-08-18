#!/usr/bin/env bash
#
# jira.sh — the Jira CLI (https://github.com/ankitpokhrel/jira-cli), for anyone
#           whose work tracker is Jira.
#
# Unlike rtk and herdr, jira-cli has no Claude Code integration to register —
# no hook, no settings.json entry, nothing under the config dir. This module's
# entire job is getting the `jira` binary onto PATH. Authenticating it
# (`jira init`, which needs a server URL and a token) is left to the user: it
# is interactive, per-person, and none of this installer's business.
#
# Non-fatal by design, same as rtk and herdr: someone with no Homebrew, or no
# Jira account, still gets everything else.
#
# What it touches: nothing under the config dir.
# What it deliberately leaves alone: ~/.config/.jira/.config.yml, jira-cli's
# own config — never written, never removed.

JIRA_FORMULA="ankitpokhrel/jira-cli/jira-cli"
JIRA_DOCS_URL="https://github.com/ankitpokhrel/jira-cli"

jira_label() { printf 'jira-cli — the Jira command line'; }

jira_present() { command -v jira >/dev/null 2>&1; }

# `jira version` prints a Go-struct-shaped line, e.g.:
#   (Version="1.7.0", GitCommit="...", ..., GoVersion="go1.24.1", ...)
# The leading `^(` anchor matters: an unanchored `Version="` pattern also
# matches inside `GoVersion="go1.24.1"`, so anything without it — including a
# naive `grep -o` — would extract the wrong field. Falls back to a fixed
# string rather than an empty one, since every call site wraps this in its
# own parens.
jira_version() {
  local v
  v="$(jira version 2>/dev/null | sed -n 's/^(Version="\([^"]*\)".*/\1/p')"
  printf '%s' "${v:-version unknown}"
}

# Homebrew is the only automated path, for the same supply-chain reason as rtk
# and herdr: jira-cli has no official curl|sh installer, but piping one in on
# a user's behalf is not a pattern this repo wants to start.
jira_install() {
  if jira_present; then
    step "jira-cli already on PATH ($(jira_version))"
    return 0
  fi

  if ! command -v brew >/dev/null 2>&1; then
    warn "jira-cli is not installed and Homebrew was not found."
    info "install it yourself, then re-run this installer:"
    info "  $JIRA_DOCS_URL"
    return 1
  fi

  step "installing jira-cli via Homebrew"
  run brew install "$JIRA_FORMULA" || { err "brew install $JIRA_FORMULA failed."; return 1; }
  [[ $DRY_RUN -eq 1 ]] && return 0
  jira_present || { err "jira is still not on PATH after brew install."; return 1; }
  step "jira-cli installed ($(jira_version))"
  info "run \`jira init\` to point it at your Jira server — this installer never does that for you"
  return 0
}

jira_check() {
  if jira_present; then
    ok_line "jira-cli on PATH ($(jira_version))"
    return 0
  fi
  bad_line "jira-cli NOT on PATH — see $JIRA_DOCS_URL"
  return 1
}

jira_uninstall() {
  jira_present || { warn "jira-cli not on PATH — nothing to remove"; return 0; }
  # Same stance as prereqs.sh: this is a general dev tool, not something this
  # repo configured, so there is nothing of ours to take back.
  info "jira-cli was left installed — it is a general tool, and this installer never runs \`jira init\`"
  return 0
}
