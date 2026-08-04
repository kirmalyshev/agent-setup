/**
 * audit.ts — append-only JSONL trail of every security decision.
 *
 * The trail is what makes this baseline defensible to a security reviewer: it
 * shows what fired, on which tool, and what the operator did next. It records
 * pattern ids, confidences, and value HASHES — never a credential, never more
 * than 64 characters of the offending command. A detector that logs secrets has
 * created a second, more durable copy of the leak.
 *
 * Logging never influences a decision: every failure path here is swallowed.
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig } from "./config";
import type { SecretFinding } from "./detect";

export type AuditAction = "block" | "warn" | "allow" | "error";

export interface AuditEvent {
  action: AuditAction;
  /** which guard produced it — sensitive-file, secret-dump, egress, write, prompt, output */
  guard: string;
  tool?: string;
  session_id?: string;
  cwd?: string;
  /** at most 64 chars, secrets already masked by the caller */
  detail?: string;
  findings?: readonly SecretFinding[];
  path_rule?: string;
  dump_rule?: string;
  reason?: string;
}

function safeDetail(detail: string | undefined): string | undefined {
  if (!detail) return undefined;
  return detail.replace(/\s+/g, " ").slice(0, 64);
}

export function logAudit(event: AuditEvent): void {
  try {
    const { auditLog } = loadConfig();
    const dir = dirname(auditLog);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });

    const line = JSON.stringify({
      ts: new Date().toISOString(),
      action: event.action,
      guard: event.guard,
      ...(event.tool ? { tool: event.tool } : {}),
      ...(event.session_id ? { session_id: event.session_id } : {}),
      ...(event.cwd ? { cwd: event.cwd } : {}),
      ...(event.path_rule ? { path_rule: event.path_rule } : {}),
      ...(event.dump_rule ? { dump_rule: event.dump_rule } : {}),
      ...(event.reason ? { reason: event.reason } : {}),
      ...(event.detail ? { detail: safeDetail(event.detail) } : {}),
      ...(event.findings?.length
        ? {
            findings: event.findings.map((f) => ({
              pattern: f.patternId,
              confidence: f.confidence,
              value_sha256: f.valueHash,
              line: f.line,
            })),
          }
        : {}),
    });
    appendFileSync(auditLog, `${line}\n`, { mode: 0o600 });
  } catch {
    /* the audit trail must never break a tool call */
  }
}
