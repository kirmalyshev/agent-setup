/**
 * SecretWriteGuard — stops a credential from being written into source.
 *
 * The failure this prevents: the agent solves an auth problem by hardcoding the
 * key in `config.ts`, the change gets committed, and the secret is now in git
 * history forever — where removing it means a rewrite plus a rotation.
 *
 * The rule is about DESTINATION, not content. Writing a key into `.env`,
 * `.envrc`, or another recognized credential store is correct and allowed;
 * writing the same key into a tracked source file is not. `.env.example` counts
 * as source: it is committed, so a real value there is a real leak.
 *
 * FAIL-OPEN.
 */

import { logAudit } from "../lib/audit";
import { decisionFor, loadConfig, type Decision } from "../lib/config";
import {
  classifyPath,
  formatFindings,
  isTemplateEnvFile,
  peakConfidence,
  scanText,
  type SecretFinding,
} from "../lib/detect";
import { box, type HookInput } from "../lib/hook-io";
import { headline, stringField, type GuardVerdict } from "../lib/guard";

const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/** Everything this call would put on disk, across the tool's various shapes. */
function writtenContent(input: HookInput): string {
  const parts: string[] = [];
  for (const field of ["content", "new_string", "new_source"]) {
    const v = input.tool_input?.[field];
    if (typeof v === "string") parts.push(v);
  }
  const edits = input.tool_input?.edits;
  if (Array.isArray(edits)) {
    for (const e of edits) {
      const ns = (e as Record<string, unknown> | null)?.new_string;
      if (typeof ns === "string") parts.push(ns);
    }
  }
  return parts.join("\n");
}

/**
 * True when the destination is a legitimate place for a live credential.
 *
 * Deliberately ignores `allowPaths`. That setting is a READ exemption — "you may
 * open this file" — and passing it here inverted the guard: allowlisting
 * `testdata/**` made `testdata/.env` stop counting as a credential store, so
 * writing a key into it was blocked as though it were source. One setting, two
 * opposite effects. A `.env` is a credential store whether or not reading it is
 * exempt.
 */
function isCredentialStore(path: string): boolean {
  if (!path) return false;
  if (isTemplateEnvFile(path)) return false; // committed template — not a store
  if (/(?:^|\/)\.envrc$/.test(path)) return true;
  return classifyPath(path) !== null;
}

function message(path: string, findings: readonly SecretFinding[], decision: Decision): string {
  return box(headline("hardcoded credential", decision), [
    `File:     ${path}`,
    "",
    "Detected in the content being written:",
    formatFindings(findings),
    "",
    "This file is not a credential store, so the value would be committed and",
    "then live in git history permanently — where cleaning it up costs a history",
    "rewrite plus a rotation across every consumer.",
    "",
    "Do this instead:",
    "  • Put the value in `.env` (gitignored) and read it via the environment.",
    "  • Reference it by name in code: `process.env.MY_TOKEN` / `os.environ[...]`.",
    "  • In the committed template, write the NAME with an empty or example value.",
    "",
    "False positive? Mark the line `agent-setup:allow`, or add the value hash",
    "to `allowHashes` in ~/.claude/agent-setup.local.json.",
  ]);
}

export function check(input: HookInput): GuardVerdict | null {
  try {
    const tool = typeof input.tool_name === "string" ? input.tool_name : "";
    if (!WRITE_TOOLS.has(tool)) return null;

    const cfg = loadConfig();
    const path = stringField(input, "file_path") || stringField(input, "notebook_path");
    if (isCredentialStore(path)) return null;

    const content = writtenContent(input);
    if (!content) return null;

    const keep = (f: { patternId: string }) => !cfg.ignorePatternIds.includes(f.patternId);
    const findings = scanText(content, { allowHashes: cfg.allowHashes }).filter(keep);

    if (!findings.length) {
      // Inline markers are meant for credentials that ALREADY exist in a file —
      // a fixture, a doc sample. On the write path the marker would be authored
      // in the same breath as the secret, so `TOKEN="ghp_…" // agent-setup:allow`
      // would suppress the guard that exists to stop exactly that line. Rescan
      // ignoring markers; anything that only survived because of one goes to the
      // human instead of being silently written or silently blocked.
      const unsuppressed = scanText(content, {
        allowHashes: cfg.allowHashes,
        honourInlineAllow: false,
      })
        .filter(keep)
        .filter((f) => f.confidence === "high");
      if (!unsuppressed.length) return null;

      return {
        decision: "ask",
        message: `agent-setup: ${unsuppressed.map((f) => f.label).join(", ")} in content written to ${path || "a source file"}, suppressed only by an inline allow marker on the same line. Approve if these really are fixtures; the marker is not evidence on its own when the same edit introduces both.`,
        audit: {
          action: "warn",
          guard: "secret-write",
          tool,
          session_id: input.session_id,
          cwd: input.cwd,
          detail: path,
          findings: unsuppressed,
          reason: "inline-allow marker introduced with the secret",
        },
      };
    }

    const peak = peakConfidence(findings);
    if (!peak) return null;
    const decision = decisionFor(cfg, peak);

    return {
      decision,
      message:
        decision === "ask"
          ? `agent-setup: writing ${findings.map((f) => f.label).join(", ")} (${peak} confidence) into ${path || "a source file"}. Approve only if this is not a live credential.`
          : message(path || "(unnamed)", findings, decision),
      audit: {
        action: decision === "deny" ? "block" : "warn",
        guard: "secret-write",
        tool,
        session_id: input.session_id,
        cwd: input.cwd,
        detail: path,
        findings,
      },
    };
  } catch (err) {
    logAudit({ action: "error", guard: "secret-write", reason: String(err) });
    return null; // fail-open
  }
}
