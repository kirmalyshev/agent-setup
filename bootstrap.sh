#!/usr/bin/env bash
#
# bootstrap.sh — one line to get to the guided setup.
#
#   curl -fsSL https://raw.githubusercontent.com/kirmalyshev/agent-setup/main/bootstrap.sh | bash
#
# The documented entry point is INSTALL.md — the user pastes its URL at their
# agent and the agent does this. This script is the same thing for someone who
# would rather run a shell line, and it is what CI drives. Both end in
# `install.sh --only onboarding`, so there is one implementation.
#
# THIS DOES NOT INSTALL THE BASELINE. It clones (or fast-forwards) the repo at
# ~/.agent-setup and installs exactly one thing: the /run-agent-setup command. Everything
# else happens afterwards, inside Claude Code, one module at a time, with an
# explanation and a yes/no in front of each change.
#
# That is the point. A curl-piped-to-bash line that installs hooks, packages and
# plugins asks someone to consent to all of it by consenting to none of it. This
# version's entire privileged footprint before consent is one symlink into a
# config dir — auditable in ten seconds, undoable with rm.
#
# For an unattended install, skip this script and run install.sh directly:
#   git clone https://github.com/kirmalyshev/agent-setup ~/.agent-setup
#   ~/.agent-setup/install.sh --yes
#
# This script owns exactly three decisions: where the checkout lives, where it
# comes from, and which config dir install.sh targets.
#
# Everything it does is printed before it happens, and it refuses rather than
# guesses: it will not write over a directory it did not clone, and it will not
# pick between two candidate config dirs on your behalf.
#
# Env overrides:
#   AGENT_SETUP_CHECKOUT   where the repo lives   (default ~/.agent-setup)
#   AGENT_SETUP_REMOTE     what to clone          (default the public HTTPS URL)
#
# Arguments are forwarded verbatim to install.sh, after `--only onboarding --yes`:
#   ... | bash -s -- --config-dir ~/.claude
#   ... | bash -s -- --dry-run
#
# EXIT: 0 ok · 1 refused or failed
set -euo pipefail

# HTTPS, not SSH: this repo is public, and a one-liner that requires a
# configured GitHub SSH key fails for exactly the newcomer it is written for.
CANONICAL_REMOTE="https://github.com/kirmalyshev/agent-setup.git"
CANONICAL_NWO="kirmalyshev/agent-setup"
REMOTE="${AGENT_SETUP_REMOTE:-$CANONICAL_REMOTE}"
CHECKOUT="${AGENT_SETUP_CHECKOUT:-$HOME/.agent-setup}"

die() { printf '\n  bootstrap: %s\n\n' "$1" >&2; exit 1; }
say() { printf '  %s\n' "$1"; }

# git and curl are the only hard requirements here. bun used to be a third, which
# meant the one-line installer refused to run on exactly the fresh machine it is
# written for; install.sh's prereqs module installs it now. git is not installed
# for you: on macOS it arrives with the command line tools, and on Linux it is a
# package-manager decision this script has no business making.
command -v git >/dev/null 2>&1 || die 'git is required and was not found on PATH.'
command -v curl >/dev/null 2>&1 || die 'curl is required and was not found on PATH.'

# ── which config dir install.sh targets ──────────────────────────────────────
# Hooks are only enforced in the config dir your sessions actually read, and
# there is no TTY here to ask on. So: an explicit --config-dir in the forwarded
# arguments always wins; otherwise the default is ~/.claude; and if
# $CLAUDE_CONFIG_DIR disagrees with that default, this stops instead of picking.
has_config_dir=0
for arg in "$@"; do
  case "$arg" in --config-dir|--config-dir=*) has_config_dir=1 ;; esac
done

if [[ $has_config_dir -eq 0 ]]; then
  if [[ -n "${CLAUDE_CONFIG_DIR:-}" && "$CLAUDE_CONFIG_DIR" != "$HOME/.claude" ]]; then
    die "two candidate config dirs, and no terminal to ask on:
                 \$CLAUDE_CONFIG_DIR = $CLAUDE_CONFIG_DIR
                 the default        = $HOME/.claude
             Re-run naming the one your sessions read, for example:
                 ... | bash -s -- --config-dir $CLAUDE_CONFIG_DIR"
  fi
  set -- --config-dir "$HOME/.claude" "$@"
fi

printf '\n  agent-setup bootstrap\n'
say "checkout: $CHECKOUT"

# ── clone, or fast-forward what is already there ─────────────────────────────
if [[ -e "$CHECKOUT" ]]; then
  [[ -d "$CHECKOUT/.git" ]] ||
    die "$CHECKOUT exists and is not a git checkout. Move it aside, or set
             AGENT_SETUP_CHECKOUT to a different path."

  origin="$(git -C "$CHECKOUT" remote get-url origin 2>/dev/null || true)"
  case "$origin" in
    "$REMOTE" | *"$CANONICAL_NWO"* | *"$CANONICAL_NWO".git) ;;
    *) die "$CHECKOUT is a git checkout of something else:
                 origin = ${origin:-<none>}
             Refusing to touch it." ;;
  esac

  say "updating existing checkout"
  git -C "$CHECKOUT" pull --ff-only --quiet ||
    die "could not fast-forward $CHECKOUT — you have local changes or a diverged
             branch there. Resolve it, then re-run."
else
  say "cloning $REMOTE"
  git clone --quiet "$REMOTE" "$CHECKOUT" ||
    die "clone failed. Check your network, or that $REMOTE is reachable."
fi

say "installing the /run-agent-setup command"
printf '\n'

# Run rather than exec: the next-step message has to be printed after the
# symlink exists, and it is the only reason anyone ran this script.
#
# --only onboarding is what makes this a bootstrap rather than an install. It
# links one file and needs no bun, which matters because bun does not exist yet
# on the machine this line is written for — installing it is part of what the
# user has not agreed to.
# `|| rc=$?` rather than a bare call: set -e would otherwise exit here without
# printing the next step, which is the only reason anyone ran this script.
#
# install.sh prints the next step itself, because it is the thing that knows
# what it installed — and it prints the same message to someone who ran
# `--only onboarding` by hand. Nothing is added here; saying it twice teaches
# the reader to skim the part that matters.
rc=0
"$CHECKOUT/install.sh" --only onboarding --yes "$@" || rc=$?
[[ $rc -eq 0 ]] || die "could not install the /run-agent-setup command (install.sh exited $rc)."
