# CreateSkill Workflow

Create a new skill following the canonical structure with proper TitleCase naming.

## Step 1: Read the Authoritative Sources

1. Read CreateSkill's `SKILL.md` — it is the convention.
2. Read a canonical example skill — `RootCauseAnalysis/SKILL.md` or `SystemsThinking/SKILL.md` — and study its frontmatter, workflow routing, examples, and gotchas sections.

## Step 2: Understand the Request

Ask the user:
1. What does this skill do?
2. What should trigger it?
3. What workflows does it need?
4. Project skill (`.claude/skills/` in a repo, shared with the team) or personal skill (`~/.claude/skills/`)?

## Step 2a: Identify Skill Type

Classify the skill using the 9 Anthropic skill types (see Skill Types table in SKILL.md):

| # | Type | Key Structural Pattern |
|---|------|----------------------|
| 1 | Library/API Reference | Gotchas-heavy, reference snippets |
| 2 | Product Validation | Browser/tmux, state assertions |
| 3 | Data Fetching | Credentials, query patterns |
| 4 | Business Process | Execution logs, consistency |
| 5 | Code Scaffolding | Templates, project-aware scripts |
| 6 | Code Quality | Deterministic scripts, hook integration |
| 7 | CI/CD & Deployment | Safety gates, rollback, smoke tests |
| 8 | Operations Runbook | Phenomenon → diagnosis → report |
| 9 | Infrastructure Ops | Safety guardrails, audit logging |

The type informs structure decisions — e.g., Type 1 skills are mostly gotchas, Type 7 needs safety gates.

## Step 2b: BPE Check

Before building, apply the bitter lesson test: **"Would a smarter model make this skill unnecessary?"**

- If the skill provides knowledge Claude can't derive (API quirks, org decisions) → **proceed**
- If the skill provides tools Claude can't replicate (API calls, automation) → **proceed**
- If the skill just orchestrates Claude's reasoning → **question whether it's needed**

## Step 3: Determine TitleCase Names

**All names must use TitleCase (PascalCase).**

| Component | Format | Example |
|-----------|--------|---------|
| Skill directory | TitleCase | `RootCauseAnalysis`, `ReleaseNotes`, `CreateSkill` |
| Workflow files | TitleCase.md | `Create.md`, `UpdateInfo.md` |
| Reference docs | TitleCase.md | `ProsodyGuide.md`, `ApiReference.md` |
| Tool files | TitleCase.ts | `ManageServer.ts` |
| Help files | TitleCase.help.md | `ManageServer.help.md` |

**Wrong naming (NEVER use):**
- `create-skill`, `create_skill`, `CREATESKILL` → Use `CreateSkill`
- `create.md`, `CREATE.md`, `create-info.md` → Use `Create.md`, `CreateInfo.md`

## Step 4: Create the Skill Directory

```bash
mkdir -p <skills-dir>/[SkillName]/Workflows
```

**Example:**
```bash
mkdir -p .claude/skills/ReleaseNotes/Workflows
```

Add `Tools/` when the skill gets its first tool. Git does not track empty directories, so an empty `Tools/` never reaches anyone else anyway.

## Step 5: Create SKILL.md

Follow this exact structure:

````markdown
---
name: SkillName
version: 1.0.0
description: [What it does]. USE WHEN [intent triggers using OR]. NOT FOR [confusable alternatives]. [Additional capabilities].
---

# SkillName

[Brief description]

## Workflow Routing

| Workflow | Trigger | File |
|----------|---------|------|
| **WorkflowOne** | "trigger phrase" | `Workflows/WorkflowOne.md` |
| **WorkflowTwo** | "another trigger" | `Workflows/WorkflowTwo.md` |

## Examples

**Example 1: [Common use case]**
```
User: "[Typical user request]"
→ Invokes WorkflowOne workflow
→ [What skill does]
→ [What user gets back]
```

**Example 2: [Another use case]**
```
User: "[Different request]"
→ [Process]
→ [Output]
```

## Gotchas

[Known failure modes, API quirks, common mistakes — accumulate over time]

## [Additional Documentation]

[Any other relevant info]
````

**For large skills (>500 lines):** Consider adding a `References/` subdirectory for detailed API docs, extensive examples, or troubleshooting guides. Keep SKILL.md as a routing guide.

## Step 6: Shareable Content Check (MANDATORY)

Every skill body gets shared. Write generic from the start — do not rely on a scrub at share time. The full rule is `## Shareable Content` in CreateSkill's SKILL.md.

### Required

1. **No sensitive content** — no API keys, tokens, credentials, private URLs, auth secrets, private data
2. **No personal references** — no author name, no internal project or customer names, no private domains, no first-person war stories, no user-specific absolute paths like `/Users/<name>/...`
3. **Generic framing** — "someone reports a bug" over "<author-name> reports a bug"; "your web project" over a named internal site; "a common root cause" over a specific incident

### Where Personal Context Belongs

User-specific preferences, project names, domain lists, and account IDs go in a config file the skill reads at run time, kept outside the skill directory. Credentials go in env vars — the skill names the variable, never the value. A skill that cannot work without private context is a personal skill: put it in `~/.claude/skills/`, not a shared repo.

### Pre-Flight Gate

Run `/security-scan <skills-dir>/[SkillName]`, then:

```bash
grep -rnE '/Users/|/home/' <skills-dir>/[SkillName]
```

Both clean = ready. `/security-scan` catches credential shapes only — read the skill through once for real names, hostnames, and customer context.

## Step 7: Create Workflow Files

For each workflow in the routing section:

```bash
touch <skills-dir>/[SkillName]/Workflows/[WorkflowName].md
```

### Workflow-to-Tool Integration (REQUIRED for workflows with CLI tools)

**If a workflow calls a CLI tool, it MUST include intent-to-flag mapping tables.**

This pattern translates natural language user requests into appropriate CLI flags:

````markdown
## Intent-to-Flag Mapping

### Model/Mode Selection

| User Says | Flag | When to Use |
|-----------|------|-------------|
| "fast", "quick", "draft" | `--model haiku` | Speed priority |
| (default), "best", "high quality" | `--model opus` | Quality priority |

### Output Options

| User Says | Flag | Effect |
|-----------|------|--------|
| "JSON output" | `--format json` | Machine-readable |
| "detailed" | `--verbose` | Extra information |

## Execute Tool

Based on user request, construct the CLI command:

```bash
bun ToolName.ts \
  [FLAGS_FROM_INTENT_MAPPING] \
  --required-param "value"
```
````

**Why this matters:**
- Tools have rich configuration via flags
- Workflows should expose this flexibility, not hardcode single patterns
- Users speak naturally; workflows translate to precise CLI

**Examples (TitleCase):**
```bash
touch .claude/skills/ReleaseNotes/Workflows/Draft.md
touch .claude/skills/ReleaseNotes/Workflows/Publish.md
touch ~/.claude/skills/MyBlog/Workflows/Create.md
```

## Step 8: Verify TitleCase

Run this check:
```bash
ls <skills-dir>/[SkillName]/
ls <skills-dir>/[SkillName]/Workflows/
ls <skills-dir>/[SkillName]/Tools/ 2>/dev/null
```

Verify ALL files use TitleCase:
- `SKILL.md` ✓ (exception - always uppercase)
- `WorkflowName.md` ✓
- `ToolName.ts` ✓
- `ToolName.help.md` ✓

## Step 9: Final Checklist

### Naming (TitleCase)
- [ ] Skill directory uses TitleCase (e.g., `RootCauseAnalysis`, `ReleaseNotes`)
- [ ] All workflow files use TitleCase (e.g., `Create.md`, `UpdateInfo.md`)
- [ ] All reference docs use TitleCase (e.g., `ProsodyGuide.md`)
- [ ] All tool files use TitleCase (e.g., `ManageServer.ts`)
- [ ] Routing table workflow names match file names exactly

### YAML Frontmatter
- [ ] `name:` uses TitleCase
- [ ] `description:` is single-line with embedded `USE WHEN` clause
- [ ] Description includes `NOT FOR` clause if skill has confusable neighbors
- [ ] No separate `triggers:` or `workflows:` arrays
- [ ] Description uses intent-based language
- [ ] Description is under 1024 characters

### Markdown Body
- [ ] `## Workflow Routing` section with table format
- [ ] All workflow files have routing entries
- [ ] `## Gotchas` section present with known failure modes
- [ ] `## Examples` section with 2-3 concrete usage patterns
- [ ] SKILL.md under 500 lines (extract to References/ or root files if over)

### Structure
- [ ] `Tools/` present only if the skill has tools
- [ ] No backup copies inside the skills directory
- [ ] `References/` used for large skills with extensive reference material

### BPE Compliance
- [ ] Skill provides knowledge Claude can't derive on its own
- [ ] No instructions compensating for model limitations
- [ ] Skill type identified (see Skill Types table in SKILL.md)

### Shareable Content
- [ ] No sensitive content (API keys, tokens, credentials, private URLs)
- [ ] No personal references (author name, internal project or customer names, private domains, user-specific paths)
- [ ] Generic framing throughout
- [ ] `/security-scan` and the home-path grep both come back clean

### CLI-First Integration (for skills with CLI tools)
- [ ] CLI tools expose configuration via flags
- [ ] Workflows that call CLI tools have intent-to-flag mapping tables
- [ ] Flag mappings cover: mode selection, output options, post-processing (where applicable)

### Registration
- [ ] Any hand-maintained list of skills in the repo is updated (see Gotchas in SKILL.md — agent-setup keeps several)

## Step 10: Suggest Effectiveness Testing

After creating the skill, suggest to the user:

> "The skill structure is ready. Want me to **test it** to see if it actually improves outcomes? I can run it against real prompts and compare with a no-skill baseline using the TestSkill workflow."

If the user agrees, invoke `Workflows/TestSkill.md`.

If the description needs tuning, suggest `Workflows/OptimizeDescription.md`.

## Step 11: Version

A new skill starts at `version: 1.0.0`. Later edits hand-bump it per the `## Versioning` rubric in SKILL.md.

## Done

Skill created following canonical structure with proper TitleCase naming throughout.
