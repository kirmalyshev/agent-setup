---
name: CreateSkill
version: 1.1.31
description: "Orchestrator for all skill work — creating, editing, adding a workflow or tool, renaming, validating, or canonicalizing any skill. Owns the full lifecycle instead of handrolling skill files: scaffold, validate, canonicalize, test, improve. USE WHEN create skill, new skill, make a skill, build a skill, set up a skill, make a X skill, add a workflow, add a tool, edit/change/update/rename a skill, skill frontmatter, validate skill, check skill, canonicalize, scaffold skill, test skill, improve skill, optimize description, skill not triggering, overtriggering. NOT FOR over-prompting audits of CLAUDE.md, system prompts, or other instruction sets (use BitterPillEngineering)."
---

# CreateSkill

Complete skill development lifecycle: **structure** (create, validate, canonicalize) + **effectiveness** (test, improve, optimize triggers). Structural workflows keep every skill on one convention. Effectiveness workflows — inspired by Anthropic's skill-creator — check that skills actually work and trigger reliably.

## Authoritative Source

**This file is the convention.** Every workflow checks skills against the sections below.

**Canonical examples to follow:** `RootCauseAnalysis/SKILL.md`, `SystemsThinking/SKILL.md`, `Council/SKILL.md` — sibling skills in the same skills directory as this one.

**Where skills live.** Workflows write `<skills-dir>` for the directory that holds skills:

- `.claude/skills/` in a repo — a project skill, committed and shared with everyone who clones it
- `~/.claude/skills/` — a personal skill, available in every project on this machine

A skill that only works with private context (a specific customer, your own infra, your accounts) is personal. Keep it out of shared repos.

## Naming Convention

| Component | Format | Example |
|-----------|--------|---------|
| Skill directory | `TitleCase` | `RootCauseAnalysis`, `CreateSkill` |
| Workflow files | `TitleCase.md` | `FiveWhys.md`, `UpdateInfo.md` |
| Reference docs | `TitleCase.md` | `MethodSelection.md`, `ApiReference.md` |
| Tool files | `TitleCase.ts` | `ManageServer.ts` |
| Help files | `TitleCase.help.md` | `ManageServer.help.md` |

`SKILL.md` is the one all-caps exception.

**Wrong (NEVER use):**
- Skill dirs: `createskill`, `create-skill`, `create_skill`, `CREATE_SKILL`
- Files: `create.md`, `update-info.md`, `SYNC_REPO.md`

---

## Shareable Content (MANDATORY)

A skill body gets shared — committed to a repo, symlinked into teammates' configs, pasted into a review. Write it generic from the start; a scrub at share time misses things.

**Allowed:**
- Generic instructions and templated patterns with placeholders (`<url>`, `<SESSION_ID>`, `test@example.com`)
- `~`-relative paths (`~/.claude/skills/`) and paths resolved from config
- Public repo URLs and public API endpoints for tools the skill depends on
- Env var *names*, never values: `STRIPE_API_KEY`, `OPENAI_API_KEY`

**Not allowed:**
- Credentials, tokens, session cookies, OAuth secrets — even example-looking ones
- Real names of people, customers, or internal products
- Private domains, hostnames, IPs, internal URLs, private repo paths
- Customer data or customer-specific workflows
- User-specific absolute paths (`/Users/<name>/...`, `/home/<name>/...`)
- First-person war stories tied to a specific incident, project, or person

Per-user values (your domains, account IDs, endpoints) go in a config file the skill reads at run time, kept outside the skill directory. Credentials go in env vars.

### Pre-Flight Gate

Before committing a new or changed skill, run `/security-scan <skills-dir>/<SkillName>`, then:

```bash
grep -rnE '/Users/|/home/' <skills-dir>/<SkillName>
```

`/security-scan` catches credential shapes. The grep catches home-path literals. Names, hostnames, and customer context still need a read-through — no pattern list covers them.

---

## Flat Folder Structure (MANDATORY)

**Maximum depth:** `<skills-dir>/SkillName/Category/` — two levels.

### ✅ ALLOWED

```
SkillName/SKILL.md                    # Skill root
SkillName/Workflows/Create.md         # Workflow - one level deep
SkillName/Tools/Manage.ts             # Tool - one level deep
SkillName/QuickStartGuide.md          # Context file - in root
SkillName/Examples.md                 # Context file - in root
```

### ❌ FORBIDDEN (too deep or wrong location)

```
SkillName/Resources/Guide.md              # Context files go in root, NOT Resources/
SkillName/Docs/Examples.md                # Context files go in root, NOT Docs/
SkillName/Workflows/Category/File.md      # THREE levels
SkillName/Templates/Primitives/File.md    # THREE levels
SkillName/Tools/Utils/Helper.ts           # THREE levels
```

### Allowed Subdirectories

- **Workflows/** — execution workflows ONLY
- **Tools/** — executable scripts/tools ONLY. Create it when the skill gets its first tool, not before.
- **References/** — extended reference material for large skills (API docs, detailed guides)

Context files (documentation, guides, references) go in the skill ROOT or in References/.

**When to use References/:** when SKILL.md exceeds ~500 lines and has substantial reference content (API signatures, detailed examples, troubleshooting guides). Keep SKILL.md as a routing guide; move encyclopedic content to References/.

**Many workflows?** Use clear filenames, not subdirectories: `Workflows/CompanyDueDiligence.md`, not `Workflows/Company/DueDiligence.md`.

Why flat: files are easy to find, navigation costs less, and every skill follows the same pattern.

---

## Dynamic Loading Pattern (Large Skills)

**For skills with SKILL.md > 100 lines:** use dynamic loading to reduce context on skill invocation.

### How Loading Works

- **Session startup:** only frontmatter loads, for routing
- **Skill invocation:** full SKILL.md loads
- **Context files:** load only when a workflow references them

### The Pattern

**SKILL.md** = minimal (30-50 lines), loads on invocation:
- YAML frontmatter with triggers
- Brief description
- Workflow routing table
- Quick reference
- Pointers to context files

**Additional .md files** = context files — Standard Operating Procedures for specific aspects, loaded on demand. They give specific handling instructions and can reference Workflows/, Tools/, etc.

### NO Context/ Subdirectory

Never create `Context/` or `Docs/` subdirectories. Additional .md files ARE the context files; they live directly in the skill root. The skill directory IS the context.

**WRONG:**
```
Art/
├── SKILL.md
└── Context/              ❌ NEVER CREATE THIS
    └── Aesthetic.md
```

**CORRECT:**
```
Art/
├── SKILL.md              # 40 lines - minimal routing
├── Aesthetic.md          # Context file - SOP for aesthetic
├── Examples.md           # Context file - SOP for examples
├── Workflows/
│   └── Essay.md
└── Tools/                # only if the skill has tools
    └── Generate.ts
```

### Minimal SKILL.md Template

```markdown
---
name: SkillName
description: [What it does]. USE WHEN [intent triggers]. NOT FOR [confusable alternatives (use OtherSkill)].
---

# SkillName

Brief description.

## Workflow Routing

| Trigger | Workflow |
|---------|----------|
| "trigger" | `Workflows/WorkflowName.md` |

## Quick Reference

**Key points** (3-5 bullet points)

**Full Documentation:**
- `Detail1.md` — read when [situation]
- `Detail2.md` — read when [situation]
```

### When To Use

✅ **Use dynamic loading for:** SKILL.md > 100 lines, multiple documentation sections, extensive API reference, detailed examples.

❌ **Don't use for:** simple skills (< 50 lines), pure utility wrappers.

**Benefits:** 70%+ fewer tokens on invocation when the full docs aren't needed. SKILL.md stays a router, context files hold the SOPs, and workflows load only what they need.

---

## Workflow Routing

### Structure Workflows (scaffolding and conventions)

| Workflow | Trigger | File |
|----------|---------|------|
| **CreateSkill** | "create a new skill" | `Workflows/CreateSkill.md` |
| **ValidateSkill** | "validate skill", "check skill" | `Workflows/ValidateSkill.md` |
| **UpdateSkill** | "update skill", "add workflow" | `Workflows/UpdateSkill.md` |
| **CanonicalizeSkill** | "canonicalize", "fix skill structure" | `Workflows/CanonicalizeSkill.md` |

### Effectiveness Workflows (testing and optimization)

| Workflow | Trigger | File |
|----------|---------|------|
| **TestSkill** | "test skill", "does this skill work", "skill not working" | `Workflows/TestSkill.md` |
| **ImproveSkill** | "improve skill", "skill quality", "fix skill instructions" | `Workflows/ImproveSkill.md` |
| **OptimizeDescription** | "optimize description", "skill not triggering", "trigger accuracy" | `Workflows/OptimizeDescription.md` |

## Skill Types (Choose Before Building)

Before creating any skill, identify which of the 9 types it is (from Anthropic's internal skill taxonomy, Thariq Shihipar, Mar 2026). The type shapes structure and testing decisions.

| Type | Focus | Key Structure | Example |
|------|-------|---------------|---------|
| 1. Library/API Reference | Gotchas, edge cases Claude gets wrong | Lightweight, gotchas-heavy, reference snippets | a framework-gotchas skill |
| 2. Product Validation | Test/verify code works | State assertions, browser automation, output recording | a browser-QA skill |
| 3. Data Fetching | Connect to data systems | Credential refs, query patterns, dashboard pointers | a business-metrics skill |
| 4. Business Process | Automate repetitive workflows | Execution logs, consistency tracking | a task-tracker skill |
| 5. Code Scaffolding | Generate framework boilerplate | Template files, project-aware scripts | CreateSkill |
| 6. Code Quality | Enforce standards, review | Deterministic scripts, hook integration | `/code-review`, BitterPillEngineering |
| 7. CI/CD & Deployment | Deploy with safety patterns | Pre-deploy checks, smoke tests, rollback | Ship |
| 8. Operations Runbooks | Map phenomena to diagnostics | Phenomenon → tool → query → report | a site-health skill |
| 9. Infrastructure Ops | Maintenance with safety guardrails | Safety gates, audit logging, orphan detection | a dotfiles skill |

## Skill Writing Guidance

When writing or improving skill instructions, follow these principles from Anthropic's skill-creator methodology and Thariq Shihipar's "Lessons from Building Claude Code" (Mar 2026):

### Core Principles

- **Don't state the obvious.** Claude is competent at programming and knows codebases. Focus on information that **breaks Claude's default patterns** — things it gets wrong without guidance. Test: "Would Claude do this wrong without being told?" If not, remove it.
- **Explain the why, not just the what.** Models with good theory of mind + clear reasoning outperform models with rigid constraints. Instead of "ALWAYS use 3 bullets", explain why bullets matter for the audience.
- **Keep it lean.** The context window is a public good. Remove instructions that don't improve output. If test transcripts show the agent wasting time on unproductive steps, cut them. SKILL.md should be under 500 lines.
- **Cut intensifier-only lines.** Stating a rule once is the instruction. `MANDATORY`, `CRITICAL`, "not optional", and a third restatement add volume, not constraint — the model obeys specificity and code, not emphasis. Delete any line whose only content is shouting a rule stated elsewhere. Watch `## Best Practices` / `## Tips` sections: they collect default-restating filler ("be thorough", "keep it simple", "validate carefully"). Run the delete-test on every line: cut it, and restore only if you can name the specific non-default behavior it forces. The BitterPillEngineering skill runs this audit line by line.
- **Generalize, don't overfit.** Fix underlying patterns, not specific test failures. The skill will be used on many prompts beyond your test set.
- **Bundle repeated work.** If test agents all independently wrote similar helper scripts, add that script to Tools/ so every future invocation benefits.
- **Set appropriate degrees of freedom.** Match specificity to task fragility. Database migrations need exact commands; code reviews need general direction.
- **Don't over-constrain.** Skills are reused heavily. Avoid overly specific instructions. Provide needed information but leave flexibility for different contexts.

### Description Best Practices

- **Descriptions are for models, not humans.** The description is injected into the system prompt. Claude reads it to decide whether to invoke the skill.
- **Descriptions should be slightly pushy.** Models tend to undertrigger. Name specific scenarios even if the user might not explicitly mention the skill.
- **Include negative triggers for confusable skills.** Add "NOT FOR" clauses when skills share vocabulary: `"NOT FOR recurring structural problems (use SystemsThinking)"`.
- **Undertriggering signals:** Skill doesn't load when it should, users manually invoking it.
- **Overtriggering signals:** Skill loads for irrelevant queries, users disabling it.

### Gotchas Section (MANDATORY)

Every skill MUST have a `## Gotchas` section after the workflow routing table. Thariq: "The highest information density in any Skill comes from gotchas sections."

Populate with:
- API quirks Claude doesn't know about
- Common mistakes observed during usage
- Ordering/sequencing requirements that aren't obvious
- Edge cases that cause silent failures

**Gotchas accumulate over time.** After every skill failure, add the lesson.

### Ideal-State Prompting (WHAT, not HOW)

**Write every new skill body and workflow ideal-state style: articulate WHAT a done deliverable looks like (as testable outcomes), the CONSTRAINTS, and the TOOLS — then trust the model to find HOW.** Numbered step-lists that choreograph the model's reasoning for open-ended cognitive work are scaffolding a smarter model doesn't need: they cap a capable model and rot as models improve. Four keep-classes ARE legitimate HOW and belong in skills: **safety-gate**, **verified-gotcha** (this is what `## Gotchas` is for), **tool-contract** (exact invocation recipes in Workflows), **output-format-contract**. Deterministic Tools (`*.ts`) are exempt. When writing or improving a skill, cut methodology narration and keep only the ideal state, the constraints, the tools, and the four keep-classes.

### BPE (Bitter-Pilled Engineering) Check

Before finalizing any skill, ask: **"Would a smarter model make this skill unnecessary?"**

- **Anti-fragile (keep):** Verification harnesses, data pipelines, tool wrappers, accumulated gotchas, deterministic scripts
- **Fragile (question):** CoT orchestrators, format parsers, retry cascades, elaborate reasoning scaffolding

Focus skills on knowledge Claude can't derive (failure modes, API quirks), tools Claude can't replicate (API calls, automation), and workflows that benefit from consistency. For a full audit, invoke the BitterPillEngineering skill.

### Progressive Disclosure (from Anthropic)

Three levels of information loading — use this to manage large skills:
1. **Level 1 (YAML frontmatter):** Always in system prompt. Triggering info only.
2. **Level 2 (SKILL.md body):** Loaded when skill is invoked. Routing + key guidance.
3. **Level 3 (Reference files):** Root-level `.md` files or `References/` subdirectory loaded on demand.

Tell Claude what files exist; it will read them when appropriate. SKILL.md should be under 500 lines — if over, extract detailed content to reference files.

### Testing Best Practices (from Anthropic)

Three testing levels for skills:
1. **Manual testing** — Run queries and observe behavior
2. **Scripted testing** — Automate test cases (use TestSkill workflow)
3. **Programmatic testing** — Build evaluation suites

**Evaluation-driven development:** Define what "this skill working" looks like before building the skill. Iterate on a single challenging task until Claude succeeds, then extract the winning approach.

### On-Demand Hook Pattern (from Anthropic)

Skills can include hooks that activate only when invoked, remaining effective for the session:
- `/careful` — Intercept dangerous commands (rm -rf, DROP TABLE, force-push)
- `/freeze` — Block edits outside specific directories
- `/audit` — Log all tool calls for session review

*All guidance above derived from Thariq Shihipar's "Lessons from Building Claude Code" (Mar 2026), Anthropic's official skill guide, and platform documentation.*

## Versioning

A skill may carry its own `version:` semver in frontmatter (`Major.Feature.Patch` — the middle number is **Feature**, not "minor"), independent of other skills. A new skill starts at `version: 1.0.0`. Bump it by hand as part of the edit, using this rubric:

- **patch** — gotcha added, typo, description tweak, doc sync. No new capability.
- **feature** — a new workflow or a new tool. Additive, non-breaking.
- **major** — renaming or removing the skill, or breaking its public contract or routing behavior. Stop and confirm with the user before any major bump; never decide major on your own.

## Examples

**Example 1: Create a new skill from scratch**
```
User: "Create a skill for writing our release notes"
→ Invokes CreateSkill workflow
→ Reads this SKILL.md for structure requirements
→ Creates <skills-dir>/ReleaseNotes/ with SKILL.md and Workflows/
→ Runs the pre-flight gate
→ Suggests running TestSkill to verify effectiveness
```

**Example 2: Fix an existing skill that's not routing properly**
```
User: "The RootCauseAnalysis skill isn't triggering - validate it"
→ Invokes ValidateSkill workflow
→ Checks SKILL.md against canonical format
→ Verifies TitleCase naming and USE WHEN triggers
→ Reports compliance issues with fixes
```

**Example 3: Test if a skill actually helps**
```
User: "Test the RedTeam skill to see if it's effective"
→ Invokes TestSkill workflow
→ Generates 3 realistic test prompts
→ Spawns with-skill and baseline agents in parallel
→ Compares outputs, presents results
→ Iterates with ImproveSkill based on feedback
```

**Example 4: Skill isn't triggering on relevant prompts**
```
User: "SystemsThinking doesn't trigger when I ask why my team keeps missing deadlines"
→ Invokes OptimizeDescription workflow
→ Generates 20 should/shouldn't-trigger queries
→ Tests description accuracy via subagents
→ Rewrites description, re-tests, reports improvement
```

**Example 5: Improve a skill that produces weak output**
```
User: "The Council output is too verbose — improve it"
→ Invokes ImproveSkill workflow
→ Reads skill + user feedback
→ Diagnoses root cause (over-specified instructions)
→ Rewrites with reasoning instead of rigid MUSTs
→ Suggests TestSkill to verify improvement
```

## Gotchas

- **This file's own description is ~775 chars against the 1024-char cap.** Re-measure before saving any edit that grows it.
- **Two `## Workflow Routing` headers exist in this file** — the first is inside the Minimal SKILL.md Template, the second is the real one. Header-scanning tools must take the LAST match, not the first.
- **Reading this skill's workflows and executing the steps from memory is the handrolling anti-pattern** — invoke the skill instead of imitating it. Its checklists apply to this skill too: the skill that mandates a Gotchas section once shipped without one.
- **Skills installed by agent-setup are symlinks.** Tools that don't follow symlinks by default (`rg`, `find` without `-L`) silently skip every one of them in `~/.claude/skills/`.
- **Adding a skill to the agent-setup repo:** `installers/skills.sh` derives its list from the directory, so the installer needs no edit. The docs do — the skill table in README chapter 7, the table in `install/scripts/60-skills.md`, and the skill counts in README, `install.sh`, and `.github/workflows/ci.yml` are hand-maintained.
