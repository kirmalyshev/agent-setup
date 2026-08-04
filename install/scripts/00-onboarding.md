---
module: onboarding
fatal: false
requires: []
---
# onboarding — the /run-agent-setup command

## Why

This step is already done. It is the only thing the bootstrap line installed,
and it is what let you run `/run-agent-setup` to get here.

It is listed because the inventory should be complete: if something claims to
show you everything on your machine and quietly omits itself, the rest of the
list is worth less. `--check` and `--uninstall` cover it like any other module.

What the bootstrap actually did:

1. cloned this repo to `~/.agent-setup`
2. linked one file into your config dir — the `/run-agent-setup` command
3. stopped

No hooks were registered, no packages installed, no settings written. Everything
else in this list is still a decision you have not made yet.

## What it touches

- `<config>/agent-setup` → symlink to the checkout (shared with later steps)
- `<config>/commands/run-agent-setup.md` → symlink, gives you `/run-agent-setup`

## Run

```bash
./install.sh --only onboarding --yes
```

Already run by `bootstrap.sh`. Re-running is safe and repairs the link if the
checkout moved.

## Verify

```bash
./install.sh --only onboarding --check
```

Checks that the command resolves to a readable file, not merely that a symlink
exists — a link through a moved checkout still looks installed.

## Rollback

```bash
./install.sh --only onboarding --uninstall
```

Removes `/run-agent-setup`. Everything you installed through it stays; use
`./install.sh --uninstall` for all of it.
