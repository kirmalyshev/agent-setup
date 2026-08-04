---
module: plugins
fatal: false
requires: [prereqs]
---
# plugins — caveman and code-review

## Why

Two Claude Code plugins, from two different sources.

**code-review** (Anthropic) gives you `/code-review` over your working diff. The
agent that just wrote the code is the worst reviewer of it — it is working from
the same assumptions that produced the bug. A separate pass with fresh context
catches things the author will not.

**caveman** is a compressed output mode: roughly 75% fewer output tokens, at the
cost of terse, fragment-heavy replies. It is installed **dormant**. Its
SessionStart hook reads persisted state and does nothing until you run
`/caveman`, so nobody is dropped into fragment-speak by an install.

## What it touches

- adds two marketplaces to Claude Code's plugin registry
- installs `caveman` and `code-review` through the `claude plugin` CLI
- `<config>/settings.json` → the `enabledPlugins` block, written by that CLI
- `<config>/agent-setup.plugins` → a record of what this installer installed

This step needs the `claude` CLI and network access. It never edits the plugin
registry or `enabledPlugins` itself — the CLI is the only writer, so there is
one source of truth.

## Run

```bash
./install.sh --only plugins --yes
```

## Verify

```bash
./install.sh --only plugins --check
```

## Rollback

```bash
./install.sh --only plugins --uninstall
```

Removes only the plugins **this installer actually installed**, tracked in
`agent-setup.plugins`. If you already had code-review before running this, it
stays. Marketplaces are left registered.
