---
module: rtk
fatal: false
requires: [prereqs]
---
# rtk — output is not free

## Why

When an agent runs `git status`, `npm test` or `pytest`, the entire output goes
into its context and you pay for all of it. Most of that output is scaffolding:
progress bars, passing-test lines, dependency resolution noise. The three lines
that mattered are in there somewhere.

rtk sits in front of the shell and compacts about forty tools — git, gh, npm,
pytest, cargo, docker, kubectl, grep, tsc, ruff. Often 60–90% less. It is
automatic; you never type `rtk` yourself.

The trade-off, which is real: filtered output can drop the line you needed. When
a result looks wrong, re-run with `rtk proxy <cmd>` to see the raw output before
blaming the underlying tool.

## What it touches

- `brew install rtk` (Homebrew, if it is not already on your PATH)
- `<config>/settings.json` → one PreToolUse hook entry (rtk backs it up)
- `<config>/RTK.md` → the command reference the model reads
- `<config>/CLAUDE.md` → one `@RTK.md` import line

rtk performs its own registration; this installer only gets the binary onto your
PATH and then invokes it against the right config dir.

## Run

```bash
./install.sh --only rtk --yes
```

## Verify

```bash
./install.sh --only rtk --check
```

Asks the hook engine what it would do with a real command, rather than checking
that a binary exists. A tool that is installed but rewrites nothing saves
nothing.

## Rollback

```bash
./install.sh --only rtk --uninstall
```

Removes the hook entry, `RTK.md` and the import line. The binary stays on your
PATH — it is useful on its own, and this installer does not take back a
general-purpose tool.
