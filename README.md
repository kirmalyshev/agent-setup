# agent-setup

A starting configuration for [Claude Code](https://claude.com/claude-code), for people new to coding agents.

## Install

Copy this into Claude Code and hit Enter:

```
https://raw.githubusercontent.com/kirmalyshev/agent-setup/main/INSTALL.md install this into my ~/.claude
```

**Nothing is installed by that.** The agent reads [`INSTALL.md`](INSTALL.md), clones the repo to `~/.agent-setup`, and adds one command — `/run-agent-setup`. Then it walks you through the rest: seven steps, each explaining what it is, why it matters and exactly which files it touches, each asking before anything changes. Skip whatever you don't want. A few minutes, most of it reading.

That split is deliberate. An installer that sets up hooks, packages and plugins in one go is asking you to consent to all of it by consenting to none of it.

`INSTALL.md` is about sixty lines and you can open it before you paste it. Worth doing: you're handing a document to something that acts on it. Everything it tells the agent to do runs through `install.sh`, which is the only thing in this repo that writes.

You need `git` and Claude Code. `bun` and Homebrew are offered as the first step, and you can decline them. **Restart any open session when it's done** — hooks load at session start.

<details>
<summary>Prefer a shell command?</summary>

```bash
# same thing: clone, install /run-agent-setup, stop
curl -fsSL https://raw.githubusercontent.com/kirmalyshev/agent-setup/main/bootstrap.sh | bash

# or skip the walkthrough entirely
git clone https://github.com/kirmalyshev/agent-setup ~/.agent-setup
~/.agent-setup/install.sh --yes          # everything, unattended
~/.agent-setup/install.sh --dry-run      # the plan, changing nothing
```

</details>

## What you get

| | What it does | Why |
|---|---|---|
| **security guardrails** | 4 hooks + 2 skills | Stops credentials leaking into transcripts you don't control |
| **[rtk](https://www.rtk-ai.app/)** | Compacts command output | `git status` and `npm test` cost tokens. Often 60–90% less |
| **[herdr](https://herdr.dev/)** | One terminal for every agent | Six windows become one, with per-agent state — see [chapter 3](#3-herdr--one-terminal-for-every-agent) |
| **[caveman](https://github.com/JuliusBrussee/caveman)** | Compressed replies, on demand | ~75% fewer output tokens. Off until you run `/caveman` |
| **[code-review](https://github.com/anthropics/claude-plugins-official)** | `/code-review` over your diff | Catches what the agent that just wrote it won't |
| **9 skills** | Named workflows you invoke | Postmortems, design stress-tests, doc style — see [chapter 6](#6-the-skills) |

Each of these is one step in `/run-agent-setup`, and each is optional except the guardrails. It also offers `bun` and Homebrew if you don't have them — see [Prerequisites](#prerequisites).

---

# 1. Credentials — the one that matters

Everything an agent reads enters its context, and everything in its context is sent to the model vendor and retained. That's how the tool works. The consequence is specific:

> **Asking an agent to "check what's in the env file" puts your whole credential store into a transcript you don't control. The fix at that point is rotation, not deletion.**

Beginners hit this in week one, usually while debugging. The request is reasonable and the damage is invisible.

Credentials have *shapes* — `ghp_`, `sk-ant-`, `AKIA`, a PEM header, a JWT — so they can be caught mechanically. Every decision below is a TypeScript function over a tool call, with a unit test and an audit row. No model asking a model to behave.

### What gets caught

| Leak | Guard |
|---|---|
| "check what's in the env file" → whole store in the transcript | SensitiveFileGuard |
| `env`, `aws secretsmanager get-secret-value`, `op read`, `kubectl get secret -o yaml` | SecretDumpGuard |
| a key gets curled to an API, or posted via MCP into Slack/Linear/Notion | SecretEgressGuard |
| the agent "fixes" auth by hardcoding the key in `config.ts` | SecretWriteGuard |
| you paste a live token into the chat box | PromptSecurity — blocked **before** transmission |
| a credential reaches tool output, then gets echoed into a commit message | PostToolSecurity — marks it burned, orders rotation |

Default posture is **balanced**: high-confidence shapes blocked, medium ones prompt, low ones logged. Audit trail at `~/.claude/security/agent-setup/audit.jsonl`, and no row ever contains the credential itself.

### The half no hook can do

A customer's support thread pasted into a `WebSearch` query has no token shape. No regex will ever catch it. Same for personal data, unreleased pricing, an internal hostname, a colleague's name in a bug report.

Read [`LlmDataBoundary`](.claude/skills/LlmDataBoundary/SKILL.md) once — four sensitivity classes, a ceiling per destination, redaction recipes. In one line:

> **Before any outbound call, ask what of this payload is genuinely needed. Send only that.**

### When a guard blocks you

**Don't route around it.** No base64, no `eval`, no `bash -c` to smuggle the command past. If it's wrong, [`SecretHygiene`](.claude/skills/SecretHygiene/SKILL.md) covers allowlisting properly: an inline `agent-setup:allow` marker, or an entry in `~/.claude/agent-setup.local.json`.

Run `/security-scan` before sharing a diff, a log, or a repo.

---

# 2. rtk — output is not free

A session isn't a conversation. It's a document rewritten and re-sent every turn. That 400-line `npm test` dump you scrolled past isn't gone — you pay for it again on every subsequent message.

rtk sits in front of the shell and compacts about forty tools — git, gh, npm, pytest, cargo, docker, kubectl, grep, tsc, ruff. It's automatic; you never type `rtk` yourself.

```bash
rtk gain        # what it has saved you
rtk discover    # opportunities in your session history
```

**Trade-off:** filtered output can drop the line you needed. When a result looks wrong, re-run with `rtk proxy <cmd>` before blaming the underlying tool.

---

# 3. herdr — one terminal for every agent

The moment you run more than one agent, you're managing windows. One building the feature, one writing tests, one running the server, one you opened to check something and lost. Nothing tells you which is working and which has been waiting ten minutes for you to answer a question.

[herdr](https://herdr.dev/) is a terminal workspace built for that: one window, an agents tab, and per-agent state — running, needs input, done. Sessions survive closing the window, so a long job is still there when you come back.

```bash
herdr                    # launch or attach
herdr status             # client and server state
herdr integration status # which agents report state, and from where
```

**Trade-off:** this is the one thing here that leaves a process running. That server is *how* sessions survive; it isn't an accident. `/run-agent-setup` says so before installing it, and skipping the step costs you nothing else.

No login daemon is registered. herdr suggests `brew services start herdr` — this installer deliberately doesn't run it, because putting something in your login items isn't a decision an installer should make quietly.

---

# 4. caveman — knowing when to spend tokens

Strips articles, filler and pleasantries from replies. *"Sure! I'd be happy to help you with that. The issue you're experiencing is likely caused by…"* becomes *"Bug in auth middleware. Token expiry check use `<` not `<=`. Fix:"*

**Installed dormant.** Nothing changes until you turn it on.

```
/caveman          # on
/caveman lite     # gentler
stop caveman      # off
```

On for long mechanical sessions in a domain you know. Off when you're learning, need an explanation, or will read the output later without today's context. Good default the tenth time you do something; bad one the first.

---

# 5. code-review — before you push

`/code-review` reviews your working diff.

Agent-written code usually works. The failure mode is that it works for the case you described and quietly does the wrong thing on the ones you didn't — an empty list, a duplicate key, a timeout, a second user. A reviewer reading the diff cold catches those. The agent that just wrote it, having convinced itself, doesn't.

---

# 6. The skills

A skill is a named workflow the agent loads on demand. It costs nothing until you
ask for it, so the list can be long without slowing your sessions down.

**Reach for these when you're stuck on thinking, not typing:**

| Skill | Ask for it when |
|---|---|
| **[RootCauseAnalysis](.claude/skills/RootCauseAnalysis/SKILL.md)** | Something broke and you need a real postmortem — Five Whys, fishbone, fault tree, FMEA. Blameless by construction |
| **[RedTeam](.claude/skills/RedTeam/SKILL.md)** | Before you build it. Breaks a plan into atomic claims, attacks each one, ranks what survives by severity |
| **[Council](.claude/skills/Council/SKILL.md)** | A decision with no obvious answer. Several briefed agents debate it in rounds, in front of you |
| **[SystemsThinking](.claude/skills/SystemsThinking/SKILL.md)** | The same problem keeps coming back. Causal loops, archetypes, leverage points |
| **[BitterPillEngineering](.claude/skills/BitterPillEngineering/SKILL.md)** | Your `CLAUDE.md` has grown to 400 lines. Audits every rule against "would a smarter model make this unnecessary?" |

**And these when you are typing:**

| Skill | Ask for it when |
|---|---|
| **[Ship](.claude/skills/Ship/SKILL.md)** | Commit, push and open a PR with tests and review running in parallel first |
| **[TechDocWriting](.claude/skills/TechDocWriting/SKILL.md)** | Writing a README or a runbook. A style guide derived from ASD-STE100 Simplified Technical English |
| **[SecretHygiene](.claude/skills/SecretHygiene/SKILL.md)** | A guard blocked you, or a credential reached a transcript. Rotation playbooks, allowlisting |
| **[LlmDataBoundary](.claude/skills/LlmDataBoundary/SKILL.md)** | Deciding whether something may leave the machine. Read this one before you need it |

`RedTeam` and `Council` spawn several agents each — they cost real tokens. The rest are cheap.

---

# 7. Habits that outlast this repo

Five things. None need any tool.

1. **Say what "done" looks like first.** "Add caching" produces something. "Add caching so the endpoint returns under 200ms on a warm cache, and the test proves it" produces what you wanted.
2. **Demand evidence, not reassurance.** "It should work" is not "I ran it, here's the output."
3. **Work in small, reviewable steps.** A 40-file diff you can't read is one you can't review. Commit often.
4. **Read the diff. Every time.** Code you didn't read and can't explain is code you can't maintain — going into a repo with your name on the commit.
5. **Assume everything in context is transmitted and retained.** Not paranoia; a design constraint, like assuming git history is permanent.

---

# Reference

### Prerequisites

You need these already:

| | |
|---|---|
| **git** | For the checkout the installer keeps updated |
| **curl** | To fetch the installers |
| **Claude Code** | Any recent version. Nothing is patched |

The installer adds these if they are missing:

| | |
|---|---|
| **bun** | Required — the hooks are TypeScript and bun runs them |
| **Homebrew** | For rtk and herdr. On macOS it needs sudo; without it, everything else still installs |

Both come from their projects' own official installers, which means this repo
pipes two remote scripts into a shell — the pattern [chapter 1](#1-credentials--the-one-that-matters)
tells you to distrust. It prints each command before running it, and
`--skip prereqs` opts out entirely if you would rather install them yourself:

```bash
curl -fsSL https://bun.sh/install | bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### Install by hand

```bash
git clone https://github.com/kirmalyshev/agent-setup.git ~/.agent-setup
~/.agent-setup/install.sh --dry-run   # read the plan
~/.agent-setup/install.sh             # do it
```

This is the unattended path, and it skips `/run-agent-setup` entirely. `install.sh` is the
only thing in this repo that writes; `/run-agent-setup` explains each module and calls it
with `--only <module>`. Same code either way — the guided flow adds the
explanations and the yes/no, not the behaviour.

### What it touches

Inside your config dir (`~/.claude` unless `$CLAUDE_CONFIG_DIR` says otherwise), and nowhere else:

```
~/.claude/agent-setup                  → symlink to the checkout's .claude/
~/.claude/skills/<skill>               → symlink per skill
~/.claude/commands/run-agent-setup.md            → symlink, gives you /run-agent-setup
~/.claude/commands/security-scan.md    → symlink
~/.claude/settings.json                → hook entries (backed up first)
~/.claude/hooks/herdr-agent-state.sh   → written by herdr
~/.claude/RTK.md                       → rtk's command reference
~/.claude/CLAUDE.md                    → one `@RTK.md` import line
~/.claude/agent-setup.plugins          → which plugins this installer added
```

Not touched: `~/.config/herdr/config.toml`. That is herdr's own config, and this
repo neither writes nor removes it.

Plus, only when they were missing: `~/.bun` and Homebrew's prefix. Both
installers also append to your shell profile — that is theirs, not ours.

Install is by symlink, so `git -C ~/.agent-setup pull` ships an updated pattern catalog with no re-run. Cost: moving or deleting the checkout breaks the hooks — which `--check` detects.

### Day-to-day

```bash
~/.agent-setup/install.sh --check       # what's installed, and has it drifted
git -C ~/.agent-setup pull              # update
~/.agent-setup/install.sh --uninstall   # put the machine back
```

`--check` is the one to remember. A baseline registered in a config dir your sessions never read looks installed and protects nothing — the worst failure a security control can have.

Uninstall removes the symlinks, hook entries, rtk's and herdr's registrations, and any plugin **this installer added** (tracked in `agent-setup.plugins`). Plugins you already had are left alone, as are marketplaces. The rtk and herdr binaries stay on your PATH — they are useful on their own.

### Installing only part of it

```bash
./install.sh --only security         # guardrails, nothing else
./install.sh --skip herdr,plugins    # everything except these
./install.sh --only skills --uninstall   # back out one module
```

`/run-agent-setup` does the same thing, one module at a time, with the explanations. The
modules are `onboarding`, `prereqs`, `security`, `rtk`, `herdr`, `plugins`,
`skills`.

Every flag: `./install.sh --help`.

### Repo layout

```
INSTALL.md            what an agent fetches and acts on — the paste-a-link entry
bootstrap.sh          the same thing as a shell line, for people who prefer one
install.sh            resolve the config dir, dispatch to modules, verify
installers/
  common.sh           output helpers and symlink primitives
  onboarding.sh       the /run-agent-setup command                     failure warns
  prereqs.sh          bun, Homebrew                          failure is fatal
  security.sh         hooks, 2 skills, /security-scan        failure is fatal
  rtk.sh              brew install + rtk init                failure warns
  herdr.sh            brew install + integration install     failure warns
  plugins.sh          caveman, code-review                   failure warns
  skills.sh           the 7 workflow skills                  failure warns
install/scripts/
  NN-<module>.md      what /run-agent-setup reads out loud, one per module
  check-steps.sh      asserts those files still match install.sh
.claude/
  commands/run-agent-setup.md   the guided-install procedure
  hooks/              four entry points + guards + detection core
  skills/             9 skills, one directory each, CamelCase (see chapter 6)
  scripts/            merge-settings.ts, scan.ts, run-security-checks.sh
```

Modules run in that order. A failure in `prereqs` or `security` stops the install; the rest warn and continue — no Homebrew, no `claude` CLI, no network, still protected.

The step files under `install/scripts/` are narrative only. They explain and they name the commands; they never implement anything, so `--check` and `--uninstall` stay true statements about what happened. `check-steps.sh` runs in CI and fails if a step describes a module that no longer exists, or a fatality that no longer matches — a stale step file reads perfectly and is wrong.

It covers `INSTALL.md` too, and that one matters more: an agent fetches it and acts on it before the user has a checkout to inspect, so a path that has drifted fails on a stranger's machine at the moment they're deciding whether to trust this.

Uninstall never removes bun or Homebrew. They are general toolchains other work depends on.

### Contributing

```bash
bun install
bun run check        # full battery: unit tests + real hooks on real stdin
bun run test         # unit only
bun run typecheck
```

`bun run check` drives the actual hook processes with real JSON on stdin and asserts exit codes, messages, and audit rows — a guard can pass its unit test and still be unreachable because the dispatcher doesn't route its tool.

New patterns go in `.claude/hooks/lib/patterns.ts` with a test alongside. False positives are worth reporting even if you've already worked around them.

### License

MIT — see [LICENSE](LICENSE). The security hooks began as an internal baseline, generalised for public use. rtk, herdr, caveman and code-review are third-party projects with their own licenses; this repo installs them, it doesn't vendor them.
