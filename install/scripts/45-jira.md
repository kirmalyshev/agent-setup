---
module: jira
fatal: false
requires: [prereqs]
---
# jira-cli — Jira from the terminal

## Why

If your work tracker is Jira, you (or the agent, on your behalf) want to read
and file issues from the terminal instead of a browser tab. `jira-cli`
(ankitpokhrel/jira-cli) does that — list, view, create, transition issues,
scriptable and interactive both.

Nobody without a Jira account needs this. Skip it and everything else still
works.

## What it touches

- `brew install ankitpokhrel/jira-cli/jira-cli` (Homebrew, if it is not
  already on your PATH)

Nothing under your config dir. Unlike rtk and herdr, jira-cli has no Claude
Code integration to register — this step only gets the binary onto PATH.
Pointing it at your Jira instance (`jira init`, which asks for a server URL
and a token) is yours to run afterwards; this installer never runs it for you.

## Run

```bash
./install.sh --only jira --yes
```

## Verify

```bash
./install.sh --only jira --check
```

Confirms the binary is on PATH. It cannot confirm you've authenticated —
that lives in `~/.config/.jira/.config.yml`, which this installer never reads
or writes.

## Rollback

```bash
./install.sh --only jira --uninstall
```

Does nothing but say so — jira-cli is a general-purpose tool, not ours to take
back. The binary and your `~/.config/.jira/.config.yml` both stay.
