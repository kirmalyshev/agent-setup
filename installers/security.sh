#!/usr/bin/env bash
#
# security.sh — the credential guardrails: four Claude Code hooks, the two
#               guardrail skills, and the /security-scan command.
#
# This is the module that must not fail quietly. Everything else in this repo
# makes an agent cheaper or terser; this is the only part that stands between
# an agent and a credential store, so install.sh treats a failure here as fatal
# while the other modules only warn.
#
# Symlink install: <config-dir>/agent-setup points at this checkout's .claude, so
# `git pull` ships an updated pattern catalog with no re-run. The cost is that
# moving or deleting the checkout breaks the hooks, which --check detects.
#
# What it touches, and nothing else:
#   <config-dir>/agent-setup               → symlink to <repo>/.claude
#   <config-dir>/skills/<guardrail skill>  → symlink per skill (two of them)
#   <config-dir>/commands/security-scan.md → symlink
#   <config-dir>/settings.json             → four hook entries (backed up first)
#
# The other seven skills are skills.sh. See GUARDRAIL_SKILLS in common.sh for
# why the line is drawn there.

security_label() { printf 'security guardrails (hooks, 2 skills, /security-scan)'; }

# The guardrail skills present in this checkout, one per line. Filtered against
# what is actually on disk rather than printed from the list, so a rename that
# lands in one place and not the other surfaces as a missing skill instead of a
# link to nothing.
security_skills() {
  local s
  while IFS= read -r s; do
    list_has "$GUARDRAIL_SKILLS" "$s" && printf '%s\n' "$s"
  done < <(all_skill_names)
  return 0
}

# register_in <settings-file> <label> — merge the four hook entries.
security_register_in() {
  local target="$1" label="$2"
  local hooks_dir="$DEST_LINK/hooks"
  if [[ $DRY_RUN -eq 1 ]]; then
    printf '  %s %s\n' "$(yellow 'would')" "register in $label"
    bun "$SRC_CLAUDE/scripts/merge-settings.ts" --install \
      --hooks-dir "$hooks_dir" --settings "$target" --dry-run | sed 's/^/  /'
    return 0
  fi
  printf '  %s\n' "$(bold "→ $label")"
  bun "$SRC_CLAUDE/scripts/merge-settings.ts" --install \
    --hooks-dir "$hooks_dir" --settings "$target" | sed 's/^/  /'
}

security_install() {
  if [[ ! -d "$SRC_CLAUDE/hooks" ]]; then
    err "no .claude/hooks in $REPO_DIR — run this from the repo root."
    return 1
  fi

  ensure_baseline_link || return 1

  security_skills | link_skill_list

  if [[ -f "$SRC_CLAUDE/commands/security-scan.md" ]]; then
    link_into "$DEST_LINK/commands/security-scan.md" \
      "$DEST_ROOT/commands/security-scan.md" "command /security-scan"
  fi

  if ! security_register_in "$SETTINGS_FILE" "$SETTINGS_FILE"; then
    err "settings registration failed — nothing else was changed."
    return 1
  fi

  # Seed the live file as well, so the guards are enforced NOW rather than after
  # a settings generator next runs. If that file is regenerated these entries are
  # discarded and the ones in the source file take over — the two converge. If it
  # is not regenerated, both carry the entries and re-running dedupes each by the
  # ownership marker. Either way the window where nothing is enforced closes.
  if [[ $SEED_LIVE -eq 1 ]]; then
    if [[ -f "$LIVE_SETTINGS" || $DRY_RUN -eq 1 ]]; then
      security_register_in "$LIVE_SETTINGS" "$LIVE_SETTINGS  (live file — bootstrap)" ||
        PROBLEMS=$((PROBLEMS + 1))
    else
      warn "no live settings file at $LIVE_SETTINGS — nothing to bootstrap"
    fi
  fi

  [[ $DRY_RUN -eq 1 ]] && return 0
  security_verify
}

# The verification that matters. Two layers, because each proves something the
# other cannot.
security_verify() {
  local rc=0

  # 1. The catalog and guards are correct. Runs from the checkout with the
  #    battery's own pinned config, so it proves the CODE is sound.
  #
  # mktemp, not /tmp/<name>.$$ — /tmp is world-writable and a pid is guessable,
  # so a predictable name is pre-creatable as a symlink pointing at a file this
  # then truncates. A security installer should not be the thing that does that.
  #
  # The template is spelled out rather than using `mktemp -t PREFIX`: that form
  # is BSD-only. GNU coreutils reads -t as "TEMPLATE is relative to TMPDIR" and
  # rejects a template with no X's, so the BSD spelling worked on macOS and
  # failed every Linux run with "could not create a temp file" — which, since
  # security is the fatal module, took the whole install down with it.
  local out
  out="$(mktemp "${TMPDIR:-/tmp}/agent-setup-install-check.XXXXXX")" ||
    { err "could not create a temp file"; return 1; }
  if "$SRC_CLAUDE/scripts/run-security-checks.sh" >"$out" 2>&1; then
    step "$(tail -1 "$out" | tr -d '\033' | sed 's/\[[0-9]*m//g')"
    rm -f "$out"
  else
    err "the check battery FAILED — the hooks are registered but not trustworthy."
    printf '     full output: %s\n' "$out" >&2
    tail -15 "$out" >&2
    rc=1
  fi

  # 2. The INSTALLATION is live. Step 1 alone proved nothing about it: it runs
  #    the repo copy with an isolated config, so a broken symlink, an unwritten
  #    settings.json, or a config dir that resolves elsewhere would all still
  #    pass. This drives the installed entry point, through the symlink, with
  #    the real config resolution — the same way a session will.
  local probe_out probe_rc probe_ok=0
  probe_out="$(printf '{"hook_event_name":"PreToolUse","tool_name":"Read","tool_input":{"file_path":"/probe/.env"}}' \
    | CLAUDE_CONFIG_DIR="$DEST_ROOT" bun "$DEST_LINK/hooks/PreToolSecurity.hook.ts" 2>&1)"
  probe_rc=$?
  # The accepted outcomes are narrow ON PURPOSE. Accepting `output contains
  # "agent-setup"` would also be satisfied by a DANGLING symlink: bun's own
  # "module not found" error quotes the path, which contains `agent-setup/`. Only a
  # real decision counts — exit 2 (deny), or exit 0 carrying a permission
  # decision or a warn prefix for the non-blocking postures. Anything else,
  # including bun's exit 1, is a failure.
  if [[ $probe_rc -eq 2 ]]; then
    probe_ok=1
  elif [[ $probe_rc -eq 0 ]] && [[ "$probe_out" == *permissionDecision* || "$probe_out" == *"[agent-setup]"* ]]; then
    probe_ok=1
  fi
  if [[ $probe_ok -eq 1 ]]; then
    step "installed hook returned a real decision through $LINK_NAME/ (exit $probe_rc)"
  else
    err "the INSTALLED hook did not react to a .env read (exit $probe_rc)."
    printf '     probed: %s\n' "$DEST_LINK/hooks/PreToolSecurity.hook.ts" >&2
    printf '     a dangling link, an unreadable config, or a posture of "audit"\n' >&2
    printf '     with sessionNotice off can all produce this.\n' >&2
    [[ -n "$probe_out" ]] && printf '     output: %s\n' "${probe_out:0:200}" >&2
    rc=1
  fi

  # The audit log is part of the contract; a decision that leaves no row is a bug.
  local probe_log="$DEST_ROOT/security/agent-setup/audit.jsonl"
  if [[ -s "$probe_log" ]]; then
    step "audit trail is writable ($probe_log)"
  else
    warn "no audit row at $probe_log — check directory permissions"
  fi

  # Registration actually landed in the file we targeted.
  if bun "$SRC_CLAUDE/scripts/merge-settings.ts" --check \
       --hooks-dir "$DEST_LINK/hooks" --settings "$SETTINGS_FILE" >/dev/null 2>&1; then
    step "all four events registered in $(basename "$SETTINGS_FILE")"
  else
    err "hooks are NOT registered in $SETTINGS_FILE after install."
    rc=1
  fi

  return $rc
}

security_check() {
  local rc=0

  if [[ -L "$DEST_LINK" ]]; then
    local tgt
    tgt="$(readlink "$DEST_LINK")"
    if [[ -d "$DEST_LINK" ]]; then
      ok_line "baseline link → $tgt"
    else
      bad_line "baseline link is DANGLING → $tgt"
      info "the checkout moved or was deleted; re-run ./install.sh from its new location."
      rc=1
    fi
  else
    bad_line "not installed (no $DEST_LINK)"
    rc=1
  fi

  security_skills | check_skill_list || rc=1

  if bun "$SRC_CLAUDE/scripts/merge-settings.ts" --check \
       --hooks-dir "$DEST_LINK/hooks" --settings "$SETTINGS_FILE" >/dev/null 2>&1; then
    ok_line "registered in $SETTINGS_FILE"
  else
    bad_line "NOT registered in $SETTINGS_FILE — run ./install.sh"; rc=1
  fi

  # Registration in a generator SOURCE says nothing about what is enforced right
  # now. The live file is the only thing a session reads, so it is reported
  # separately — "registered" and "enforcing" are different claims, and only the
  # second protects anything.
  if [[ $SEED_LIVE -eq 1 ]]; then
    if bun "$SRC_CLAUDE/scripts/merge-settings.ts" --check \
         --hooks-dir "$DEST_LINK/hooks" --settings "$LIVE_SETTINGS" >/dev/null 2>&1; then
      ok_line "LIVE and enforcing now: $LIVE_SETTINGS"
    else
      note_line "NOT enforcing yet: $LIVE_SETTINGS"
      info "the entries exist in the source file but not in the file sessions read."
      info "They apply after the generator runs (start a new session), or now via"
      info "./install.sh --config-dir $DEST_ROOT --settings-file $SETTINGS_FILE"
    fi
  fi

  printf '  posture: %s\n' "$(bun -e '
    const p = require("node:path");
    const f = p.join(process.argv[1], "security.config.json");
    try { console.log(JSON.parse(require("node:fs").readFileSync(f,"utf8")).posture ?? "balanced"); }
    catch { console.log("unreadable"); }
  ' "$SRC_CLAUDE")"

  return $rc
}

security_uninstall() {
  local target
  for target in "$SETTINGS_FILE" $([[ $SEED_LIVE -eq 1 ]] && printf '%s' "$LIVE_SETTINGS"); do
    [[ -f "$target" ]] || continue
    if [[ $DRY_RUN -eq 1 ]]; then
      bun "$SRC_CLAUDE/scripts/merge-settings.ts" --uninstall --settings "$target" --dry-run | sed 's/^/  /'
    else
      bun "$SRC_CLAUDE/scripts/merge-settings.ts" --uninstall --settings "$target" | sed 's/^/  /'
    fi
  done

  security_skills | unlink_skill_list

  unlink_if_ours "$DEST_ROOT/commands/security-scan.md" "command /security-scan"
  # The baseline link is NOT removed here any more. Three modules link through
  # it now, so tearing it down from inside one of them left the other two
  # dangling under `--only security --uninstall`. install.sh removes it after
  # every selected module has run, and only when all of them were selected.
  return 0
}
