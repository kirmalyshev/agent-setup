#!/usr/bin/env bun
/**
 * PostToolSecurity.hook.ts — detection layer for what got through.
 *
 * The PreToolUse guards are prevention; they cover known credential FILES and
 * known dump COMMANDS. They cannot cover a hardcoded key sitting in
 * `src/legacy/config.py`, or a credential in an API response body. Those arrive
 * as ordinary tool output.
 *
 * By the time this hook runs the value is already in the context window — that
 * cannot be undone, and this hook does not pretend to undo it. What it does:
 *
 *   1. Writes an audit row, so there is a record that a credential entered a
 *      transcript, with a hash for correlation and no secret in the log.
 *   2. Injects an instruction telling the model to treat the value as burned:
 *      do not echo it, do not persist it, tell the operator to rotate.
 *
 * That second part matters more than it looks. Left unmarked, a model will
 * cheerfully repeat a key it just read into its summary, its commit message, and
 * the file it writes next — turning one exposure into four.
 *
 * FAIL-OPEN. Never blocks: the tool already ran.
 */

import { logAudit } from "./lib/audit";
import { loadConfig } from "./lib/config";
import { formatFindings, peakConfidence, scanText } from "./lib/detect";
import { allow, emitContext, readHookInput, serializeToolInput } from "./lib/hook-io";

/** Tool outputs worth scanning. Everything else is noise or already covered. */
const SCANNED_TOOLS = /^(?:Read|NotebookRead|Grep|Bash|WebFetch|WebSearch|Task|Agent|mcp__)/;

function main(): never {
  const input = readHookInput();
  if (!input) allow();

  const tool = typeof input.tool_name === "string" ? input.tool_name : "";
  if (!SCANNED_TOOLS.test(tool)) allow();

  const cfg = loadConfig();
  if (!cfg.auditToolOutput) allow();

  const body = serializeToolInput(input.tool_response);
  if (!body) allow();

  const findings = scanText(body, { allowHashes: cfg.allowHashes }).filter(
    (f) => !cfg.ignorePatternIds.includes(f.patternId),
  );
  if (!findings.length) allow();

  // Only high-confidence hits are worth interrupting the model's train of
  // thought. Medium/low get an audit row and nothing else — a warning on every
  // `TOKEN = "..."` line in a test fixture is how this hook becomes wallpaper.
  const high = findings.filter((f) => f.confidence === "high");

  logAudit({
    action: "warn",
    guard: "tool-output",
    tool,
    session_id: input.session_id,
    cwd: input.cwd,
    findings,
    reason: high.length ? "credential entered context" : "possible credential in tool output",
  });

  if (!high.length) allow();

  const rotations = [...new Set(high.map((f) => f.rotate).filter(Boolean))];

  emitContext(
    "PostToolUse",
    [
      `[agent-setup] ${high.length} credential${high.length === 1 ? "" : "s"} entered this context from ${tool}:`,
      formatFindings(high),
      "",
      "These values are now in a transcript retained by the model vendor. Treat",
      "them as compromised and act accordingly:",
      "  • Do NOT repeat the value in your reply, a summary, or a commit message.",
      "  • Do NOT write it to a file or pass it to another tool.",
      "  • Refer to it by name only from here on.",
      `  • Tell the operator it needs rotating${peakConfidence(high) === "high" ? " now" : ""}.`,
      ...(rotations.length ? ["", "Rotation:", ...rotations.map((r) => `  • ${r}`)] : []),
    ].join("\n"),
  );
}

if (import.meta.main) main();
