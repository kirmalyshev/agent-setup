---
module: herdr
fatal: false
requires: [prereqs]
---
# herdr — one terminal for every agent

## Why

The moment you run more than one agent, you are managing terminal windows. One
for the thing building the feature, one for the thing writing tests, one for the
server, one you opened to check something and lost. Nothing tells you which of
them is working and which has been sitting there for ten minutes waiting for you
to answer a question.

herdr is a terminal workspace built for that. One window, an agents tab, and
per-agent state: running, needs input, done. Sessions survive closing the
window, so an agent working on something long is still there when you come back.

**It is the one thing in this setup that leaves a process running.** That is how
sessions survive; it is not a side effect. If you would rather not have a
background server on your machine, skip this step — everything else works
without it.

## What it touches

- `brew install herdr` (Homebrew, if it is not already on your PATH)
- `<config>/hooks/herdr-agent-state.sh` → written by herdr
- `<config>/settings.json` → one hook entry, written by herdr
- starts a background server the first time you run `herdr`

Not touched: `~/.config/herdr/config.toml`, herdr's own config. This installer
never writes it and never removes it.

No login daemon is registered. herdr suggests `brew services start herdr`;
this installer deliberately does not run it, because putting a process in your
login items is not a decision an installer should make quietly. herdr works
without it.

## Run

```bash
./install.sh --only herdr --yes
```

## Verify

```bash
./install.sh --only herdr --check
```

Reads back the integration state herdr itself reports for this config dir, and
confirms the agent-state hook file exists — a registration with no file behind
it reports state to nothing.

## Rollback

```bash
./install.sh --only herdr --uninstall
```

Removes the Claude Code integration. The binary stays on your PATH, and your
`~/.config/herdr/config.toml` is untouched.
