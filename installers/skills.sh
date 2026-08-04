#!/usr/bin/env bash
#
# skills.sh — the workflow skills: named procedures you invoke by name, none of
#             which run unless you ask for them.
#
# These used to be installed by security.sh alongside the two guardrail skills.
# They were split out because bundling them made the security module's yes/no
# dishonest: declining nine skills also declined the credential protection,
# which is not a trade anyone should be offered. See GUARDRAIL_SKILLS in
# common.sh for where the line sits.
#
# Non-fatal, and genuinely optional. A skill costs nothing until invoked — it is
# a file on disk that the model reads when you name it — so the honest pitch is
# "these are useful, and skipping them changes nothing else."
#
# What it touches:
#   <config-dir>/skills/<skill>  → one symlink per workflow skill

skills_label() { printf 'workflow skills (postmortems, stress-tests, doc style)'; }

# Every skill in the checkout that is not a guardrail skill. Derived rather than
# listed, so adding a skill to the repo lands it in the right bucket without a
# second edit here.
skills_names() {
  local s
  while IFS= read -r s; do
    list_has "$GUARDRAIL_SKILLS" "$s" || printf '%s\n' "$s"
  done < <(all_skill_names)
  return 0
}

skills_install() {
  if [[ -z "$(skills_names)" ]]; then
    warn "no workflow skills found in $SRC_CLAUDE/skills"
    return 0
  fi

  ensure_baseline_link || return 1
  skills_names | link_skill_list
  return 0
}

skills_check() {
  local rc=0
  if [[ -z "$(skills_names)" ]]; then
    note_line "no workflow skills in this checkout"
    return 0
  fi
  skills_names | check_skill_list || rc=1
  return $rc
}

skills_uninstall() {
  skills_names | unlink_skill_list
  return 0
}
