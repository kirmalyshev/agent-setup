# CanonicalizeSkill Workflow

**Purpose:** Restructure an existing skill to match the canonical format with proper naming conventions.

---

## Step 1: Read the Authoritative Source

Read CreateSkill's `SKILL.md`. Its Naming Convention, Flat Folder Structure, and Dynamic Loading sections define exactly what "canonicalize" means.

---

## Step 2: Read the Current Skill

```
<skills-dir>/[SkillName]/SKILL.md
```

Identify what's wrong:
- Multi-line description using `|`?
- Separate `triggers:` array in YAML? (OLD FORMAT)
- Separate `workflows:` array in YAML? (OLD FORMAT)
- Missing `USE WHEN` in description?
- Workflow routing missing from markdown body?
- **Workflow files not using TitleCase?**
- **Skill directory not using TitleCase?**

---

## Step 3: Backup

If the skill is tracked in git, commit or stash first — git is the backup. Otherwise copy it outside every skills directory:

```bash
cp -r <skills-dir>/[SkillName] "${TMPDIR:-/tmp}/[SkillName]-backup-$(date +%Y%m%d)"
```

Never put a backup inside a skills directory: a copy with its own SKILL.md loads as a duplicate skill.

---

## Step 4: Enforce TitleCase Naming

**All naming must use TitleCase (PascalCase).**

### Skill Directory Name
```
✗ WRONG: createskill, create-skill, create_skill, CREATESKILL
✓ CORRECT: Createskill (or CreateSkill for multi-word)
```

### Workflow File Names
```
✗ WRONG: create.md, CREATE.md, create-skill.md, create_skill.md
✓ CORRECT: Create.md, UpdateInfo.md, SyncRepo.md
```

### Reference Doc Names
```
✗ WRONG: prosody-guide.md, PROSODY_GUIDE.md
✓ CORRECT: ProsodyGuide.md, SchemaSpec.md, ApiReference.md
```

### Tool Names
```
✗ WRONG: manage-server.ts, MANAGE_SERVER.ts
✓ CORRECT: ManageServer.ts (with ManageServer.help.md)
```

**Rename files if needed:**
```bash
# Example: rename workflow files
cd <skills-dir>/[SkillName]/Workflows/
mv create.md Create.md
mv update-info.md UpdateInfo.md
mv sync_repo.md SyncRepo.md
```

---

## Step 5: Enforce Flat Folder Structure

**Maximum 2 levels deep — `<skills-dir>/SkillName/Category/`**

### Check for Nested Folders

```bash
# Any folder two or more levels inside the skill is a violation
find <skills-dir>/[SkillName] -mindepth 2 -type d
```

### ❌ Common Violations to Fix

**Nested Workflows:**
```
✗ WRONG: Workflows/Company/DueDiligence.md
✓ FIX: Workflows/CompanyDueDiligence.md
```

**Nested Templates:**
```
✗ WRONG: Templates/Primitives/Extract.md
✓ FIX: ExtractTemplate.md in the skill root (it is a context file)
```

**Nested Tools:**
```
✗ WRONG: Tools/Utils/Helper.ts
✓ FIX: Tools/Helper.ts (or delete if not needed)
```

### Flatten Procedure

1. **Identify nested files**: Find any file 3+ levels deep
2. **Rename for clarity**: `Category/File.md` → `CategoryFile.md`
3. **Move to parent**: Move up one level to proper location
4. **Update references**: Search for old paths and update

**Example:**
```bash
# Before (3 levels - WRONG)
SkillName/Workflows/Company/DueDiligence.md

# After (2 levels - CORRECT)
SkillName/Workflows/CompanyDueDiligence.md
```

**Rule:** If you need to organize many files, use clear filenames NOT subdirectories.

---

## Step 6: Convert YAML Frontmatter

**From old format (WRONG):**
```yaml
---
name: skill-name
description: |
  What the skill does.

triggers:
  - USE WHEN user mentions X
  - USE WHEN user wants to Y

workflows:
  - USE WHEN user wants to A: Workflows/a.md
  - USE WHEN user wants to B: Workflows/b.md
---
```

**To new format (CORRECT):**
```yaml
---
name: SkillName
description: What the skill does. USE WHEN user mentions X OR user wants to Y. Additional capabilities.
---
```

**Key changes:**
- Skill name in TitleCase
- Combine description + triggers into single-line `description` with `USE WHEN`
- Remove `triggers:` array entirely
- Remove `workflows:` array from YAML (moves to body)

---

## Step 7: Add Workflow Routing to Body

Add `## Workflow Routing` section in markdown body:

```markdown
# SkillName

[Description]

## Workflow Routing

| Workflow | Trigger | File |
|----------|---------|------|
| **WorkflowOne** | "trigger phrase one" | `Workflows/WorkflowOne.md` |
| **WorkflowTwo** | "trigger phrase two" | `Workflows/WorkflowTwo.md` |

## Examples

[Required examples section]

## [Rest of documentation]
```

**Note:** Workflow names in routing table must match file names exactly (TitleCase).

---

## Step 8: Remove Redundant Routing

If the markdown body already had routing information in a different format, consolidate it into the standard `## Workflow Routing` section. Delete any duplicate routing tables or sections.

---

## Step 9: Ensure All Workflows Are Routed

List workflow files:
```bash
ls <skills-dir>/[SkillName]/Workflows/
```

For EACH file:
1. Verify TitleCase naming (rename if needed)
2. Ensure there's a routing entry in `## Workflow Routing`
3. Verify routing entry matches exact file name

---

## Step 10: Add Gotchas Section

**REQUIRED:** Every skill needs a `## Gotchas` section after the workflow routing table.

```markdown
## Gotchas

- [Known failure mode or API quirk]
- [Common mistake Claude makes with this skill]
- [Ordering/sequencing requirement that isn't obvious]
```

If the skill is new or you don't know specific gotchas yet, add the section with a placeholder:
```markdown
## Gotchas

_No gotchas documented yet. Add failures here as they're discovered._
```

Per Anthropic: "The highest information density in any Skill comes from gotchas sections."

---

## Step 10a: Add Negative Triggers (if applicable)

If the skill shares vocabulary with other skills, add `NOT FOR` to the description:
```yaml
description: ... USE WHEN [triggers]. NOT FOR [confusable alternative (use SkillName instead)].
```

---

## Step 10b: Check BPE Compliance

Review each instruction: does it provide knowledge Claude can't derive on its own? Remove instructions that just tell Claude what it already knows. Focus on information that breaks Claude's default patterns.

---

## Step 10c: Check SKILL.md Size

If SKILL.md exceeds 500 lines, extract detailed reference content into:
- Root-level context files
- `References/` subdirectory for extensive reference material

Keep SKILL.md as a concise routing guide.

---

## Step 11: Add Examples Section

**REQUIRED:** Every skill needs an `## Examples` section with 2-3 concrete usage patterns.

````markdown
## Examples

**Example 1: [Common use case]**
```
User: "[Typical user request]"
→ Invokes WorkflowName workflow
→ [What skill does]
→ [What user gets back]
```

**Example 2: [Another use case]**
```
User: "[Different request]"
→ [Process]
→ [Output]
```
````

Place the Examples section after Workflow Routing.

---

## Step 12: Verify

Run checklist:

### Naming (TitleCase)
- [ ] Skill directory uses TitleCase (e.g., `RootCauseAnalysis`, `Createskill`)
- [ ] All workflow files use TitleCase (e.g., `Create.md`, `UpdateInfo.md`)
- [ ] All reference docs use TitleCase (e.g., `ProsodyGuide.md`)
- [ ] All tool files use TitleCase (e.g., `ManageServer.ts`)
- [ ] Routing table workflow names match file names exactly

### YAML Frontmatter
- [ ] `name:` uses TitleCase
- [ ] `description:` is single-line with embedded `USE WHEN` clause
- [ ] No separate `triggers:` or `workflows:` arrays in YAML
- [ ] Description uses intent-based language
- [ ] Description is under 1024 characters

### Markdown Body
- [ ] `## Workflow Routing` section present
- [ ] Routing uses table format with Workflow, Trigger, File columns
- [ ] All workflow files have routing entries
- [ ] `## Gotchas` section present
- [ ] `## Examples` section with 2-3 concrete usage patterns

### Structure
- [ ] Workflows contain ONLY work execution procedures
- [ ] Reference docs live at skill root or in `References/` (not in Workflows/)
- [ ] No backup copies inside the skills directory

---

## TitleCase Reference

| Type | Wrong | Correct |
|------|-------|---------|
| Skill directory | `createskill`, `create-skill` | `Createskill` |
| Multi-word skill | `create_skill`, `CREATE_SKILL` | `CreateSkill` |
| Workflow file | `create.md`, `CREATE.md` | `Create.md` |
| Multi-word workflow | `update-info.md`, `UPDATE_INFO.md` | `UpdateInfo.md` |
| Reference doc | `api-reference.md` | `ApiReference.md` |
| Tool file | `manage-server.ts` | `ManageServer.ts` |

---

## Done

Skill now matches the canonical structure in CreateSkill's `SKILL.md` with proper TitleCase naming throughout.
