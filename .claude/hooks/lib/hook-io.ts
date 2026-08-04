/**
 * hook-io.ts — stdin/stdout contract with Claude Code, in one place.
 *
 * Three outcomes, matching the three enforcement levels:
 *
 *   deny  → stderr + exit 2. The tool call does not run; the message goes to
 *           the model so it can correct course itself.
 *   ask   → permissionDecision "ask". The human decides. This is where medium-
 *           confidence findings land: a false positive costs one keypress, not
 *           a broken workflow.
 *   warn  → exit 0 with a stderr note and an audit row. Nothing is interrupted.
 *
 * Every reader is capped and every parse failure yields null, which the guards
 * treat as "not our business". A security hook that crashes the session gets
 * uninstalled by lunchtime.
 */

import { readFileSync } from "node:fs";

const STDIN_CAP_BYTES = 4 * 1024 * 1024;

export interface HookInput {
  hook_event_name?: string;
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  prompt?: string;
  source?: string;
}

export function readHookInput(): HookInput | null {
  try {
    const buf = readFileSync(0);
    if (buf.byteLength > STDIN_CAP_BYTES) return null;
    const raw = buf.toString("utf-8");
    if (!raw.trim()) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as HookInput;
  } catch {
    return null;
  }
}

const RULE = "─".repeat(74);

/** Consistent framing so a block is unmistakable in a wall of tool output. */
export function box(title: string, lines: string[]): string {
  return ["", RULE, `  ${title}`, RULE, "", ...lines.map((l) => (l ? `  ${l}` : "")), "", RULE, ""].join(
    "\n",
  );
}

export function deny(message: string): never {
  process.stderr.write(message.endsWith("\n") ? message : `${message}\n`);
  process.exit(2);
}

export function ask(reason: string): never {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: reason,
      },
    })}\n`,
  );
  process.exit(0);
}

export function warn(message: string): never {
  process.stderr.write(message.endsWith("\n") ? message : `${message}\n`);
  process.exit(0);
}

export function allow(): never {
  process.exit(0);
}

/** PostToolUse / UserPromptSubmit / SessionStart context injection. */
export function emitContext(event: string, additionalContext: string): never {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: { hookEventName: event, additionalContext },
    })}\n`,
  );
  process.exit(0);
}

/** UserPromptSubmit block: the prompt is discarded and the message shown to the human. */
export function blockPrompt(message: string): never {
  process.stderr.write(message.endsWith("\n") ? message : `${message}\n`);
  process.exit(2);
}

/** Serialize a tool_input for scanning, tolerating anything non-serializable. */
export function serializeToolInput(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input);
  } catch {
    return "";
  }
}
