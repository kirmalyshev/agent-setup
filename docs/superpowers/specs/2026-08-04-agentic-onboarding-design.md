# agentic onboarding + herdr — design

**Date:** 2026-08-04
**Repo:** `github.com/kirmalyshev/agent-setup` (public)
**Status:** implemented and verified, with two amendments below
**Supersedes:** the install UX decided in `2026-07-31-agent-setup-design.md`

## Amendments, 2026-08-06

Two decisions taken after implementation. Recorded here rather than edited into
the body, so the sequence stays legible.

**1. `/setup` → `/run-agent-setup`.** `/setup` is generic enough to collide with
any other plugin wanting the obvious name for its own onboarding. The installed
command is specific to this repo, so it says so. Renamed everywhere including
the symlink, CI assertions and the check battery.

**2. The entry point is a pasted link, not a shell line.** The headline install
is now:

```
https://raw.githubusercontent.com/kirmalyshev/agent-setup/main/INSTALL.md install this into my ~/.claude
```

`INSTALL.md` is written for an agent to execute: resolve the config dir, clone,
`--only onboarding`, hand off to `run-agent-setup.md`. `bootstrap.sh` survives
as the shell equivalent and is what CI drives; both end in the same
`install.sh --only onboarding`, so there is one implementation.

This makes fetched content into instructions, which is worth naming rather than
absorbing. Three things bound it: `INSTALL.md` is short enough to read before
pasting, it delegates to a local procedure the user then has on disk, and every
write still goes through `install.sh`. `check-steps.sh` asserts its paths and
module name resolve — a drifted path there fails on a stranger's machine at the
moment they are deciding whether to trust this, which is the worst time.

## Purpose

Two changes, one shape.

**Install becomes onboarding.** Today `curl | bash` installs everything in one
pass. Someone new to coding agents ends up with four hooks, a CLI proxy, two
plugins and nine skills, having consented to a single line of shell. They can
read the README, but the install does not require it and does not explain
itself while it runs.

The replacement walks module by module inside Claude Code: what this is, why it
matters, exactly what it touches, approve or skip, run, verify, report. The
agent narrates and asks; `install.sh` still does every write.

**herdr joins the baseline.** A terminal multiplexer built for coding agents —
one window instead of six, with per-agent state (running / needs input / done).
It is in homebrew-core and ships a first-class Claude Code integration, so it
fits the existing module contract without new machinery.

## Decisions

| Question | Decision |
|---|---|
| Onboarding entry point | `bootstrap.sh` clones and installs one file — the `/setup` command. Everything else happens inside Claude Code. |
| One-shot `curl \| bash` install | **Replaced.** The one-liner no longer installs the baseline. Unattended installs use `./install.sh --yes` after a clone. |
| Approval granularity | Per module. Seven steps. |
| Where the onboarding copy lives | `install/scripts/NN-<module>.md` — markdown step specs the agent reads. |
| Relationship to `installers/*.sh` | Wraps. `installers/` keeps doing the work; `install.sh` keeps `--only` / `--check` / `--uninstall` / `--dry-run` unchanged. |
| herdr install source | Homebrew only. No `curl \| bash` of a third-party installer from inside ours — same stance as rtk. |
| herdr background server | Not started by the installer. No `brew services`. The step file states that herdr runs a persistent server on first launch. |
| Skills | Split. `security` keeps the two credential skills; the other seven become a skippable `skills` module. |

**Rationale for the skills split:** with all nine inside `security`, "approve the
skills" is not a real choice — declining them means declining the guardrails.
`LlmDataBoundary` and `SecretHygiene` are load-bearing for the security story;
the other seven are workflow conveniences and belong behind their own yes/no.

**Consequence of replacing the one-shot install, recorded:** the curl one-liner
stops being a complete install. CI is unaffected — `ci.yml:53-55` already calls
`./install.sh` directly — but the README must document `./install.sh --yes` as
the unattended path, or repeat users lose it silently.

## Architecture

### Module topology

```
ALL_MODULES="onboarding prereqs security rtk herdr plugins skills"
FATAL_MODULES="prereqs security"
```

| Module | State | What it does | Fatal |
|---|---|---|---|
| `onboarding` | new | symlinks one file: `commands/setup.md` | no |
| `prereqs` | unchanged | bun, Homebrew | yes |
| `security` | changed | 4 hooks, `/security-scan`, 2 credential skills | yes |
| `rtk` | unchanged | brew + `rtk init -g --auto-patch` | no |
| `herdr` | new | brew + `herdr integration install claude` | no |
| `plugins` | unchanged | caveman, code-review | no |
| `skills` | new (split from `security`) | the other 7 skills | no |

Order is dependency order. `onboarding` runs first because it is what
`bootstrap.sh` invokes; `prereqs` installs the toolchain the rest assume;
`security` creates the `<config>/agent-setup` base symlink every later module
links through.

### The three layers

```
install/scripts/NN-<module>.md    narrative — why, what it touches, rollback
        ↑ read by
.claude/commands/setup.md         the agent's procedure
        ↓ invokes
install.sh --only <module>        the only thing that writes
        ↓ sources
installers/<module>.sh            the mechanics (unchanged contract)
```

No install logic is duplicated. The markdown layer holds prose and the exact
commands to run; it never reimplements them.

### Step spec format

```markdown
---
module: herdr
fatal: false
requires: [prereqs]
---
# herdr — one terminal for every agent

## Why
<prose: the problem this solves, in the reader's terms>

## What it touches
- brew install herdr
- <config>/hooks/herdr-agent-state.sh
- <config>/settings.json  (one hook entry)
- runs a persistent background server on first launch

## Run
./install.sh --only herdr --yes

## Verify
./install.sh --only herdr --check

## Rollback
./install.sh --only herdr --uninstall
```

Frontmatter is the machine-readable part: `module` must name a real entry in
`ALL_MODULES`, `fatal` mirrors `FATAL_MODULES`, `requires` documents ordering.

### The `/setup` procedure

```
./install.sh --check                     # what is already here
for each step in install/scripts/*.md, in filename order:
    read the step spec
    present: Why / What it touches / how to undo
    ask: install · skip · tell me more
    if install:
        ./install.sh --only <module> --yes
        ./install.sh --only <module> --check      # evidence, reported back
        on failure: report, offer retry · skip · abort
./install.sh --check                     # final summary
tell the user to restart any open session
```

A fatal module that fails aborts the run. A non-fatal module that fails warns
and continues, matching `install.sh`'s existing behaviour.

### bootstrap.sh

```
clone / fast-forward                     (unchanged)
./install.sh --only onboarding --yes "$@"
print: open Claude Code and run /setup
```

It runs `install.sh` rather than `exec`ing it, so the next-step message is
printed after the symlink exists, and its exit code is propagated.

### Two prerequisites in install.sh

Running `onboarding` first, alone, on a fresh machine breaks two assumptions
the current script makes. Both need fixing before the module can work.

**1. The base symlink.** `install.sh:324` ensures `$DEST_ROOT` exists, but
`$DEST_LINK` (`<config>/agent-setup` → the checkout's `.claude`) is created as a
side effect of `security.sh:54`. `onboarding` links *through* that base, so on a
fresh dir it would produce a dangling `commands/setup.md`. Fix: `link_into
"$SRC_CLAUDE" "$DEST_LINK" "baseline"` moves into a shared helper in
`common.sh`, called by both `onboarding_install` and `security_install`. The
call is idempotent, so ordering stops mattering.

**2. The bun gate.** `install.sh:336` requires bun for every module except
`prereqs` — so `--only onboarding` on a machine without bun exits 1, killing the
bootstrap flow it exists to serve. `onboarding` is a single `link_into`, which
is pure bash. Fix: replace the `!= "prereqs"` test with a list —

```
BUNLESS_MODULES="prereqs onboarding"
```

The same applies to the unconditional `require_bun` at `install.sh:304`, which
must be skipped when every selected module is bunless. Running prereqs first
from bootstrap is not an option: installing Homebrew and bun is exactly the
privileged work the user has not consented to yet.

## The herdr module

`installers/herdr.sh` implements the same six functions as `rtk.sh`:
`herdr_label`, `herdr_present`, `herdr_install`, `herdr_verify`, `herdr_check`,
`herdr_uninstall`.

Verified against herdr 0.7.5 / 0.8.0 on 2026-08-04:

| Property | Value |
|---|---|
| Source | homebrew-core, Apache-2.0, stable 0.8.0 |
| Binary | `herdr` |
| Config-dir scoping | Honours `CLAUDE_CONFIG_DIR` — probed with `herdr integration status` against a scratch dir; the reported path followed it |
| Wiring command | `CLAUDE_CONFIG_DIR="$DEST_ROOT" herdr integration install claude` |
| Writes | `<config>/hooks/herdr-agent-state.sh`, one hook entry in `settings.json` |
| State query | `herdr integration status` → `claude: current (vN)` \| `not installed` \| `outdated (vN < vM)` |
| Uninstall | `herdr integration uninstall claude` |
| Own config | `~/.config/herdr/config.toml` — outside blast radius, never touched, never removed |

**Failure semantics.** `--check` returns 1 only when the binary is absent or
the integration is `not installed`. `outdated` prints a drift note and a re-run
hint, and does not fail: an old integration still works, and failing a check
over it would make `--check` unusable as a health signal.

**Binary retention.** Uninstall removes the integration and leaves the binary,
matching `rtk_uninstall`. The installer did not put a general-purpose tool on
someone's PATH only to take it away when they back out of the Claude Code
wiring.

## Testing

Added to `.github/workflows/ci.yml`:

- `shellcheck installers/herdr.sh` — covered by the existing `installers/*.sh` glob.
- `./install.sh --config-dir "$RUNNER_TEMP/claude" --only onboarding --yes`
  followed by `--only onboarding --check`, asserting the `commands/setup.md`
  symlink exists and resolves.
- `./install.sh --config-dir "$RUNNER_TEMP/claude" --only herdr --dry-run` —
  the plan, on a runner with no Homebrew.
- `./install.sh --config-dir "$RUNNER_TEMP/claude" --only skills --yes` then
  `--check`, asserting the seven skills link and the two credential skills are
  *not* among them.
- **Bunless bootstrap:** `--only onboarding --yes` against a temp config dir
  with bun removed from `PATH`, asserting it succeeds and the symlink resolves.
  This is the fresh-machine case the whole entry point depends on, and nothing
  else in CI covers it.
- **Step-spec consistency:** every module in `ALL_MODULES` has exactly one file
  in `install/scripts/`, every step file's `module:` names a real module, and
  every `fatal:` matches `FATAL_MODULES`. This is the guard against the
  narrative drifting from the mechanics.

Manual verification, on a machine with Homebrew:

- `--only herdr --yes` → `herdr integration status` reports `claude: current`.
- `--only herdr --uninstall` → reports `not installed`, binary still on PATH.
- Full `/setup` run in a real session against a scratch `--config-dir`,
  skipping at least one module, confirming the skip is honoured and the final
  `--check` reports it as absent rather than broken.

## Documentation

`README.md`:

- Install section rewrites to the `/setup` story: one line to bootstrap, then
  `/setup` inside Claude Code.
- `./install.sh --yes` after a clone documented as the unattended path.
- herdr gains a row in the "What you get" table and a chapter alongside the rtk
  chapter, including the background-server behaviour.
- The module table gains `onboarding`, `herdr`, `skills`.

## Out of scope

- Publishing the repo as a Claude Code plugin or marketplace.
- Any change to the four security hooks or the guard logic.
- Windows support for herdr, which upstream marks preview-beta.
- Rewriting `installers/*.sh` — the module contract is unchanged.
