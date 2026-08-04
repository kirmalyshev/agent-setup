/**
 * SecretDumpGuard — stops commands whose only output is a credential.
 *
 * `env`, `printenv`, `aws secretsmanager get-secret-value`, `kubectl get secret
 * -o yaml`, `op read`, `gcloud auth print-access-token`. Each one exists to put
 * a secret on stdout, and stdout is the transcript.
 *
 * Every rule ships with a concrete alternative, because "blocked" without "do
 * this instead" is how a baseline gets bypassed rather than followed.
 *
 * FAIL-OPEN.
 */

import { logAudit } from "../lib/audit";
import { decisionFor, loadConfig, type Decision } from "../lib/config";
import { box, type HookInput } from "../lib/hook-io";
import { NAME_ONLY_PROJECTIONS, SECRET_DUMP_COMMANDS } from "../lib/patterns";
import { normalizeSegment, segments, stripWrappers } from "../lib/command-parse";
import { headline, stringField, type GuardVerdict } from "../lib/guard";

/**
 * `env` piped into a name-only projection prints no values — and it is the very
 * alternative this guard recommends, so it must not trip the same rule.
 * Anything else downstream is assumed to pass values through.
 */
function projectsNamesOnly(nextSegment: string | undefined): boolean {
  if (!nextSegment) return false;
  const normalized = normalizeSegment(nextSegment);
  return NAME_ONLY_PROJECTIONS.some((re) => re.test(normalized));
}

function message(ruleId: string, segment: string, alternative: string, decision: Decision): string {
  return box(headline("credential dump", decision), [
    `Command:  ${segment.slice(0, 120)}`,
    `Rule:     ${ruleId}`,
    "",
    "This command's output is a credential. Anything it prints lands in the",
    "transcript and is retained by the model vendor — the value has to be",
    "considered compromised from that point on.",
    "",
    "Do this instead:",
    `  ${alternative}`,
    "",
    "False positive? Add the rule id to `ignoreDumpCommandIds` in",
    "~/.claude/agent-setup.local.json.",
  ]);
}

export function check(input: HookInput): GuardVerdict | null {
  try {
    if (input.tool_name !== "Bash") return null;
    const cfg = loadConfig();
    const command = stringField(input, "command");
    if (!command) return null;

    const rules = SECRET_DUMP_COMMANDS.filter((r) => !cfg.ignoreDumpCommandIds.includes(r.id));

    const parts = segments(command);
    for (const [index, segment] of parts.entries()) {
      // Match against the unwrapped form so a rewriting proxy cannot hide the
      // rule: `rtk aws secretsmanager get-secret-value` has to match the same
      // rule as the bare command. `normalized` stays the wrapped text so the
      // audit row and the message show what was actually requested.
      const normalized = normalizeSegment(segment);
      const effective = normalizeSegment(stripWrappers(segment));
      for (const rule of rules) {
        if (!rule.re.test(normalized) && !rule.re.test(effective)) continue;
        if (rule.pipelineSensitive && projectsNamesOnly(parts[index + 1])) continue;

        const decision = decisionFor(cfg, "high");
        return {
          decision,
          message:
            decision === "ask"
              ? `agent-setup: \`${normalized.slice(0, 80)}\` prints a credential to the transcript (rule ${rule.id}). ${rule.alternative}`
              : message(rule.id, normalized, rule.alternative, decision),
          audit: {
            action: decision === "deny" ? "block" : "warn",
            guard: "secret-dump",
            tool: "Bash",
            session_id: input.session_id,
            cwd: input.cwd,
            dump_rule: rule.id,
            detail: normalized,
          },
        };
      }
    }
    return null;
  } catch (err) {
    logAudit({ action: "error", guard: "secret-dump", reason: String(err) });
    return null; // fail-open
  }
}
