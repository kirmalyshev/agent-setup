#!/usr/bin/env bun
/**
 * SessionNotice.hook.ts — SessionStart policy injection.
 *
 * Deterministic hooks stop the mechanical leaks. They cannot stop the model from
 * pasting a customer's data into a research query, because that is a judgement
 * call, not a pattern. So the model gets told the policy once per session, in
 * about twenty lines.
 *
 * Kept short on purpose: this is context budget spent on every single session
 * across the company. Anything that is not load-bearing belongs in the
 * SecretHygiene skill, which loads on demand.
 *
 * Disable with `"sessionNotice": false` in ~/.claude/agent-setup.local.json.
 */

import { loadConfig } from "./lib/config";
import { allow, emitContext, readHookInput } from "./lib/hook-io";

const NOTICE = `[agent-setup policy — active this session]

Deterministic hooks block credential-file reads, credential-dump commands,
outbound secrets, and hardcoded keys in source. They cover shapes, not
judgement. The judgement is yours:

- Never put a credential VALUE in your output, a file, or a tool call. Refer to
  it by name (MY_TOKEN, the staging DB password, the vault path).
- Before any outbound call (WebFetch, WebSearch, MCP, curl), ask what of this
  payload is actually needed. Send the minimum; strip customer identifiers,
  internal hostnames, and employee names that are not required.
- Customer data, personnel data, and unreleased commercial terms do not leave
  the machine in a research query or a third-party tool call. Summarize or
  anonymize first.
- If a credential lands in context anyway, say so plainly and tell the operator
  to rotate it. Do not quietly continue.
- If a guard blocks you, do not route around it — no base64, no eval, no
  \`bash -c\`. Report the block and the alternative it suggested.

Run \`/security-scan\` before sharing a diff, a log, or a repo externally.`;

function main(): never {
  const input = readHookInput();
  const cfg = loadConfig();
  if (!cfg.sessionNotice) allow();
  // `resume` and `compact` restarts already carry the notice in prior context.
  if (input?.source && input.source !== "startup" && input.source !== "clear") allow();
  emitContext("SessionStart", NOTICE);
}

if (import.meta.main) main();
