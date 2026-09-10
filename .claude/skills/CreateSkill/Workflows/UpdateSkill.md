# UpdateSkill Workflow

**Purpose:** Add workflows or modify an existing skill while maintaining canonical structure and TitleCase naming.

---

## Step 1: Read the Authoritative Source

Read CreateSkill's `SKILL.md` — it is the canonical structure.

---

## Step 2: Read the Current Skill

```
<skills-dir>/[SkillName]/SKILL.md
```

Understand the current:
- Description (single-line with USE WHEN)
- Workflow routing (in markdown body)
- Existing TitleCase naming

---

## Step 3: Understand the Update

What needs to change?
- Adding a new workflow?
- Adding a tool?
- Modifying the description/triggers?
- Renaming the skill?
- Updating documentation?

---

## Step 4: Make Changes

### To Add a New Workflow:

1. **Determine TitleCase name:**
   - ✓ `Create.md`, `UpdateInfo.md`, `SyncRepo.md`
   - ✗ `create.md`, `update-info.md`, `SYNC_REPO.md`

2. **Create the workflow file:**
```bash
touch <skills-dir>/[SkillName]/Workflows/[WorkflowName].md
```

Example:
```bash
touch .claude/skills/ReleaseNotes/Workflows/Publish.md
```

3. **Add entry to `## Workflow Routing` section in SKILL.md:**
```markdown
## Workflow Routing

| Workflow | Trigger | File |
|----------|---------|------|
| **ExistingWorkflow** | "existing trigger" | `Workflows/ExistingWorkflow.md` |
| **NewWorkflow** | "new trigger" | `Workflows/NewWorkflow.md` |
```

4. **Write the workflow content**

### To Update Triggers:

Modify the single-line `description` in YAML frontmatter:
```yaml
description: [What it does]. USE WHEN [updated intent triggers using OR]. [Capabilities].
```

### To Add a Tool:

```bash
mkdir -p <skills-dir>/[SkillName]/Tools
touch <skills-dir>/[SkillName]/Tools/ToolName.ts
touch <skills-dir>/[SkillName]/Tools/ToolName.help.md
```

If a workflow calls the tool, give that workflow an intent-to-flag mapping table (see `Workflows/CreateSkill.md` Step 7).

### To Rename the Skill:

Rename the directory and the frontmatter `name:` together, then find every reference to the old name — other skills' `NOT FOR` clauses and cross-links, and any hand-maintained list of skills in the repo:

```bash
grep -rn 'OldName' .
```

A rename is a **major** change — confirm with the user before doing it.

---

## Step 5: Verify TitleCase

After making changes, verify naming:

```bash
ls <skills-dir>/[SkillName]/Workflows/
ls <skills-dir>/[SkillName]/Tools/ 2>/dev/null
```

All files must use TitleCase:
- ✓ `WorkflowName.md`
- ✓ `ToolName.ts`, `ToolName.help.md`
- ✗ `workflow-name.md`, `tool_name.ts`

---

## Step 6: Final Checklist

### Naming
- [ ] New workflow files use TitleCase
- [ ] New tool files use TitleCase
- [ ] Routing table names match file names exactly

### Structure
- [ ] YAML still has single-line description with USE WHEN
- [ ] No separate `triggers:` or `workflows:` arrays in YAML
- [ ] Markdown body has `## Workflow Routing` section
- [ ] All routes point to existing files
- [ ] New workflow files have routing entries

### Shareable Content
- [ ] `/security-scan <skills-dir>/[SkillName]` and the home-path grep from SKILL.md both come back clean

---

## Step 7: Version

Classify this change (patch / feature / major — see `## Versioning` in CreateSkill's SKILL.md) and hand-bump the skill's `version:` if it carries one. A rename or a removed/broken workflow is a **major** change — stop and confirm first.

## Done

Skill updated while maintaining canonical structure and TitleCase naming.
