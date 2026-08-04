# Ship Workflow

Ship code with parallel quality gates: full test suite + auto-detected code review run simultaneously before pushing.

## Prerequisites

Before starting, gather current state:

```bash
git branch --show-current
git status --short
git diff --stat
git diff --cached --stat
git log --oneline -5
gh pr view --json number,url,title 2>/dev/null || echo "no existing PR"
```

If on `main`, warn the user and stop.

## Workflow

### Step 1: Stage & Commit

1. Stage tracked modified files: `git add -u`
2. Stage new untracked files relevant to the work (if any)
3. Review staged changes: `git diff --cached --stat`
4. Write a concise conventional commit message based on actual changes
5. Commit: `git commit -m "<message>"`
6. If nothing to commit, skip to Step 4 (push existing commits)

Committed code is required so the review agent can diff against `main`.

### Step 2: Parallel Quality Gate

Count changed files vs base:

```bash
git diff --name-only main...HEAD | wc -l
```

Launch **two Task() agents in a single message** (this makes them run truly in parallel):

**Agent A — Test Suite (Bash agent):**

Detect which subprojects have changes and run their quality checks:

```bash
# 1. Identify changed directories vs base branch
git diff --name-only main...HEAD
```

**Detection strategy** — check the project root and each changed subproject for test/lint/typecheck commands, in priority order:

1. **Project CLAUDE.md** — read the project's `CLAUDE.md` (and subproject CLAUDE.md files) for "Pre-commit Quality Checks" or similar sections. Run exactly those commands.

2. **Makefile** — if `Makefile` exists with `test`, `lint`, or `check` targets:
   ```bash
   make test       # or make lint, make check
   ```

3. **Python (pyproject.toml / setup.py)** — if present:
   ```bash
   scripts/lint              # if scripts/lint exists
   scripts/typecheck         # if scripts/typecheck exists
   make run-tests-xdist      # parallel pytest via Makefile (preferred)
   make run-tests            # sequential pytest via Makefile
   uv run pytest             # fallback if neither script/target exists
   ```

4. **Node (package.json)** — if present, check `scripts` in package.json:
   ```bash
   yarn typecheck    # if "typecheck" script exists
   yarn lint         # if "lint" script exists
   yarn test         # if "test" script exists
   npm test          # fallback
   ```

5. **Go (go.mod)** — `go test ./...`

**Monorepo handling:** For monorepos, only run checks for subprojects that have changes. Run each subproject's checks from its own directory (for example, `cd packages/api && npm run lint`).

**Important:** Run lint/typecheck first, then tests. Stop on first failure and report which check failed.

**Agent B — Code Review (general-purpose agent):**

Based on file count:
- **5 or fewer files changed (StrictReview):** one reviewer over the full diff `git diff <base>...HEAD`, enforcing the repo's own AGENTS.md/CLAUDE.md invariants plus correctness, security, and test coverage.
- **More than 5 files changed (TeamReview):** the reviewer splits the diff into dimensions (correctness, security/secrets, data-layer/queries, tests, docs-vs-behavior drift) and sweeps each one over the whole diff before merging findings.

(These used to reference `$PAI_DIR/skills/Review/Workflows/*.md`; that Review skill is not installed, so the instructions above are self-contained.)

The review agent prompt should include:
1. Which mode to run (StrictReview or TeamReview, per the file count) and the diff range
2. Instruction to read the repo's AGENTS.md files first and enforce their invariants
3. Severity classification (critical / major / minor / nit) and auto-fix of critical + major findings, verified by re-running the repo's typecheck/tests
4. Instruction to return a summary: number of findings by severity, one line per critical/major (file:line, what, fixed y/n), files modified

**Important:** Both agents MUST be launched in a single message to run truly in parallel.

### Step 3: Gate Check

Collect results from both agents. Evaluate:

**If tests failed:**
- Display test failure output
- **STOP** — do not push. Report what failed.

**If review found critical/major findings that were auto-fixed:**
- The review agent already applied fixes
- Stage the fixes: `git add -u`
- Create a new commit: `git commit -m "fix: review auto-fixes"`
- Re-run the same test commands from Agent A to verify fixes didn't break anything
- If re-test fails, **STOP** and report

**If both passed (or only minor/nit findings):**
- Continue to Step 4

### Step 4: Push & Create/Update PR

**If PR already exists:**

1. Push changes: `git push`
2. Update PR title and description to reflect current branch state:
   - Use `gh pr edit` to update title and body
   - Include review summary in PR description
3. Report the PR URL

**If no PR exists:**

1. Push with upstream tracking: `git push -u origin <branch-name>`
2. Create PR:
   ```bash
   gh pr create --title "<title>" --body "<description>" --assignee @me
   ```
   - Title: Same as commit message or brief summary
   - Body: Clear description + review summary
3. Report the PR URL

### Step 5: Report

Output a concise summary:

```
PR: <url>
Tests: PASS (N passed in Xs)
Review: <StrictReview|TeamReview> — N findings (X critical, Y major, Z minor) — N auto-fixed
```

## Configuration Reference

| Setting | Value |
|---------|-------|
| GitHub Username | resolve at runtime: `gh api user --jq .login` |
| Base branch | `main` (unless specified otherwise) |
| Review threshold | <=5 files: StrictReview, >5 files: TeamReview |
| Test command | Auto-detected from CLAUDE.md, Makefile, package.json, pyproject.toml |

## Quality Standards

- PR descriptions should be concise but complete
- Include review summary in PR body
- Don't push if tests fail
- Auto-fix critical/major review findings before pushing
- Use conventional commit message format
