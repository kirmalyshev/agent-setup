#!/usr/bin/env bash
#
# prereqs.sh — the toolchain everything else needs: bun, and Homebrew.
#
#   bun    REQUIRED. The hooks are TypeScript and bun executes them. Without it
#          nothing in this repo runs, so a failure here is fatal.
#   brew   OPTIONAL. Only used to install rtk, which lives in homebrew-core.
#          A failure here costs you rtk and nothing else.
#
# HONESTY NOTE — this module pipes two remote scripts into a shell, which is the
# pattern the README tells you to distrust. It is here because the alternative is
# a README that says "go install these two things and come back". What is done
# to earn it: both URLs are the projects' own official installers, pinned as
# constants below; each command is printed in full before it runs; and the whole
# module is skippable with `--skip prereqs` if you would rather install them
# yourself. Read them first if you like — they are the same two commands the
# projects put on their own front pages.
#
# SUDO — Homebrew's installer needs root, and the documented install path for
# this repo is `curl … | bash`, where stdin is the script and nothing can prompt
# for a password. NONINTERACTIVE=1 gets past Homebrew's "press RETURN" gate but
# not past sudo. So brew installs cleanly when a sudo timestamp is already warm
# and fails cleanly otherwise; the failure is non-fatal and says what to do.
#
# What it touches: ~/.bun (bun's own install prefix) and Homebrew's prefix. Both
# installers also append to your shell profile — that is theirs, not ours.

BUN_INSTALLER_URL="https://bun.sh/install"
BREW_INSTALLER_URL="https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh"

prereqs_label() { printf 'prerequisites (bun, Homebrew)'; }

# Homebrew's prefix is architecture- and platform-dependent, and a fresh install
# is not on PATH in the shell that installed it. These are the three locations
# its own installer uses.
prereqs_brew_prefixes() {
  printf '%s\n' /opt/homebrew /usr/local /home/linuxbrew/.linuxbrew
}

# Put a just-installed tool on PATH for the rest of THIS process. Both installers
# edit a shell profile, which does nothing for the already-running shell — so
# without this, `brew install rtk` two steps later still fails with "not found".
prereqs_adopt_bun_path() {
  [[ -x "$HOME/.bun/bin/bun" ]] || return 1
  export PATH="$HOME/.bun/bin:$PATH"
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  return 0
}

prereqs_adopt_brew_path() {
  local p
  while IFS= read -r p; do
    if [[ -x "$p/bin/brew" ]]; then
      eval "$("$p/bin/brew" shellenv)"
      return 0
    fi
  done < <(prereqs_brew_prefixes)
  return 1
}

prereqs_install_bun() {
  if command -v bun >/dev/null 2>&1; then
    step "bun already on PATH ($(bun --version 2>/dev/null || echo 'version unknown'))"
    return 0
  fi
  # Installed but not on PATH — a previous run, or a profile the current shell
  # never sourced. Adopting it is free; reinstalling is not.
  if prereqs_adopt_bun_path; then
    step "bun found at ~/.bun/bin and added to PATH for this run ($(bun --version 2>/dev/null))"
    return 0
  fi

  if [[ $DRY_RUN -eq 1 ]]; then
    printf '  %s %s\n' "$(yellow 'would')" "curl -fsSL $BUN_INSTALLER_URL | bash"
    return 0
  fi

  warn "bun is not installed. Running its official installer:"
  info "curl -fsSL $BUN_INSTALLER_URL | bash"
  if ! curl -fsSL "$BUN_INSTALLER_URL" | bash >/dev/null 2>&1; then
    err "the bun installer failed."
    info "install it by hand, then re-run: curl -fsSL $BUN_INSTALLER_URL | bash"
    return 1
  fi

  prereqs_adopt_bun_path || {
    err "bun installed but no binary at ~/.bun/bin/bun."
    return 1
  }
  step "bun installed ($(bun --version 2>/dev/null)) and added to PATH for this run"
  info "open a new shell, or source your profile, to keep it on PATH"
  return 0
}

prereqs_install_brew() {
  if command -v brew >/dev/null 2>&1; then
    step "Homebrew already on PATH"
    return 0
  fi
  if prereqs_adopt_brew_path; then
    step "Homebrew found at $(brew --prefix 2>/dev/null) and added to PATH for this run"
    return 0
  fi

  if [[ $DRY_RUN -eq 1 ]]; then
    printf '  %s %s\n' "$(yellow 'would')" "NONINTERACTIVE=1 bash -c \"\$(curl -fsSL $BREW_INSTALLER_URL)\""
    return 0
  fi

  warn "Homebrew is not installed. It is only needed for rtk."
  info "on macOS this needs sudo and may pull the Xcode command line tools (large)."
  info "as root, or with a warm sudo timestamp, it proceeds unattended."
  info "NONINTERACTIVE=1 bash -c \"\$(curl -fsSL $BREW_INSTALLER_URL)\""

  # NONINTERACTIVE=1 suppresses the "press RETURN" gate, which cannot be answered
  # when stdin is the install pipeline. It does NOT supply sudo credentials.
  if ! NONINTERACTIVE=1 bash -c "$(curl -fsSL "$BREW_INSTALLER_URL")" >/dev/null 2>&1; then
    warn "the Homebrew installer did not complete — most likely sudo was needed and unavailable."
    info "install it yourself and re-run this, or skip rtk entirely:"
    info "  /bin/bash -c \"\$(curl -fsSL $BREW_INSTALLER_URL)\""
    info "  ./install.sh --skip rtk"
    return 1
  fi

  prereqs_adopt_brew_path || {
    warn "Homebrew installed but no brew binary found in any known prefix."
    return 1
  }
  step "Homebrew installed at $(brew --prefix 2>/dev/null)"
  return 0
}

prereqs_install() {
  local rc=0

  if ! command -v curl >/dev/null 2>&1; then
    err "curl is required to fetch the bun and Homebrew installers, and is not on PATH."
    return 1
  fi

  # bun first and bun fatal: install.sh cannot merge a settings file without it,
  # so there is no useful partial outcome where bun is missing.
  prereqs_install_bun || return 1

  # brew is best-effort. Its only consumer is the rtk module, which is itself
  # non-fatal, so a machine that ends up without either is still fully protected.
  # rc stays 0 deliberately — a failure here must not fail the module and stop
  # security from running.
  if ! prereqs_install_brew; then
    warn "continuing without Homebrew — rtk will be skipped."
    PROBLEMS=$((PROBLEMS + 1))
  fi

  return $rc
}

prereqs_check() {
  local rc=0

  if command -v bun >/dev/null 2>&1 || prereqs_adopt_bun_path; then
    ok_line "bun $(bun --version 2>/dev/null || echo '(version unknown)')"
  else
    bad_line "bun NOT installed — nothing in this repo can run"; rc=1
  fi

  if command -v brew >/dev/null 2>&1 || prereqs_adopt_brew_path; then
    ok_line "Homebrew at $(brew --prefix 2>/dev/null)"
  else
    note_line "Homebrew not installed — only needed for rtk"
  fi

  return $rc
}

prereqs_uninstall() {
  # Deliberately does nothing. bun and Homebrew are machine-wide toolchains that
  # other work on this machine almost certainly depends on. Removing them because
  # someone uninstalled a Claude Code config would be indefensible.
  info "bun and Homebrew were left installed — they are general toolchains, not ours to remove"
  return 0
}
