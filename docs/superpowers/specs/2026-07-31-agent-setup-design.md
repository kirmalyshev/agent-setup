# agent-setup — design

**Date:** 2026-07-31
**Repo:** `github.com/kirmalyshev/agent-setup` (public)
**Status:** implemented and verified; not yet published

## Purpose

A starting Claude Code configuration for people new to coding agents. It
installs three things and explains why each one matters, in a README meant to
be read start to finish before installing anything.

The security hooks began as a private internal baseline and were generalised
for public use.

## Decisions

| Question | Decision |
|---|---|
| Audience | Public — general newcomers, no org membership assumed |
| Security baseline | Vendor the internal hooks in full, de-branded, MIT-licensed |
| Recommendations | README chapters only. No skill or CLAUDE.md snippet, so zero per-session context cost |
| Install UX | `curl \| bash` one-liner, with manual clone documented underneath |
| Repo home | `kirmalyshev`, public |

**Vendoring caveat, recorded:** the internal baseline carried no LICENSE, so
the decision to publish under MIT was made deliberately rather than inherited.

## Architecture

A thin orchestrator plus one module per tool, chosen over extending
the original single 450-line `install.sh` (which would have grown past 600
doing three unrelated jobs) and over a declarative `tools.json` manifest (ruled
out as YAGNI at three tools).

```
bootstrap.sh          clone or fast-forward ~/.agent-setup, hand off
install.sh            resolve the config dir, dispatch to modules, verify
installers/
  common.sh           output helpers, link_into, unlink_if_ours, dry-run wrapper
  security.sh         hooks, skills, /security-scan          FATAL on failure
  rtk.sh              brew install + rtk init -g             warns only
  plugins.sh          caveman, code-review                   warns only
.claude/              vendored from the internal baseline, de-branded
```

### Module contract

Each module defines four functions, where `<id>` is its filename stem:

- `<id>_label` — one line, the section heading
- `<id>_install` — install or update; non-zero on failure
- `<id>_check` — report state; non-zero if incomplete
- `<id>_uninstall` — remove what install added; best effort, always 0

`install.sh` sources them and dispatches by name. Adding a fourth tool is one
new file plus one word in `ALL_MODULES`.

Modules read globals set before dispatch (`DEST_ROOT`, `DEST_LINK`,
`SETTINGS_FILE`, `LIVE_SETTINGS`, `SEED_LIVE`, `DRY_RUN`, `FORCE`) and mutate
exactly one, `PROBLEMS`.

### Failure policy

`security` failing aborts the install. `rtk` and `plugins` failing warn and
continue, and the run ends `PARTIAL` with exit 1. Someone with no Homebrew or no
network still ends up protected — which is the only outcome that matters.

Uninstall runs modules in reverse, so an interrupted removal leaves the
guardrails standing rather than removed.

### Config dir resolution

`--config-dir` > `$CLAUDE_CONFIG_DIR` > `$HOME/.claude`. When
`$CLAUDE_CONFIG_DIR` disagrees with an existing default, the installer stops and
asks rather than picking: a control registered in a dir no session reads looks
installed and protects nothing.

`--settings-file` adds a second write target for setups whose `settings.json` is
generated. Both files are then reported separately by `--check`, because
"registered" and "enforcing" are different claims.

### Verification

| Module | Probe |
|---|---|
| security | the check battery, then a fake `.env` `Read` piped through the *installed* hook via the symlink, expecting exit 2; plus an audit row and a settings-registration check |
| rtk | `rtk hook check "git status"` must return a rewrite; hook entry present in the live settings file |
| plugins | `claude plugin list --json` must show each id present **and** `enabled != false` |

The narrowness of the security probe is deliberate: accepting "output mentions
agent-setup" would also be satisfied by a dangling symlink, since bun's
module-not-found error quotes the path.

## Interfaces

```
./install.sh [--config-dir PATH] [--settings-file F]
             [--only M,...] [--skip M,...]
             [--check | --uninstall] [--dry-run] [--force] [--yes]
```

`AGENT_SETUP_BOOTSTRAP_SELFTEST=1` restricts the run to `security`. The check
battery drives `bootstrap.sh`, which ends in `install.sh`; without this, every
`bun run check` would brew-install and hit the plugin registry.

## Testing

- `bun run test` — 265 unit tests over the detection core and guards
- `bun run check` — 104 checks: preflight, unit, end-to-end (real JSON on real
  stdin through real hook processes), settings-write, audit-trail, and a full
  bootstrap-and-install into a redirected `$HOME`
- `shellcheck` over every shell file
- CI runs all three plus a dry-run and a `--only security` install against an
  empty config dir

## Deliberately not built

- A `tools.json` manifest — three tools do not need a registry
- An installed skill or CLAUDE.md snippet for the recommendations — it would
  cost context tokens in every session to say things the README says once
- Auto-enabling caveman — its `SessionStart` hook reads persisted state, so the
  install leaves it dormant until `/caveman`
- Removing marketplaces on uninstall — shared global state that predates this
  repo on most machines
- Uninstalling the rtk binary — this installer did not necessarily put it there
