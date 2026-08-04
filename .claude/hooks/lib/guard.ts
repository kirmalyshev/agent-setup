/**
 * guard.ts — the contract every guard implements.
 *
 * A guard is a pure function of the hook input. It returns null (not my
 * business) or a verdict. It does not exit, does not write to stdout, and does
 * not log — the dispatcher owns all three, so guards stay unit-testable and one
 * guard's failure cannot suppress another's decision.
 */

import type { AuditEvent } from "./audit";
import type { Decision } from "./config";
import type { HookInput } from "./hook-io";

export interface GuardVerdict {
  decision: Decision;
  /** fully framed message for deny, or a one-paragraph reason for ask */
  message: string;
  audit: AuditEvent;
}

export type Guard = (input: HookInput) => GuardVerdict | null;

const SEVERITY: Record<Decision, number> = { deny: 3, ask: 2, warn: 1 };

/** Most severe verdict wins; ties keep the earlier guard, which is catalog order. */
export function mostSevere(verdicts: readonly GuardVerdict[]): GuardVerdict | null {
  let best: GuardVerdict | null = null;
  for (const v of verdicts) {
    if (!best || SEVERITY[v.decision] > SEVERITY[best.decision]) best = v;
  }
  return best;
}

/**
 * The headline of a guard's box, told truthfully.
 *
 * Under `audit` posture nothing is stopped — the call runs. A box that says
 * BLOCKED there is a false statement about what just happened, and `audit` is
 * precisely the posture a rollout starts on, so it is where a wrong headline
 * costs the most credibility. Every guard routes its headline through here so
 * the two can never drift apart again.
 */
export function headline(subject: string, decision: Decision): string {
  return decision === "deny"
    ? `agent-setup — ${subject} BLOCKED`
    : `agent-setup — ${subject} ALLOWED (audit posture: recorded, not stopped)`;
}

export function toolNameOf(input: HookInput): string {
  return typeof input.tool_name === "string" ? input.tool_name : "";
}

export function stringField(input: HookInput, field: string): string {
  const v = input.tool_input?.[field];
  return typeof v === "string" ? v : "";
}
