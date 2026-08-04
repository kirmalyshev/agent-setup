---
module: security
fatal: true
requires: [prereqs]
---
# security — the credential guardrails

## Why

Everything an agent reads enters its context, and everything in its context is
sent to the model vendor and retained. That is how the tool works, not a defect
in it.

The consequence is specific and people hit it in their first week, usually while
debugging something unrelated:

> Asking an agent to "check what's in the env file" puts your whole credential
> store into a transcript you do not control. At that point the fix is
> rotation, not deletion.

Credentials have shapes — `ghp_`, `sk-ant-`, `AKIA`, a PEM header, a JWT — so
they can be caught mechanically. This step installs four hooks that sit in front
of tool calls and stop the shapes: reading a credential file, running a command
that dumps secrets, sending one to an external service, or writing one into
source. Each is a TypeScript function with unit tests behind it, not a model
being asked to behave.

It also installs the two skills that cover the half no hook can: a customer's
support thread pasted into a web search has no token shape, and no pattern will
ever catch it.

This step is not optional. A machine that believes it has guardrails and does
not is worse off than one that knows it has none — so if this fails, the setup
stops rather than continuing without it.

## What it touches

- `<config>/agent-setup` → symlink to this checkout
- `<config>/skills/LlmDataBoundary`, `<config>/skills/SecretHygiene` → symlinks
- `<config>/commands/security-scan.md` → symlink, gives you `/security-scan`
- `<config>/settings.json` → four hook entries (the file is backed up first)
- creates `<config>/security/agent-setup/audit.jsonl` on first decision

Default posture is **balanced**: high-confidence shapes are blocked, medium ones
raise a permission prompt, low ones are logged only. No audit row ever contains
the credential itself.

The cost, stated plainly: hooks run on every matching tool call, and a false
positive will occasionally block something you meant to do. `<config>/agent-setup.local.json`
is where you allowlist those.

## Run

```bash
./install.sh --only security --yes
```

## Verify

```bash
./install.sh --only security --check
```

This runs the full check battery and then drives the *installed* hook with a
real `.env` read, through the symlink, using the same config resolution a
session uses. A pass means the guardrails are live, not merely registered.

## Rollback

```bash
./install.sh --only security --uninstall
```

Removes the hook entries, the skills and the command. Your entries in
`agent-setup.local.json` are left alone.
