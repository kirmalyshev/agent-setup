#!/usr/bin/env bash
#
# onboarding.sh — the /run-agent-setup command, and nothing else.
#
# This module exists so that `curl | bash` can stop being an install. It links
# one file. After it runs, the user has a command they can read before they run
# it, and every actual change to their machine happens afterwards, module by
# module, with an explanation and a yes/no in front of it.
#
# That is the whole design constraint: the smallest possible privileged
# footprint before consent. One symlink into a config dir is a thing someone can
# audit in ten seconds and undo with `rm`.
#
# Two consequences follow, and both are load-bearing:
#
#   1. It must not need bun. bun arrives with the prereqs module, which runs
#      later — after the user has agreed to it. install.sh lists this module in
#      BUNLESS_MODULES for exactly that reason. Keep this file to symlinks: the
#      moment it needs to run TypeScript, the bootstrap flow breaks on the fresh
#      machine it was written for.
#   2. It must not assume security.sh has run. The baseline link it links
#      through is created by ensure_baseline_link, which is idempotent and
#      shared, so this module can be first.
#
# What it touches:
#   <config-dir>/agent-setup                  → symlink to <repo>/.claude (shared)
#   <config-dir>/commands/run-agent-setup.md  → symlink

ONBOARDING_COMMAND="commands/run-agent-setup.md"

onboarding_label() { printf 'the /run-agent-setup onboarding command'; }

onboarding_install() {
  if [[ ! -f "$SRC_CLAUDE/$ONBOARDING_COMMAND" ]]; then
    err "no .claude/$ONBOARDING_COMMAND in $REPO_DIR — run this from the repo root."
    return 1
  fi

  ensure_baseline_link || return 1
  link_into "$DEST_LINK/$ONBOARDING_COMMAND" \
    "$DEST_ROOT/$ONBOARDING_COMMAND" "command /run-agent-setup" || return 1

  [[ $DRY_RUN -eq 1 ]] && return 0
  onboarding_verify
}

# A symlink that exists proves nothing: the baseline it points through may be
# dangling, which is the failure mode this repo hits when a checkout moves. The
# only claim worth making is that the file is readable at the installed path.
onboarding_verify() {
  if [[ -r "$DEST_ROOT/$ONBOARDING_COMMAND" ]]; then
    step "/run-agent-setup resolves and is readable"
    return 0
  fi
  err "$DEST_ROOT/$ONBOARDING_COMMAND does not resolve to a readable file."
  info "the baseline link is probably dangling — re-run ./install.sh from the checkout."
  return 1
}

onboarding_check() {
  if [[ -L "$DEST_ROOT/$ONBOARDING_COMMAND" ]] && [[ -r "$DEST_ROOT/$ONBOARDING_COMMAND" ]]; then
    ok_line "/run-agent-setup installed and readable"
    return 0
  fi
  if [[ -L "$DEST_ROOT/$ONBOARDING_COMMAND" ]]; then
    bad_line "/run-agent-setup is linked but DANGLING — the checkout moved or was deleted"
    return 1
  fi
  bad_line "/run-agent-setup NOT installed (no $DEST_ROOT/$ONBOARDING_COMMAND)"
  return 1
}

onboarding_uninstall() {
  unlink_if_ours "$DEST_ROOT/$ONBOARDING_COMMAND" "command /run-agent-setup"
  return 0
}
