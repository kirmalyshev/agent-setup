---
module: prereqs
fatal: true
requires: []
---
# prereqs — bun and Homebrew

## Why

The security hooks are TypeScript. Something has to run them on every tool call,
and that something is `bun` — a JavaScript runtime that starts fast enough to
sit in front of every action an agent takes without you noticing it.

Homebrew is the package manager the two command-line tools later in this setup
come from. On macOS, installing it needs your password.

This step is not optional. Every module after it assumes both exist, and the
hooks cannot run at all without bun. If you would rather install them yourself,
say so — skip this step, install them by hand, and re-run `/run-agent-setup`.

## What it touches

- installs `bun` if missing (`~/.bun`, and a line in your shell profile)
- installs Homebrew if missing (`/opt/homebrew` on Apple Silicon,
  `/usr/local` on Intel, `/home/linuxbrew` on Linux)
- **on macOS, the Homebrew installer asks for your password**

Both are left installed if you later uninstall agent-setup. They are
general-purpose tools, and this repo does not take things off your PATH that
other software may now depend on.

## Run

```bash
./install.sh --only prereqs --yes
```

## Verify

```bash
./install.sh --only prereqs --check
```

## Rollback

Not removed by `--uninstall`, deliberately — see above. To remove them yourself:

```bash
rm -rf ~/.bun                                   # bun
# Homebrew: https://github.com/homebrew/install#uninstall-homebrew
```
