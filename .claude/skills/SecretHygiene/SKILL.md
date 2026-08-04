---
name: SecretHygiene
description: Use when a security guard blocks a tool call, when a credential has entered a transcript or been committed, when deciding whether something counts as a secret, or when you need to work with credentials without reading their values. Covers the block-response playbook, per-provider rotation, redaction recipes, and how to allowlist a false positive.
---

# Secret hygiene

The hooks stop the mechanical leaks. This skill covers what to do next — which is
where most of the actual damage is either contained or made worse.

## When a guard blocks you

Do not route around it. Re-encoding the command (`base64`, `eval`, `bash -c`,
writing a script that reads the file) defeats the guard and the audit trail at
the same time, and it converts an accidental leak into a deliberate one.

Work through this in order:

1. **Read the block message.** Every one names the rule and offers a concrete
   alternative. That alternative is usually what you actually wanted.
2. **Ask what you needed the value FOR.** Almost always the answer is "so the
   program can authenticate", not "so I can look at it". If a process needs it,
   the process can read it from the environment — you never have to see it.
3. **If you genuinely need the value**, the human reads it in their own terminal,
   outside the agent session, and tells you only what is necessary (which
   provider, which scope, whether it is expired).
4. **If it is a false positive**, allowlist it deliberately — see below.

## Working without reading values

| You want to know | Do this instead of `cat .env` |
|---|---|
| which variables exist | `grep -o '^[A-Z_][A-Z0-9_]*=' .env` (names only, no values) |
| whether a key is set | `test -n "$MY_KEY" && echo set \|\| echo missing` |
| the length / shape | `printf '%s' "$MY_KEY" \| wc -c` |
| whether two envs match | `md5 -q <(printf '%s' "$A") <(printf '%s' "$B")` |
| which keys a service needs | read `.env.example` — that is what it is for |
| run a command with the secret | let the child inherit the environment, or `op run --`, `doppler run --`, `vault agent` |
| the value is wrong somehow | ask the human to check it; report the auth error, not the credential |

## When a credential has already leaked

Treat "it was in a transcript" as "it is public". Model vendors retain
transcripts; so do log aggregators, crash reporters, and support tickets. The
value's blast radius no longer depends on how careful you were afterwards.

**Order of operations — rotate first, clean second.** Cleaning without rotating
leaves a live credential in an unknown number of copies. Rotating without
cleaning leaves a dead credential in a repo, which is untidy but harmless.

1. **Rotate at the provider** (table below). Do this before anything else.
2. **Update every consumer** — local `.env`, CI secrets, deploy env, teammates.
3. **Tell the operator explicitly.** Name the credential, where it appeared, and
   that it needs rotating. Never fix quietly; a leak the team does not know about
   cannot be audited.
4. **Then clean up** the file, the commit, the log.
5. **Check for use.** Most providers expose a last-used timestamp or an audit
   log — that answers "did anyone actually use it" far better than guessing.

### Rotation, by provider

| Credential | Rotate | Then check |
|---|---|---|
| AWS access key | IAM → deactivate, then delete the key pair | CloudTrail for calls with that access key ID |
| GCP service-account key | IAM → Service Accounts → Keys → delete, create new | Cloud Audit Logs for the SA principal |
| Azure storage key | Storage account → Access keys → rotate key1/key2 | Storage analytics logs |
| GitHub PAT / fine-grained | Settings → Tokens → revoke | org audit log, filtered to the token |
| GitLab PAT | Access Tokens → revoke | audit events |
| Anthropic API key | console.anthropic.com → API keys → delete | usage graph for the key |
| OpenAI API key | platform.openai.com/api-keys → revoke | usage per key |
| Stripe secret key (live) | Dashboard → Developers → API keys → roll | Events + logs for unexpected API calls |
| Slack bot/app token | app config → regenerate | audit logs (Enterprise) or app activity |
| npm token | `npm token revoke <id>` | package publish history |
| Database password | rotate the role's password, then the app config | connection logs for unknown source IPs |
| SSH private key | generate a new pair, remove the old public key everywhere | `authorized_keys` on every host that had it |
| JWT / session token | invalidate server-side — a signed JWT stays valid until `exp` | session store, auth logs |
| Webhook URL (Slack, etc.) | delete the webhook and create a new one | anyone with the URL could post as your app |

If the credential belongs to a customer or a third party, it is their incident
too. Say so and escalate; do not decide unilaterally that it was low-impact.

## When a secret has been committed

A rewrite is the only real removal. Anything short of that leaves the value in
the object database, in forks, and in anyone's existing clone.

1. Rotate first (above). Assume the value is burned regardless of cleanup.
2. If the commit is **unpushed**: `git reset --soft HEAD~1`, remove the value,
   recommit.
3. If it is **pushed**: rotation is the fix. History rewriting (`git filter-repo`,
   BFG) is a coordinated operation — force-push, every clone re-based, forks
   unaffected. Propose it to the operator; do not start it unilaterally.
4. Add the path to `.gitignore` so it cannot recur.
5. Confirm with `bun ~/.claude/agent-setup/scripts/scan.ts --staged` before
   the next commit.

## What counts as a secret

**Always:** API keys, tokens, passwords, private keys, connection strings with
credentials, session cookies, signed JWTs, webhook URLs, TLS private keys.

**Also, in practice:** internal hostnames and IPs in bulk (they map the network),
customer identifiers and personal data, unreleased commercial terms, security
findings about your own systems before they are fixed.

**Not secrets:** public keys, key *names* and env var names, key prefixes used
for identification (`sk-ant-…` as a shape), account IDs that appear in public
docs, `.env.example` contents.

**The test that resolves most arguments:** if this appeared in someone else's
logs, would you have to rotate something or notify someone? If yes, it is a
secret, whatever it is called.

## Allowlisting a false positive

Allowlist the narrowest thing that works, and only after confirming the value is
genuinely not live.

1. **One line** — append a marker: `gitleaks:allow`, `pragma: allowlist secret`,
   or `agent-setup:allow`. Best for test fixtures and documentation.
2. **One value everywhere** — add its hash to `allowHashes`. The block message
   prints the hash (`sha256:abc123def456`); paste it in. Safe: the hash cannot
   reconstruct the value.
3. **A directory** — add a glob to `allowPaths`, e.g. `testdata/**`. Scoped as
   tightly as you can; `**` allowlists your whole machine.
4. **A whole rule** — `ignorePatternIds`, `ignorePathRuleIds`, or
   `ignoreDumpCommandIds`. Last resort, and worth a note explaining why.

Personal overrides go in `~/.claude/agent-setup.local.json` (never
committed). Changes that should apply to everyone go in the baseline repo's
`.claude/security.config.json` — as a reviewed change, since it weakens a shared
control.

```json
{
  "allowHashes": ["sha256:abc123def456"],
  "allowPaths": ["testdata/**", "fixtures/**"],
  "ignoreDumpCommandIds": ["docker-env-inspect"]
}
```

If you find yourself allowlisting the same shape repeatedly, the pattern is
wrong — fix `patterns.ts` in the baseline repo and add the false-positive case to
`tests/detect.test.ts`. That fixes it for the whole company instead of one
laptop.

## Escalating a rule

A new leak shape belongs in the baseline, not in a note. Adding one:

1. Add the pattern to `.claude/hooks/lib/patterns.ts` with a confidence and a
   rotation hint. Anchor it on a provider prefix; a bare high-entropy match will
   generate enough noise that people disable the hook.
2. Add both cases to `.claude/hooks/tests/detect.test.ts` — one that must fire,
   one near-identical one that must not.
3. Run `.claude/scripts/run-security-checks.sh`. All green, then open the PR.
