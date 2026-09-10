# ValidateSkill Workflow

**Purpose:** Check if an existing skill follows the canonical structure with proper TitleCase naming.

---

## Step 1: Read the Authoritative Source

Read CreateSkill's `SKILL.md` — it is the canonical structure.

---

## Step 2: Read the Target Skill

```
<skills-dir>/[SkillName]/SKILL.md
```

---

## Step 3: Check TitleCase Naming

### Skill Directory
```bash
ls <skills-dir>/ | grep -i [skillname]
```

Verify TitleCase:
- ✓ `RootCauseAnalysis`, `Council`, `CreateSkill`
- ✗ `createskill`, `create-skill`, `CREATE_SKILL`

### Workflow Files
```bash
ls <skills-dir>/[SkillName]/Workflows/
```

Verify TitleCase:
- ✓ `Create.md`, `UpdateInfo.md`, `SyncRepo.md`
- ✗ `create.md`, `update-info.md`, `SYNC_REPO.md`

### Tool Files
```bash
ls <skills-dir>/[SkillName]/Tools/ 2>/dev/null
```

Verify TitleCase:
- ✓ `ManageServer.ts`, `ManageServer.help.md`
- ✗ `manage-server.ts`, `MANAGE_SERVER.ts`

---

## Step 4: Check YAML Frontmatter

Verify the YAML has:

### Single-Line Description with USE WHEN
```yaml
---
name: SkillName
description: [What it does]. USE WHEN [intent triggers using OR]. [Additional capabilities].
---
```

**Check for violations:**
- Multi-line description using `|` (WRONG)
- Missing `USE WHEN` keyword (WRONG)
- Separate `triggers:` array in YAML (OLD FORMAT - WRONG)
- Separate `workflows:` array in YAML (OLD FORMAT - WRONG)
- `name:` not in TitleCase (WRONG)

---

## Step 5: Check Markdown Body

Verify the body has:

### Workflow Routing Section
```markdown
## Workflow Routing

| Workflow | Trigger | File |
|----------|---------|------|
| **WorkflowOne** | "trigger phrase" | `Workflows/WorkflowOne.md` |
```

**Check for violations:**
- Missing `## Workflow Routing` section
- Workflow names not in TitleCase
- File paths not matching actual file names

### Examples Section
````markdown
## Examples

**Example 1: [Use case]**
```
User: "[Request]"
→ [Action]
→ [Result]
```
````

**Check:** Examples section required (WRONG if missing)

### Gotchas Section
```markdown
## Gotchas

[Known failure modes, API quirks, common mistakes]
```

**Check:** Gotchas section required (WRONG if missing). This is the highest information density in any skill — Anthropic's internal best practice.

### Negative Triggers (for skills with confusable neighbors)

**Check:** If the skill shares vocabulary with other skills, description should include `NOT FOR` clause:
```yaml
description: ... USE WHEN [triggers]. NOT FOR [what this ISN'T for (use SkillName instead)].
```

Common confusable pairs to check: RootCauseAnalysis vs SystemsThinking (one incident vs a recurring structure), RedTeam vs Council (attack vs debate), CreateSkill vs BitterPillEngineering (skill lifecycle vs over-prompting audit).

---

## Step 5a: Shareable Content Gate

Every skill body must be shareable (see `## Shareable Content` in CreateSkill's SKILL.md). Run `/security-scan <skills-dir>/[SkillName]`, then:

```bash
grep -rnE '/Users/|/home/' <skills-dir>/[SkillName]
```

**Both clean = PASS.** Any finding = FAIL: move the value to a config file the skill reads at run time, or to an env var the skill names. The scanner catches credential shapes only, so also read the skill through for:
- Real names of people, customers, or internal products
- Private domains, hostnames, internal URLs, private repo paths
- Customer data or customer-specific workflows

---

## Step 5b: BPE Compliance Check

Apply the bitter lesson test to the skill's instructions:

- [ ] Each instruction provides knowledge Claude can't derive on its own
- [ ] No instructions compensating for model limitations (format enforcement, CoT scaffolding)
- [ ] Deterministic scripts used where possible instead of prompt-based workarounds
- [ ] SKILL.md is under 500 lines (large skills should use References/ or root context files)

---

## Step 5c: Official-Spec Drift Check (advisory)

The canonical format lives in CreateSkill's `SKILL.md`, but the format it encodes is Anthropic's — and Anthropic revises it. Check the official surface so local doctrine can't silently drift from what the harness actually parses:

- **Agent Skills docs:** https://code.claude.com/docs/en/skills
- **Reference skills repo:** https://github.com/anthropics/skills

Fetch the docs page and compare its frontmatter contract (recognized fields, description limits, loading behavior) against what CreateSkill's `SKILL.md` and this workflow assert. Report any divergence as a finding with both sources quoted — drift here is a finding about OUR doctrine, not the skill under validation.

This step is advisory: an unreachable URL gets a `⏳ skipped (unreachable)` note and validation continues; drift is reported to the user, never auto-adopted.

---

## Step 6: Check Workflow Files

```bash
ls <skills-dir>/[SkillName]/Workflows/
```

Verify:
- Every file uses TitleCase naming
- Every file has a corresponding entry in `## Workflow Routing` section
- Every routing entry points to an existing file
- Routing table names match file names exactly

---

## Step 7: Check Structure

```bash
ls -la <skills-dir>/[SkillName]/
```

Verify:
- No backup copies inside the skills directory
- Reference docs at skill root or in `References/` (not in Workflows/)
- `Tools/` present only if it holds tools

---

## Step 7a: Check CLI-First Integration (for skills with CLI tools)

**If the skill has CLI tools in `Tools/`:**

### CLI Tool Configuration Flags

Check each tool for flag-based configuration:
```bash
bun <skills-dir>/[SkillName]/Tools/[ToolName].ts --help
```

Verify the tool exposes behavioral configuration via flags:
- Mode flags (--fast, --thorough, --dry-run) where applicable
- Output flags (--format, --quiet, --verbose)
- Resource flags (--model, etc.) if applicable
- Post-processing flags if applicable

### Workflow Intent-to-Flag Mapping

For workflows that call CLI tools, check for intent-to-flag mapping tables:

```bash
grep -l "Intent-to-Flag" <skills-dir>/[SkillName]/Workflows/*.md
```

**Required pattern in workflows with CLI tools:**
```markdown
## Intent-to-Flag Mapping

| User Says | Flag | When to Use |
|-----------|------|-------------|
| "fast" | `--model haiku` | Speed priority |
| (default) | `--model sonnet` | Balanced |
```

---

## Step 8: Report Results

**COMPLIANT** if all checks pass:

### Naming (TitleCase)
- [ ] Skill directory uses TitleCase
- [ ] All workflow files use TitleCase
- [ ] All reference docs use TitleCase
- [ ] All tool files use TitleCase
- [ ] Routing table names match file names

### YAML Frontmatter
- [ ] `name:` uses TitleCase
- [ ] `description:` is single-line with `USE WHEN`
- [ ] No separate `triggers:` or `workflows:` arrays
- [ ] Description under 1024 characters

### Markdown Body
- [ ] `## Workflow Routing` section present
- [ ] `## Gotchas` section present with known failure modes
- [ ] `## Examples` section with 2-3 patterns
- [ ] All workflows have routing entries
- [ ] SKILL.md under 500 lines

### Content Quality (Anthropic Best Practices)
- [ ] Description includes `NOT FOR` clause if confusable with other skills
- [ ] Instructions focus on what breaks Claude's defaults (not stating the obvious)
- [ ] No instructions compensating for model limitations (BPE check)
- [ ] Appropriate degrees of freedom (specific for fragile tasks, flexible for safe ones)

### Shareable Content
- [ ] No sensitive content (API keys, tokens, credentials, private URLs)
- [ ] No personal references (author name, internal project or customer names, private domains, user-specific absolute paths)
- [ ] `/security-scan` and the home-path grep both come back clean
- [ ] Per-user values (if any) live in a config file or env var, not the skill body

### Structure
- [ ] No backup copies inside the skills directory
- [ ] `Tools/` present only if it holds tools
- [ ] `References/` used appropriately for large skills

### CLI-First Integration (for skills with CLI tools)
- [ ] CLI tools expose configuration via flags (not hardcoded)
- [ ] Workflows that call CLI tools have intent-to-flag mapping tables
- [ ] Flag mappings cover mode, output, and resource selection where applicable

**NON-COMPLIANT** if any check fails. Recommend using CanonicalizeSkill workflow.
