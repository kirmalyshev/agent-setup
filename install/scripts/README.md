# install/scripts — the onboarding steps

One file per step. `/run-agent-setup` reads them in filename order and walks
the user through them: what this is, why it matters, what it touches, approve
or skip, run, verify, report.

These files are **narrative**. They explain and they name the commands to run.
They do not implement anything. Every write goes through `install.sh --only
<module>`, which is the only thing in this repo that changes a machine. Keeping
it that way is what makes `--check` and `--uninstall` true statements about
what happened.

## Format

Frontmatter is the machine-readable part:

```yaml
---
module: herdr        # must name a real entry in ALL_MODULES (install.sh)
fatal: false         # must match FATAL_MODULES (install.sh)
requires: [prereqs]  # ordering, for a reader
---
```

Then four sections, in this order, all required:

| Section | Holds |
|---|---|
| `## Why` | The problem, in the reader's terms. Not a feature list. |
| `## What it touches` | Every path and every side effect. No surprises later. |
| `## Run` | The exact command. |
| `## Verify` | The exact command that produces evidence. |
| `## Rollback` | The exact command that undoes it. |

`.github/workflows/ci.yml` asserts that every module in `ALL_MODULES` has
exactly one step file, that every `module:` names a real module, and that every
`fatal:` matches. That check exists because the failure mode here is silent: a
step file that describes something the installer no longer does reads perfectly
and is wrong.

## Writing the Why

The reader is new to coding agents. They are deciding whether to let software
they have not read change their machine. Two rules:

- Lead with the problem they already have, not the component that solves it.
- Say what it costs. A step that only lists benefits is an advertisement, and
  it teaches the reader that the explanations are not worth reading.
