# Ship Code Workflow

Complete workflow for staging, committing, pushing, and creating GitHub PRs.

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

## Workflow

### Step 1: Stage & Commit

1. Stage tracked modified files: `git add -u`
2. Review staged changes: `git diff --cached`
3. Write a concise conventional commit message based on actual changes
4. Commit: `git commit -m "<message>"`
5. If nothing to commit, proceed to update existing PR if requested

### Step 2: Handle Based on PR State

**If PR already exists:**

1. Push changes: `git push`
2. Update PR title and description to reflect current branch state:
   - Use `gh pr edit` to update title and body
   - Description should help reviewers understand changes, rationale, and context
   - Be concise; omit superfluous TODOs unless absolutely necessary
3. Done - report the PR URL

**If no PR exists:**

Continue to Step 3.

### Step 3: Push & Create PR

1. Push with upstream tracking: `git push -u origin <branch-name>`

2. Create PR:
   ```bash
   gh pr create --title "<title>" --body "<description>" --assignee @me
   ```

   - Title: Same as commit message or brief summary
   - Body: Clear description for reviewers
   - Include context reviewers need to understand the changes

### Step 4: Report Results

Output the GitHub PR URL.

## Configuration Reference

| Setting | Value |
|---------|-------|
| GitHub Username | resolve at runtime: `gh api user --jq .login` |
| Base branch | `main` (unless specified otherwise) |

## Quality Standards

- PR descriptions should be concise but complete
- Include context reviewers need to understand the changes
- Don't leave placeholder TODOs in descriptions
- Use conventional commit message format
