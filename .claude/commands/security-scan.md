---
description: Scan for credentials before sharing a diff, a log, or a repo. Defaults to the staged diff in a git repo, the working tree otherwise.
argument-hint: "[path…] | --staged | --diff <ref> | --all"
allowed-tools: Bash(bun*), Bash(git status*), Bash(git rev-parse*), Read
---

Run the credential scanner and report what it finds.

Scanner: `bun ~/.claude/agent-setup/scripts/scan.ts`
Arguments given: `$ARGUMENTS`

Steps:

1. Pick the target. If `$ARGUMENTS` is non-empty, pass it through verbatim.
   Otherwise check `git rev-parse --is-inside-work-tree`: inside a repo with
   staged changes, scan `--staged`; inside a repo with none, scan the working
   tree (`.`); outside a repo, scan `.`.
2. Run the scanner. Add `--all` if the user asked for medium and low confidence
   findings too — the default reports high confidence only.
3. Report the findings as a short table: file, line, what it is, confidence.
   **Never print the credential value itself** — the scanner already masks it, so
   pass through its masked preview and nothing more.
4. For each finding, say which it is:
   - **live credential** → invoke the `SecretHygiene` skill and follow the
     rotation path. Rotation first, cleanup second.
   - **test fixture or placeholder** → propose the narrowest allowlist entry
     (inline marker > value hash > path glob).
   - **credential store flagged as a file** (`.env` and friends) → confirm it is
     gitignored: `git check-ignore -v <path>`. If it is not, that is the finding.
5. If nothing is found, say so plainly, and state what was scanned and at which
   confidence level — "clean" means nothing without those two facts.

Exit code 1 from the scanner means findings, not an error. Exit code 2 is a usage
error.
