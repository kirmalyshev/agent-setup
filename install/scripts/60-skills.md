---
module: skills
fatal: false
requires: [security]
---
# skills — seven named workflows

## Why

A skill is a written procedure the agent follows when you name it. Not a
feature, not a mode — a file describing how to do one thing well, which the
model reads only when you invoke it.

The point is that "review this design" produces something different from
"attack this design", and different again from "find the root cause". Left to
itself the agent gives you the same shape of answer to all three. These name the
difference.

| Skill | What it does |
|---|---|
| `RootCauseAnalysis` | Five Whys, fishbone, blameless postmortem — traces a failure to the system, not the person |
| `RedTeam` | Attacks an idea rather than improving it. Decomposes claims, breaks them, then steelmans |
| `Council` | Several briefed perspectives debating in the open, when you want the disagreement visible |
| `SystemsThinking` | For the problem that keeps coming back. Feedback loops, archetypes, leverage points |
| `BitterPillEngineering` | Audits your own instruction files for rules a better model made unnecessary |
| `TechDocWriting` | Docs in controlled plain English, so they stop reading like generic model prose |
| `Ship` | Stage, commit, push, open a PR, with tests and review in parallel |

These cost nothing until invoked. A skill is a file on disk; it does not run, it
does not consume context, and it does not change how the agent behaves until you
name it.

Skipping them changes nothing else in this setup.

## What it touches

- `<config>/skills/<name>` → one symlink per skill, seven of them

The two credential skills — `LlmDataBoundary` and `SecretHygiene` — are not
here. They came with the security step, because they are part of the protection
rather than a convenience alongside it.

## Run

```bash
./install.sh --only skills --yes
```

## Verify

```bash
./install.sh --only skills --check
```

## Rollback

```bash
./install.sh --only skills --uninstall
```
