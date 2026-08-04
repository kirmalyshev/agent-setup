#!/usr/bin/env bun
/**
 * PromptSecurity.hook.ts — UserPromptSubmit gate.
 *
 * The single most common way a secret reaches a model is a human pasting it:
 * "here's the token, figure out why the call 401s". By the time the model has
 * seen it, the value is in vendor retention and has to be rotated.
 *
 * This hook runs BEFORE the prompt is sent. On a high-confidence match it
 * blocks with exit 2 — the prompt is discarded, never transmitted, and the
 * engineer gets a rotate-and-resend message. Medium and low findings pass
 * through with a warning appended as context so the model knows not to echo the
 * value back into its reply.
 *
 * FAIL-OPEN: no input, no config, or an internal error lets the prompt through.
 */

import { logAudit } from "./lib/audit";
import { decisionFor, loadConfig } from "./lib/config";
import { formatFindings, peakConfidence, scanText } from "./lib/detect";
import { allow, blockPrompt, box, emitContext, readHookInput } from "./lib/hook-io";

function blockMessage(findings: ReturnType<typeof scanText>): string {
  return box("agent-setup — message NOT sent", [
    "Your message contained what looks like a live credential:",
    formatFindings(findings),
    "",
    "It was blocked before reaching the model, so it is not in vendor retention",
    "and does not need rotating on account of this session.",
    "",
    "Next:",
    "  1. Remove the value from your message.",
    "  2. Describe the credential instead — which provider, which scope, where it",
    "     is configured. That is enough for the agent to help.",
    "  3. If the value came from somewhere it should not be (a Slack thread, a",
    "     ticket, a screenshot), rotate it — that exposure is real.",
    "",
    "If this is a placeholder or a test fixture, append `agent-setup:allow`",
    "to the line, or add the hash to `allowHashes` in",
    "~/.claude/agent-setup.local.json.",
  ]);
}

function warnContext(findings: ReturnType<typeof scanText>): string {
  return [
    "[agent-setup] The user's message contains possible credential material:",
    formatFindings(findings),
    "",
    "Treat these values as sensitive: do not repeat them in your reply, do not",
    "write them to files, and do not include them in any outbound tool call. If",
    "they look live, tell the user to rotate them.",
  ].join("\n");
}

function main(): never {
  const input = readHookInput();
  if (!input || typeof input.prompt !== "string" || !input.prompt) allow();

  const cfg = loadConfig();
  const findings = scanText(input.prompt, { allowHashes: cfg.allowHashes }).filter(
    (f) => !cfg.ignorePatternIds.includes(f.patternId),
  );
  if (!findings.length) allow();

  const peak = peakConfidence(findings);
  if (!peak) allow();
  const decision = decisionFor(cfg, peak);

  logAudit({
    action: decision === "deny" ? "block" : "warn",
    guard: "prompt",
    tool: "UserPromptSubmit",
    session_id: input.session_id,
    cwd: input.cwd,
    findings,
  });

  // `ask` has no meaning on a prompt submit — there is no permission dialog to
  // raise — so it degrades to the warning path rather than silently blocking.
  if (decision === "deny") blockPrompt(blockMessage(findings));
  emitContext("UserPromptSubmit", warnContext(findings));
}

if (import.meta.main) main();
