/**
 * SecretEgressGuard — stops a credential already in context from being sent on.
 *
 * Two surfaces:
 *   MCP / WebFetch / WebSearch  the whole tool_input is scanned. An MCP server
 *                               is a third party: posting a key into a Slack
 *                               message, a Linear ticket, or a Notion page is a
 *                               disclosure, not an internal operation.
 *   Bash egress verbs           curl, wget, ssh, scp, gh, aws, mail … the
 *                               command line carries the payload.
 *
 * The pattern's confidence drives the outcome, so a provider-shaped key denies
 * while a name-based heuristic asks. That split is what makes it safe to leave
 * this on for a whole company.
 *
 * FAIL-OPEN.
 */

import { logAudit } from "../lib/audit";
import { decisionFor, loadConfig, type Decision } from "../lib/config";
import { formatFindings, peakConfidence, scanText, type SecretFinding } from "../lib/detect";
import { box, serializeToolInput, type HookInput } from "../lib/hook-io";
import { EGRESS_COMMANDS, EGRESS_TOOL_PATTERNS } from "../lib/patterns";
import { segments, verbOf } from "../lib/command-parse";
import { headline, stringField, type GuardVerdict } from "../lib/guard";

const EGRESS_VERBS = new Set(EGRESS_COMMANDS);

function isEgressTool(tool: string): boolean {
  return EGRESS_TOOL_PATTERNS.some((re) => re.test(tool));
}

function egressVerbs(command: string): string[] {
  const hits: string[] = [];
  for (const segment of segments(command)) {
    const verb = verbOf(segment);
    if (verb && EGRESS_VERBS.has(verb)) hits.push(verb);
  }
  return hits;
}

function message(tool: string, destination: string, findings: readonly SecretFinding[], decision: Decision): string {
  return box(headline("outbound credential", decision), [
    `Tool:     ${tool}`,
    `Egress:   ${destination}`,
    "",
    "Detected in the outgoing payload:",
    formatFindings(findings),
    "",
    "Sending a credential to a third party is a disclosure. Even if the",
    "destination is trusted, the value now exists in their logs and retention.",
    "",
    "Do this instead:",
    "  • Have the receiving system read the secret from its own secret store.",
    "  • Send a reference (secret name, ARN, vault path), never the value.",
    "  • If the value has already left the machine, rotate it now.",
    "",
    "False positive? Allowlist the value hash in `allowHashes`, or mark the line",
    "with `agent-setup:allow`.",
  ]);
}

export function check(input: HookInput): GuardVerdict | null {
  try {
    const cfg = loadConfig();
    const tool = typeof input.tool_name === "string" ? input.tool_name : "";

    let payload = "";
    let destination = "";

    if (isEgressTool(tool)) {
      payload = serializeToolInput(input.tool_input);
      const url = stringField(input, "url");
      destination = url || tool;
    } else if (tool === "Bash") {
      const command = stringField(input, "command");
      const verbs = egressVerbs(command);
      if (!verbs.length) return null;
      payload = command;
      destination = `\`${verbs.join("`, `")}\``;
    } else {
      return null;
    }
    if (!payload) return null;

    const findings = scanText(payload, { allowHashes: cfg.allowHashes }).filter(
      (f) => !cfg.ignorePatternIds.includes(f.patternId),
    );
    if (!findings.length) return null;

    const peak = peakConfidence(findings);
    if (!peak) return null;
    const decision = decisionFor(cfg, peak);

    return {
      decision,
      message:
        decision === "ask"
          ? `agent-setup: the payload for ${tool} → ${destination} contains ${findings.map((f) => f.label).join(", ")} (${peak} confidence). Approve only if these are not live credentials.`
          : message(tool, destination, findings, decision),
      audit: {
        action: decision === "deny" ? "block" : "warn",
        guard: "egress",
        tool,
        session_id: input.session_id,
        cwd: input.cwd,
        detail: destination,
        findings,
      },
    };
  } catch (err) {
    logAudit({ action: "error", guard: "egress", reason: String(err) });
    return null; // fail-open
  }
}
