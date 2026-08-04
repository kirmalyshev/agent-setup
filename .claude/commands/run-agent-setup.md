---
description: Walk through the agent-setup installation one step at a time, explaining and asking before each change
allowed-tools: Bash, Read, Glob, AskUserQuestion
---

# /run-agent-setup — guided installation

You are walking someone through installing agent-setup on their machine. Many
of them are new to coding agents. Treat every step as something they are
entitled to decline.

## The one rule

**`install.sh` is the only thing that writes.** You explain, you ask, you invoke
it, you report what it did. You never install anything yourself — no `brew`, no
`ln -s`, no editing `settings.json`, no writing hook files. If a step fails,
report the failure; do not work around it by hand. A workaround produces a
machine that `--check` and `--uninstall` no longer describe correctly, which is
worse than the failure you were routing around.

## Setup

**First: were you handed a config dir?** If you arrived here from `INSTALL.md`,
or the user named one ("install this into my ~/.claude-work"), that dir is the
answer and you must use it. Set `CFG` to it verbatim and skip the next
paragraph. Getting this wrong is the worst bug this file can have: the
walkthrough installs into a dir the user never chose, and reports success.

Otherwise derive it. You are running as `/run-agent-setup`, which means a
session loaded this file out of the config dir it reads — so the environment is
authoritative here in a way it is not in the handoff:

```bash
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
```

Then resolve the checkout from the baseline symlink, which points straight at
it. Do not hardcode `~/.agent-setup` — the user may have set
`AGENT_SETUP_CHECKOUT`:

```bash
LINK="$CFG/agent-setup"
if [ ! -L "$LINK" ]; then
  printf 'no baseline symlink at %s — stop here\n' "$LINK"
else
  REPO="$(dirname "$(readlink "$LINK")")"
  printf 'config dir: %s\ncheckout:   %s\n' "$CFG" "$REPO"
fi
```

`readlink` with no flags is used on purpose: `-f` is GNU-only and is not
reliable on macOS.

The `-L` test is the check, not the emptiness of the output. `dirname` of an
empty string is `.`, not empty — so a missing link yields a `REPO` of `.`, which
is a valid-looking relative path that silently resolves the step files against
whatever directory you happen to be in.

If the link is missing or dangling, the config dir is not the one this was
installed into, or the install did not complete. Ask the user which dir their
sessions read rather than guessing, and pass `--config-dir "$CFG"` on every
command below.

Read the step files first:

```bash
ls "$REPO"/install/scripts/*.md
```

Read each one. They are in filename order, which is the order you present them.
The frontmatter tells you the module name and whether it is fatal.

## Procedure

**1. Take stock.** Run `./install.sh --check` and read it. Some steps may
already be done — a re-run is normal. Tell the user what is already installed
before you start asking about the rest, so they are not answering questions
about things they already have.

**2. Check for collisions, before asking about anything.** `--check` reports
what *this* installer put there. It says nothing about what was already in the
config dir under the same names, and that is where this goes wrong: a populated
config dir is normal, and the person running this is least able to judge the
consequences.

Every check below prints an explicit result, including when it finds nothing.
Silence is not an all-clear — it is indistinguishable from a command that
failed, and this step exists to produce a statement you are willing to put in
front of the user.

```bash
CFG="<the config dir>"

# skills that already exist, and whether they are ours or theirs
hits=0
for d in "$REPO"/.claude/skills/*/; do
  s="$(basename "$d")"
  if [ -e "$CFG/skills/$s" ]; then
    printf '  %s %s\n' "$s" \
      "$([ -L "$CFG/skills/$s" ] && echo 'symlink' || echo 'REAL DIRECTORY — theirs')"
    hits=1
  fi
done
[ "$hits" -eq 0 ] && echo '  no skill collisions'

# a security layer already REGISTERED — grep settings.json, not the hooks dir.
# A second install can live anywhere on disk; the only thing that makes a hook
# run is an entry in the settings file, so that is what to look at. Match the
# script basename rather than the whole command: commands contain escaped
# quotes, and a "command": "[^"]*" pattern stops at the first one and silently
# misses every hook installed with a quoted path.
#
# Capture first, then test. Piping straight into sort would report sort's exit
# status, so a missing settings.json and a clean one look identical.
hooks="$(grep -oE '[A-Za-z]*(Guard|Security)[A-Za-z]*\.hook\.ts' \
  "$CFG/settings.json" 2>/dev/null | sort -u)"
if [ -n "$hooks" ]; then printf '  already registered:\n%s\n' "$hooks"
else echo '  no security hooks registered'; fi

# tools already registered
printf '  rtk hook entries: %s\n' \
  "$(grep -c 'rtk hook claude' "$CFG/settings.json" 2>/dev/null || echo 0)"
```

Report what you find **before** the first question, and say what it means for
the steps involved:

- **A real directory where a skill would link.** `link_into` refuses it — the
  module fails and nothing is damaged. It only becomes destructive under
  `--force`, which moves their directory aside and links ours over it. If their
  copy is the original and ours is a vendored derivative, that is backwards.
  Say so, and default to skipping the module.
- **An existing security layer.** Ours registers alongside it, not instead of
  it. Two independent guards can both block the same call, which reads as a
  broken tool rather than a working control. Name what is already there and let
  them decide.
- **rtk or the plugins already registered.** The module is idempotent, so
  re-running is safe. It just isn't worth their time.

A user whose config dir was already full should hear that from you in the
summary, not discover it as a failure four steps in.

**3. Frame it once.** Briefly: seven steps, they approve each one, nothing
happens without a yes, and everything is reversible. Do not paste the whole plan
— they will read each step as it comes.

**4. For each step file, in order:**

- Read the step file.
- Present it: the **Why** in your own words, then **What it touches** as a
  concrete list of paths and side effects. Do not editorialise the cost away. If
  a step asks for a password, needs the network, or leaves a process running,
  that goes in the summary you give them, not in a footnote.
- If `--check` reported this module as already installed, say so and offer to
  re-run it (which repairs drift) or move on.
- Ask, with `AskUserQuestion`: install it, skip it, or explain more. If they ask
  for more, answer from the step file and the source under `installers/`, then
  ask again.
- On **install**: run the step's `Run` command, then its `Verify` command.
  Report the actual output — the paths that were written, the check that passed.
  Not "done", not "successfully installed": what it did.
- On **skip**: acknowledge it, note anything downstream that depends on it, move
  on. Do not re-litigate. A skipped step is a decision, not an objection.

**5. On failure:**

- Report exactly what failed, with the output.
- If the module is `fatal: true`, stop. Explain that the steps after it assume
  it, and that continuing produces a setup that looks installed and is not.
  Offer: retry, or stop here and fix the cause.
- If it is not fatal, offer: retry, skip and continue, or stop. Non-fatal
  failures are usually a missing Homebrew or no network, and the rest of the
  install is genuinely unaffected.

**6. Finish.** Run `./install.sh --check` once more and report the real state,
including anything skipped or failed. Then tell them:

- to restart any open session, because hooks load at session start
- where the audit trail is, if security was installed
- that `./install.sh --check` is how they see this again
- that `./install.sh --uninstall` removes all of it

## Tone

Compressed and concrete. This is a person deciding whether to let software they
have not read change their machine, and the explanations are the product. Say
what a thing costs alongside what it does — a step that only lists benefits
teaches them the explanations are not worth reading, and then they stop reading
and just say yes, which defeats the point of asking.

Never say a step is done before you have run its `Verify` command and read the
output.
