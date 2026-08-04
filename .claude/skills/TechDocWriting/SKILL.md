---
name: TechDocWriting
description: Write or rewrite developer-facing technical documentation (READMEs, docs/, module guides, ADR prose) in a controlled style derived from ASD-STE100 Simplified Technical English. Use when writing, rewriting, or reviewing a technical doc, or when a doc reads like generic LLM prose.
allowed-tools: Read, Glob, Grep, Write, Edit, Bash
---

# Technical documentation style

This skill gives the rules that produce plain, unambiguous prose: a subset of
**ASD-STE100 Simplified Technical English** (STE), adapted for software docs.

The reader is an engineer who is new to this code, is possibly not a native English speaker,
and is scanning under time pressure.

## Scope

Applies to: `README.md`, `docs/`, module guides, `CLAUDE.md`/`AGENTS.md` prose, ADR bodies,
runbooks, migration notes.

Does not apply to:
- End-user documentation. That has a different reader and usually a different style guide.
- Code comments — most repos ask comments for maximum density, and STE trades density for
  readability. Keep comments as they are.
- Commit messages, PR descriptions, chat. Concision wins there.

Two habits do carry everywhere: plain words over formal ones, and the active voice.

## Hard limits

- **20 words** maximum per sentence in procedures (numbered steps, install instructions).
- **25 words** maximum per sentence in descriptive text.
- **One instruction per sentence.** Two actions in one sentence only when they happen together
  ("Stop the service and remove the lock file").
- **6 sentences** maximum per paragraph. One topic per paragraph, and the first sentence states it.
- **No semicolons.** A semicolon licenses a long sentence. Write two sentences.
- Count each of these as one word:
  - A number, or a number with its unit
  - An abbreviation or an identifier
  - `inline_code`, or text in quotation marks
  - A heading, a proper noun, or a parenthesis.

## Verbs and voice

- **Active voice.** Passive is permitted only in descriptive text when the agent is genuinely
  unknown ("The record was deleted at some point before the migration").
  - "The config is read by the loader" → "The loader reads the config".
  - "can be configured" → "you can configure"; "must be set" → "Set".
- **Imperative for instructions.** "The token can then be exported" → "Export the token".
- **Simple tenses only**: infinitive, imperative, simple present, simple past, simple future,
  past participle as an adjective. No present perfect ("has already parsed"), no progressive
  ("is parsing"), no stacked auxiliaries ("is to be validated").
- **No `-ing` verb forms.** Permitted only inside a name: `staging`, `operating system`,
  `Logging` as a heading. "When you are running the tests" → "When you run the tests".
- **Describe an action with a verb, not a noun.** "Before the removal of the row" → "Before you
  remove the row". "performs a validation of" → "validates".
- **No phrasal verbs** — their meaning is not literal. "spin up" → "start", "tear down" →
  "delete", "roll out" → "release", "fall back to" → "use", "pick up" → "read".
- Keep the conjunction **that**: "Make sure that the pod is ready", not "Make sure the pod is ready".
  It marks where the clause starts and survives translation.

## Words

Replace the word on the left with the word on the right. Grouped by the approved word:

- **make sure** ← ensure, verify, confirm, validate, ascertain, assure, check that, establish
- **use** ← utilize, leverage, employ, adopt, make use of
- **do** ← perform, execute, conduct, carry out, implement, undertake (or name the real action)
- **give / supply** ← provide, deliver, present, allocate
- **more** ← additional, further, extra
- **start** ← initiate, commence, begin, kick off, spin up
- **stop** ← terminate, halt, cease, shut down, tear down
- **find** ← detect, discover, determine, identify (when the meaning is "locate")
- **show** ← indicate, display, represent, denote, reveal, surface
- **examine** ← inspect, review, evaluate, scan, search, assess
- **get** ← obtain, acquire, retrieve, fetch, seek, achieve
- **keep** ← retain, persist, store, save, preserve
- **let** ← allow, enable, permit
- **prevent** ← avoid, inhibit, preclude, guard against
- **necessary** ← required, needed, requisite (as an adjective: "A token is necessary")
- **have** ← comprise, consist of, contain (for composition)
- **before / after** ← prior to, in advance of, subsequent to, following (as a preposition)
- **because (of)** ← due to, owing to, as a result of, since (when the meaning is causal)
- **but** ← however, nevertheless, whereas
- **thus / as a result** ← therefore, consequently, hence
- **if** ← whether, in the event of, provided that, should (as in "should it fail")
- **for example** ← e.g., such as, like. Also: **that is** ← i.e.; **and so on** ← etc.
- **primary** ← main, major, principal, key
- **important** ← significant, critical, fundamental, crucial
- **correct / applicable** ← proper, valid, appropriate, suitable, relevant
- **usual** ← normal, standard, conventional, typical
- **again** ← re-anything: "restart" → "start it again", "reuse" → "use it again"
- **must** ← shall, should, has to, needs to. **can** ← may, could, would.
- **at the same time** ← simultaneously, concurrently, in parallel
- **through / with** ← via, by means of
- **in / less than** ← within (for time or size)
- **more than / less than** ← above, below, over, under, exceeds (for values, not positions)

Four verbs are approved only as nouns. Rewrite around them: `test` → "Run a test of X" /
"Do a test of X"; `check` → "Do a check of X" or "make sure that X"; `damage` → "cause damage
to X"; `log` → "record X" or "write X to the log".

Other rules on words:
- **No slang, jargon, or figurative verbs.** "brick the device", "footgun", "safety net",
  "kill switch", "gates the publish", "blast radius", "source of truth" as a metaphor: state
  the literal fact instead.
- **No contractions.** "don't" → "do not".
- **Do not omit articles or words** to shorten a sentence. "If set, use cached value" → "If the
  flag is set, use the cached value."
- **Be concrete about quantity and time.** "periodically" → "every 10 minutes"; "several
  retries" → "three retries"; "shortly after" → the actual condition or duration.
- **One name per thing.** Pick the term the codebase already uses and never vary it for style.
  A "connection", a "connector", and a "link" read as three different objects.
- **One spelling convention.** Pick American or British English and hold it across the repo.
- Keep a **maximum of three words** in a compound noun. "queue message retry limit failure" →
  "a failure when the queue retries a message too many times".

## Software terms are allowed

STE approves domain vocabulary as "technical nouns" and "technical verbs", so do not flatten
real terms into vague ones. These are correct as written: database, cache, firewall, token,
interface, metadata, network, operating system, backup, plug-in, endpoint, schema, index,
authentication, and the project's own identifiers. So are these verbs: boot, reboot, install,
update, upgrade, download, upload, deploy, debug, encrypt, click, enter, open, close, save,
filter, sort, validate, load, process.

The test is whether the term is precise and established, not whether it is short. "The worker
crawls the directory" says something that "the worker reads the directory" does not — keep the
precise verb and let it be a technical verb.

## Never rewrite

Code blocks, commands, paths, environment variables, identifiers, link targets, quoted output,
error strings, table structure, and Mermaid node IDs. In a diagram you may simplify **label
text** only.

STE has no rule against the em dash — it constrains the semicolon, not the dash. Do not hunt
em dashes. If a dash is doing a semicolon's work in a long sentence, the sentence length rule
already catches it.

## Examples

Sentence fragments and implied subjects become full sentences:
> Requires Node 22. All commands run from `src/worker/`.
>
> → Install Node 22 before you start. Run all the commands from `src/worker/`.

A dense clause becomes several sentences:
> It **fails closed**: an unresolved identity or unbuildable access context yields an empty
> search, never the service account's full view.
>
> → The service **fails closed**. If it cannot resolve the identity of the user, the search
> result is empty. The result is the same if it cannot build the access context. The service
> never returns the full view of the service account.

A dense enumeration becomes a vertical list. Put a colon at the end of the lead-in. Start each
item with a capital letter and an article. Put a period after the last item only.

## The cost

STE trades density for clarity. Shorter sentences mean more of them, so a faithful rewrite is
often longer than the original. Accept that as a side effect — do not re-compress to fight it,
and do not pad toward it. Every sentence must still carry information.

The trade is not worth it everywhere. Stop when a rewrite would:
- Lose a precise technical distinction.
- Turn one exact sentence into four vague ones.
- Flatten a nuance that no short form preserves. Move that nuance to the deep reference doc
  rather than pad the README with it.

Report what you dropped, rather than silently losing it.

## Check before you finish

Run this to find sentences over the limit. It joins wrapped lines, and it ignores code blocks,
tables, headings, and inline code. Set `LIMIT` to 20 for a procedural document.

```bash
python3 - <file> <<'PY'
import re, sys
LIMIT = 25
t = open(sys.argv[1]).read()
t = re.sub(r"```.*?```", "", t, flags=re.S)            # drop fenced code
t = re.sub(r"`[^`]*`", "X", t)                          # inline code = 1 word
t = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", t)          # links -> link text
t = t.replace("**", "").replace("__", "")               # emphasis hides sentence ends
t = re.sub(r"[\"“][^\"”]*[\"”]", "X", t)                # quoted text = 1 word (rule 8.6)
t = "\n".join(l for l in t.split("\n") if not l.lstrip().startswith(">"))
for block in re.split(r"\n\s*\n", t):
    block = block.strip()
    if not block or block[0] in "#|>" or block.startswith("    "):
        continue
    for item in re.split(r"\n(?=\s*(?:[-*+]|\d+\.)\s)", block):
        flat = re.sub(r"^(?:[-*+]|\d+\.)\s*", "", " ".join(item.split()))
        for s in re.split(r"(?<=[.:!?])\s+(?=[A-Z(])", flat):
            if len(s.split()) > LIMIT:
                print(len(s.split()), s[:110])
PY
```

A sentence that the script cannot split (no space after the period, an unusual abbreviation)
reports a high count. Read the hit before you rewrite it.

Then confirm by hand:
- [ ] Active voice, imperative for every instruction
- [ ] No `-ing` verbs, no contractions, no semicolons, no Latin abbreviations
- [ ] One instruction per sentence; paragraphs of 6 sentences or fewer
- [ ] One name per thing, used consistently
- [ ] No changed code block, command, identifier, URL, or anchor
