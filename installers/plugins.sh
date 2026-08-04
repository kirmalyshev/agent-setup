#!/usr/bin/env bash
#
# plugins.sh — the two Claude Code plugins this repo opts you into.
#
#   caveman      compressed output mode. Installed but DORMANT: its SessionStart
#                hook reads persisted state, so nothing changes until you run
#                /caveman. Nobody is dropped into fragment-speak by an install.
#   code-review  Anthropic's reviewer. Adds /code-review over your working diff.
#
# Both go through `claude plugin`, which owns the marketplace registry and the
# enabledPlugins block in settings.json. This module never edits those files
# itself — the CLI is the only writer, so there is one source of truth and
# `claude plugin uninstall` genuinely undoes what we did.
#
# Non-fatal by design: a network failure here should not cost someone their
# credential guardrails.
#
# OWNERSHIP: uninstall removes only the plugins THIS installer actually
# installed, tracked in <config-dir>/agent-setup.plugins. Without that record the
# two operations are asymmetric — install skips a plugin that is already there,
# uninstall removed it anyway — so someone who already used code-review, tried
# this repo and backed out lost a plugin that predated it.
#
# Each row is  plugin|marketplace|marketplace-source|what it gives you
AGENT_SETUP_PLUGINS=(
  "caveman|caveman|JuliusBrussee/caveman|compressed output mode (/caveman)"
  "code-review|claude-plugins-official|anthropics/claude-plugins-official|/code-review over your diff"
)

plugins_label() { printf 'Claude Code plugins (caveman, code-review)'; }

plugins_field() { printf '%s' "$1" | cut -d'|' -f"$2"; }

plugins_cli() { command -v claude >/dev/null 2>&1; }

# The ownership record: one `plugin@marketplace` id per line, written only after
# an install this run actually performed.
plugins_state_file() { printf '%s/agent-setup.plugins' "$DEST_ROOT"; }

plugins_we_installed() {
  grep -qxF "$1" "$(plugins_state_file)" 2>/dev/null
}

# Append-only and idempotent: re-running the installer must not lose the record
# of a plugin it put there on an earlier run, since that run's install now
# short-circuits on "already installed".
plugins_record() {
  local id="$1" f
  f="$(plugins_state_file)"
  plugins_we_installed "$id" && return 0
  printf '%s\n' "$id" >>"$f"
}

plugins_forget() {
  local id="$1" f tmp
  f="$(plugins_state_file)"
  [[ -f "$f" ]] || return 0
  tmp="$f.$$.tmp"
  grep -vxF "$id" "$f" >"$tmp" 2>/dev/null || :
  if [[ -s "$tmp" ]]; then mv "$tmp" "$f"; else rm -f "$tmp" "$f"; fi
}

# The marketplace registry lives INSIDE the config dir, so every read of it has
# to be scoped the same way every write is. Reading the unscoped registry made
# this report "already configured" from the operator's own ~/.claude while the
# install then failed against a target dir that had no marketplaces at all.
#
# The match is anchored on the `❯ <name>` line `marketplace list` prints, not a
# bare substring: a plain grep for "caveman" also hits a URL containing it, and
# a false positive here skips the add and breaks the install underneath it.
plugins_ensure_marketplace() {
  local name="$1" source="$2" out
  # Even the read has to be skipped under --dry-run. `claude plugin marketplace
  # list` creates the config dir and a .claude.json inside it as a side effect,
  # so asking the question was enough to break the "changes nothing" contract on
  # a path that did not exist yet.
  if [[ $DRY_RUN -eq 1 ]]; then
    printf '  %s %s\n' "$(yellow 'would')" "ensure marketplace $name ($source) is configured"
    return 0
  fi
  if CLAUDE_CONFIG_DIR="$DEST_ROOT" claude plugin marketplace list 2>/dev/null |
       grep -qE "^[^A-Za-z0-9]*${name}[[:space:]]*$"; then
    step "marketplace $name already configured"
    return 0
  fi
  step "adding marketplace $name ($source)"
  if ! out="$(CLAUDE_CONFIG_DIR="$DEST_ROOT" claude plugin marketplace add "$source" 2>&1)"; then
    err "could not add marketplace $source"
    printf '%s\n' "$out" | tail -3 | sed 's/^/       /' >&2
    return 1
  fi
  return 0
}

# plugins_installed <plugin@marketplace> — true when present AND enabled.
# Installed-but-disabled is the failure the naive check misses: the files are on
# disk, `list` names it, and none of its hooks or commands are ever loaded.
plugins_installed() {
  local id="$1"
  # `claude plugin list` initialises the config dir as a side effect — it creates
  # the dir, a .claude.json inside it, and a backups/ copy of that file. So this
  # read is a write, and --check ran it under a banner promising "this mode
  # changes nothing".
  #
  # Guarding only on the dir fixed half of it: a dir that exists but has never
  # run Claude Code — exactly what `--only onboarding` leaves behind — still got
  # initialised by the check that was reporting it as empty.
  #
  # Plugin state lives in <config>/plugins (installed_plugins.json,
  # known_marketplaces.json) plus enabledPlugins in settings.json. With no
  # plugins dir the CLI returns [] , so the answer is already known and asking
  # buys nothing but the side effect. Where the dir does exist, Claude Code has
  # run there, .claude.json is present, and the call writes nothing — measured,
  # not assumed.
  [[ -d "$DEST_ROOT/plugins" ]] || return 1
  CLAUDE_CONFIG_DIR="$DEST_ROOT" claude plugin list --json 2>/dev/null | bun -e '
    let raw = "";
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => {
      const want = process.argv[1];
      let list = [];
      try { list = JSON.parse(raw); } catch { process.exit(1); }
      const hit = list.find((p) => p.id === want);
      process.exit(hit && hit.enabled !== false ? 0 : 1);
    });
  ' "$id"
}

plugins_install() {
  if ! plugins_cli; then
    warn "the \`claude\` CLI was not found on PATH — skipping plugins."
    info "install Claude Code, then re-run this installer."
    return 1
  fi

  local rc=0 row plugin marketplace source desc id out
  for row in "${AGENT_SETUP_PLUGINS[@]}"; do
    plugin="$(plugins_field "$row" 1)"
    marketplace="$(plugins_field "$row" 2)"
    source="$(plugins_field "$row" 3)"
    desc="$(plugins_field "$row" 4)"
    id="$plugin@$marketplace"

    if [[ $DRY_RUN -eq 0 ]] && plugins_installed "$id"; then
      step "$id already installed — $desc"
      continue
    fi

    plugins_ensure_marketplace "$marketplace" "$source" || { rc=1; continue; }

    if [[ $DRY_RUN -eq 1 ]]; then
      printf '  %s %s\n' "$(yellow 'would')" "claude plugin install $id --scope user  — $desc"
      continue
    fi
    step "installing $id — $desc"

    # Keep the CLI's own error text. Swallowing it into /dev/null turned every
    # cause — no marketplace, no network, a renamed plugin — into the same
    # unactionable "could not install", which is the last thing a newcomer needs.
    if ! out="$(CLAUDE_CONFIG_DIR="$DEST_ROOT" claude plugin install "$id" --scope user 2>&1)"; then
      err "could not install $id"
      printf '%s\n' "$out" | tail -3 | sed 's/^/       /' >&2
      rc=1
      continue
    fi

    if plugins_installed "$id"; then
      # Recorded only on the path where this run did the installing. The
      # "already installed" branch above deliberately does not reach here.
      plugins_record "$id"
      step "$id installed and enabled"
    else
      err "$id installed but is not enabled — run: claude plugin enable $id"
      rc=1
    fi
  done

  return $rc
}

plugins_check() {
  if ! plugins_cli; then
    bad_line "the \`claude\` CLI is not on PATH"
    return 1
  fi

  local rc=0 row id
  for row in "${AGENT_SETUP_PLUGINS[@]}"; do
    id="$(plugins_field "$row" 1)@$(plugins_field "$row" 2)"
    if plugins_installed "$id"; then
      ok_line "plugin enabled: $id"
    else
      bad_line "plugin missing or disabled: $id"; rc=1
    fi
  done

  # caveman is installed dormant on purpose; say so, so a quiet session does not
  # read as a broken install.
  note_line "caveman stays off until you run /caveman — installing it changes nothing on its own"

  return $rc
}

plugins_uninstall() {
  plugins_cli || { warn "the \`claude\` CLI is not on PATH — nothing to remove"; return 0; }

  local state row id
  state="$(plugins_state_file)"

  # No record at all means either nothing was installed from here, or the
  # install predates ownership tracking. Uninstalling is destructive and this
  # script cannot tell those apart, so it declines and hands the decision over
  # rather than guessing in the direction that deletes someone's plugin.
  if [[ ! -f "$state" ]]; then
    warn "no ownership record at $state — leaving all plugins alone."
    info "this installer only removes plugins it installed itself. To remove them by hand:"
    for row in "${AGENT_SETUP_PLUGINS[@]}"; do
      info "  claude plugin uninstall $(plugins_field "$row" 1)@$(plugins_field "$row" 2)"
    done
    return 0
  fi

  for row in "${AGENT_SETUP_PLUGINS[@]}"; do
    id="$(plugins_field "$row" 1)@$(plugins_field "$row" 2)"

    if ! plugins_we_installed "$id"; then
      warn "$id was already installed before agent-setup — left in place"
      continue
    fi

    if [[ $DRY_RUN -eq 1 ]]; then
      printf '  %s %s\n' "$(yellow 'would')" "claude plugin uninstall $id"
      continue
    fi

    if CLAUDE_CONFIG_DIR="$DEST_ROOT" claude plugin uninstall "$id" >/dev/null 2>&1; then
      plugins_forget "$id"
      step "$id uninstalled"
    else
      warn "$id could not be removed — the ownership record is kept so a retry still knows it is ours"
    fi
  done

  # The marketplaces are left configured. They are shared global state that
  # predates this repo on most machines, and removing one would silently break
  # any other plugin a user installed from it.
  info "marketplaces left configured — remove with: claude plugin marketplace remove <name>"
  return 0
}
