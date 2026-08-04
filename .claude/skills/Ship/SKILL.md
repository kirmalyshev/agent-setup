---
name: Ship
description: Stage, commit, push code and create GitHub PRs with parallel test suite and code review. USE WHEN user says "ship", "ship it", "create a PR", "update the PR", "quick ship", "commit and push", or wants to publish their work.
---

# Ship

Ship code with quality gates. Default workflow runs full test suite and code review **in parallel** before pushing. Fast path available for quick iterations.

## Workflow Routing

| Workflow | Trigger | File |
|----------|---------|------|
| **Ship** | "ship", "ship it" | `Workflows/Ship.md` |
| **ShipNoQA** | "quick ship", "just push", "commit and push", "ship --no-review" | `Workflows/ShipNoQA.md` |
| **UpdatePR** | "update the PR", "update PR description" | `Workflows/ShipNoQA.md` |
| **CreatePR** | "create a PR", "open PR" | `Workflows/ShipNoQA.md` |

## Key Configuration

| Setting | Value |
|---------|-------|
| GitHub Username | resolve at runtime: `gh api user --jq .login` |
| PR assignee | `@me` (always assign new PRs to the author) |
| Base Branch | `main` |
| Review auto-detect | StrictReview (<=5 files), TeamReview (>5 files) |

## Examples

**Example 1: Ship with full QA (default)**
```
User: "ship it"
-> Stage and commit changes
-> Run tests + code review IN PARALLEL
-> Auto-fix critical/major review findings
-> Re-run tests if fixes applied
-> Push and create/update PR
-> Report PR URL + test summary + review summary
```

**Example 2: Quick ship (skip QA)**
```
User: "quick ship"
-> Stage and commit changes
-> Push and create/update PR immediately
-> Report PR URL
```

**Example 3: Update existing PR**
```
User: "update the PR"
-> Stage and commit changes
-> Push to existing branch
-> Update PR title and description
-> Report PR URL
```
