#!/usr/bin/env bun
/**
 * PreToolSecurity.hook.ts — the single PreToolUse entry point.
 *
 * One process, one stdin read, four isolated guards:
 *
 *   Read | NotebookRead | Grep   → SensitiveFileGuard
 *   Bash                         → SensitiveFileGuard, SecretDumpGuard, SecretEgressGuard
 *   Write | Edit | MultiEdit     → SecretWriteGuard
 *   WebFetch | WebSearch | mcp__ → SecretEgressGuard
 *
 * Each guard is wrapped so a throw is contained to that guard — a bug in the
 * egress scanner can never disable the sensitive-file block. Guards return
 * verdicts; this file owns the exit contract and the audit write, so there is
 * exactly one place where "what happens on a block" is decided.
 *
 * EXIT CODES:  0 = allow (or `ask`, emitted as JSON)   2 = deny
 *
 * FAIL-OPEN by design. An unparseable stdin, a missing config, a guard that
 * throws — all allow. The threat model here is the accidental leak: an engineer
 * who asks the agent to read `.env`, or an agent that helpfully curls a token
 * somewhere. It is not a sandbox against a motivated insider, and pretending
 * otherwise would be the more dangerous claim. Containment for that is the
 * runtime boundary, not a hook.
 */

import { logAudit } from "./lib/audit";
import { mostSevere, type Guard, type GuardVerdict } from "./lib/guard";
import { allow, ask, deny, readHookInput, warn, type HookInput } from "./lib/hook-io";
import { check as sensitiveFileGuard } from "./guards/SensitiveFileGuard";
import { check as secretDumpGuard } from "./guards/SecretDumpGuard";
import { check as secretEgressGuard } from "./guards/SecretEgressGuard";
import { check as secretWriteGuard } from "./guards/SecretWriteGuard";

function isolate(name: string, fn: Guard, input: HookInput): GuardVerdict | null {
  try {
    return fn(input);
  } catch (err) {
    process.stderr.write(`[agent-setup] ${name} threw: ${String(err)}\n`);
    logAudit({ action: "error", guard: name, reason: String(err) });
    return null;
  }
}

export function guardsFor(tool: string): Array<[string, Guard]> {
  if (tool === "Read" || tool === "NotebookRead" || tool === "Grep") {
    return [["sensitive-file", sensitiveFileGuard]];
  }
  if (tool === "Bash") {
    return [
      ["sensitive-file", sensitiveFileGuard],
      ["secret-dump", secretDumpGuard],
      ["egress", secretEgressGuard],
    ];
  }
  if (tool === "Write" || tool === "Edit" || tool === "MultiEdit" || tool === "NotebookEdit") {
    return [["secret-write", secretWriteGuard]];
  }
  // MCP tools are BOTH surfaces. A server can read a credential file
  // (`mcp__filesystem__read_file{path:".env"}`) and a server can carry one
  // outbound (`mcp__slack__post_message{text:"ghp_…"}`). Routing them to egress
  // alone left every filesystem MCP server able to read .env unchecked.
  if (tool.startsWith("mcp__")) {
    return [
      ["sensitive-file", sensitiveFileGuard],
      ["egress", secretEgressGuard],
    ];
  }
  if (tool === "WebFetch" || tool === "WebSearch") {
    return [["egress", secretEgressGuard]];
  }
  return [];
}

function main(): never {
  const input = readHookInput();
  if (!input) allow();

  const tool = typeof input.tool_name === "string" ? input.tool_name : "";
  const guards = guardsFor(tool);
  if (!guards.length) allow();

  const verdicts: GuardVerdict[] = [];
  for (const [name, fn] of guards) {
    const v = isolate(name, fn, input);
    if (v) verdicts.push(v);
  }

  const verdict = mostSevere(verdicts);
  if (!verdict) allow();

  logAudit(verdict.audit);

  if (verdict.decision === "deny") deny(verdict.message);
  if (verdict.decision === "ask") ask(verdict.message);
  warn(`[agent-setup] ${verdict.message}`);
}

if (import.meta.main) main();
