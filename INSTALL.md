# Install agent-setup

A starting Claude Code configuration: credential guardrails, token-compacting
tooling, and a set of named workflows. Source: <https://github.com/kirmalyshev/agent-setup>

**You are an agent, and someone pasted this link at you.** Read the whole file
before running anything. It is short on purpose — you are about to change
someone's machine on the strength of a document they may not have opened.

## Before you touch anything

Tell them, in about three lines: what this is, that it clones a repo to
`~/.agent-setup` and adds one command, and that nothing else gets installed
until they say yes to it individually. Then do the steps below.

If they asked for a specific config dir — "install this into my ~/.claude" —
use it. Otherwise use `$CLAUDE_CONFIG_DIR` if it is set, and `~/.claude` if it
is not. Say which one you picked. Hooks are only enforced in the dir their
sessions actually read, and a baseline installed in the wrong one looks
installed and protects nothing.

## Steps

**1. Check the prerequisites.** `git` must be on PATH. That is the only one —
`bun` and Homebrew are offered later, as a step the user can decline.

**2. Clone the repo.**

```bash
git clone https://github.com/kirmalyshev/agent-setup ~/.agent-setup
```

If `~/.agent-setup` already exists and is a checkout of this repo, run
`git -C ~/.agent-setup pull --ff-only` instead. If it exists and is something
else, stop and ask — do not write into a directory you did not create.

**3. Install the onboarding command, and nothing else.**

```bash
~/.agent-setup/install.sh --only onboarding --yes --config-dir <the dir you picked>
```

This links one file. It does not register hooks, install packages, or write
settings. If it fails, report the failure and stop.

**4. Hand off to the procedure — carrying the config dir with you.**

Read `~/.agent-setup/.claude/commands/run-agent-setup.md` and follow it. It is
the walkthrough: seven modules, each explaining what it does and what it
touches, each asking before anything changes. Do not summarise it away or skip
ahead — the explanations are the product here, not packaging around it.

**The dir you picked in step 1 is the dir the walkthrough must use.** It cannot
work this out for itself: that file is normally invoked as `/run-agent-setup`,
where the session's own config dir is the right answer, so it reads the
environment. Coming from here, the environment is *your* session's config dir,
which is not necessarily the one you just installed into. Pass yours in
explicitly and use `--config-dir` on every command it tells you to run.

Getting this wrong is silent rather than loud. If a baseline symlink already
exists at the default `~/.claude` — from an earlier install, say — the
walkthrough resolves it, finds a valid checkout, and installs seven modules into
a config dir the user never asked for, reporting success the whole way.

The user can also run `/run-agent-setup` in a new session to get the same
walkthrough later, or to repair a setup that drifted.

## The one rule

**`install.sh` is the only thing that writes.** Do not `brew install`, do not
`ln -s`, do not edit `settings.json`, do not write hook files. If a step fails,
report it; do not work around it by hand. A workaround produces a machine that
`--check` and `--uninstall` no longer describe correctly, which is worse than
the failure you were routing around.

Everything is reversible: `~/.agent-setup/install.sh --uninstall`.
