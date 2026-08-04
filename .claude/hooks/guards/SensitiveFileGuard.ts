/**
 * SensitiveFileGuard — stops credential FILES from being read into the context.
 *
 * This is the highest-value rule in the baseline. Nobody pastes their AWS
 * credentials on purpose; they ask the agent to "check the env file" and the
 * whole credential store lands in a transcript that goes to a model vendor, a
 * log aggregator, and possibly a support ticket.
 *
 * Covered surfaces:
 *   Read / NotebookRead   file_path
 *   Grep                  path (a match line from .env is the secret itself)
 *   Bash                  any READER_COMMANDS verb, plus `< file` redirection
 *
 * Deliberately NOT covered: `ls`, `stat`, `test -f`, and `echo .env >>
 * .gitignore`. Those name the path without revealing content, and blocking them
 * is how a security hook earns a reputation for being in the way.
 *
 * FAIL-OPEN: any internal error returns null. A crash here must not stop work.
 */

import { logAudit } from "../lib/audit";
import { allowPathMatchers, decisionFor, loadConfig, type Decision } from "../lib/config";
import { classifyPath, type PathFinding } from "../lib/detect";
import { box, type HookInput } from "../lib/hook-io";
import {
  GIT_READER_SUBCOMMANDS,
  READER_COMMANDS,
  SENSITIVE_PATHS,
} from "../lib/patterns";
import { argsOf, readTargets, segments, verbOf } from "../lib/command-parse";
import { headline, stringField, type GuardVerdict } from "../lib/guard";

const READERS = new Set(READER_COMMANDS);
const GIT_READERS = new Set(GIT_READER_SUBCOMMANDS);

function isReadingSegment(segment: string): boolean {
  const verb = verbOf(segment);
  if (!verb) return false;
  if (verb === "git") {
    const sub = argsOf(segment).find((t) => !t.startsWith("-"));
    return sub ? GIT_READERS.has(sub) : false;
  }
  return READERS.has(verb);
}

/**
 * Field names that carry a filesystem path in MCP tool schemas. Matching on the
 * NAME rather than the value is what keeps this precise: the alternative —
 * classifying every string in tool_input — blocks a chat message whose last word
 * happens to be `.env`.
 */
const PATH_FIELD_RE =
  /^(?:path|paths|file|files|file_path|filepath|filePath|filename|fileName|source|src|target|dest|destination|dir|directory|uri|url|notebook_path|absolute_path)$/i;

/** Path-named string fields in a tool_input, including one level of array. */
function pathLikeFields(toolInput: Record<string, unknown> | undefined): Array<[string, string]> {
  if (!toolInput) return [];
  const out: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(toolInput)) {
    if (!PATH_FIELD_RE.test(key)) continue;
    if (typeof value === "string" && value) out.push([key, value]);
    else if (Array.isArray(value)) {
      for (const v of value) if (typeof v === "string" && v) out.push([key, v]);
    }
  }
  return out;
}

/** `git show HEAD:.env` and `git show :.env` both name the path after a colon. */
function expandGitRefPaths(targets: string[]): string[] {
  const extra: string[] = [];
  for (const t of targets) {
    const idx = t.indexOf(":");
    if (idx >= 0 && idx < t.length - 1) extra.push(t.slice(idx + 1));
  }
  return [...targets, ...extra];
}

function message(finding: PathFinding, surface: string, decision: Decision): string {
  return box(headline("sensitive file read", decision), [
    `Path:     ${finding.path}`,
    `Rule:     ${finding.ruleId} — ${finding.why}`,
    `Surface:  ${surface}`,
    "",
    "Reading this file puts live credentials into the conversation transcript,",
    "which is retained by the model vendor and by any log the session touches.",
    "Once they are in context they must be treated as compromised.",
    "",
    "Do this instead:",
    "  • Need the variable NAMES?     `grep -o '^[A-Z_]*=' .env` or read .env.example",
    "  • Need to know if a key is set? `test -n \"$MY_KEY\" && echo set`",
    "  • Need to run something with it? Let the process inherit the env; do not print it.",
    "  • Genuinely need to see a value? Open it in your own terminal, outside the agent.",
    "",
    "False positive? Add a glob to `allowPaths`, or the rule id to",
    "`ignorePathRuleIds`, in ~/.claude/agent-setup.local.json.",
  ]);
}

function askReason(finding: PathFinding, surface: string): string {
  return `agent-setup: ${surface} targets ${finding.path} (${finding.ruleId} — ${finding.why}). Reading it puts live credentials in the transcript. Approve only if you are certain this file holds no real secrets.`;
}

export function check(input: HookInput): GuardVerdict | null {
  try {
    const cfg = loadConfig();
    const allowRes = allowPathMatchers(cfg);
    const activeRules = new Set(
      SENSITIVE_PATHS.filter((r) => !cfg.ignorePathRuleIds.includes(r.id)).map((r) => r.id),
    );

    const tool = typeof input.tool_name === "string" ? input.tool_name : "";
    const candidates: Array<{ path: string; surface: string }> = [];

    if (tool.startsWith("mcp__")) {
      // A filesystem MCP server reads files with the same consequence as the
      // Read tool, and previously routed only to the egress guard — so
      // `mcp__filesystem__read_file{path:".env"}` was never path-checked at all.
      // Only path-NAMED fields are considered: scanning every string would let a
      // Slack message ending in the words ".env" trip the rule.
      for (const [key, value] of pathLikeFields(input.tool_input)) {
        candidates.push({ path: value, surface: `${tool}(${key}=${value})` });
      }
    } else if (tool === "Read" || tool === "NotebookRead") {
      // NotebookRead names its path `notebook_path`. It was registered in the
      // settings matcher and listed in this file's own coverage comment, but
      // neither routed nor read — documented coverage that did not exist.
      const p = stringField(input, "file_path") || stringField(input, "notebook_path");
      if (p) candidates.push({ path: p, surface: `${tool}(${p})` });
    } else if (tool === "Grep") {
      const p = stringField(input, "path");
      if (p) candidates.push({ path: p, surface: `Grep(path=${p})` });
    } else if (tool === "Bash") {
      const command = stringField(input, "command");
      for (const segment of segments(command)) {
        const redirects = [...segment.matchAll(/(?:^|\s)<\s*([^\s<>|;&]+)/g)].map((m) => m[1]);
        for (const r of redirects) candidates.push({ path: r, surface: `Bash redirection < ${r}` });
        if (!isReadingSegment(segment)) continue;
        const verb = verbOf(segment);
        for (const t of expandGitRefPaths(readTargets(segment))) {
          candidates.push({ path: t, surface: `Bash \`${verb}\`` });
        }
      }
    } else {
      return null;
    }

    for (const c of candidates) {
      const finding = classifyPath(c.path, allowRes);
      if (!finding || !activeRules.has(finding.ruleId)) continue;

      // A credential file read is unambiguous — always treated as high.
      const decision = decisionFor(cfg, "high");
      return {
        decision,
        message:
          decision === "ask" ? askReason(finding, c.surface) : message(finding, c.surface, decision),
        audit: {
          action: decision === "deny" ? "block" : decision === "ask" ? "warn" : "warn",
          guard: "sensitive-file",
          tool,
          session_id: input.session_id,
          cwd: input.cwd,
          path_rule: finding.ruleId,
          detail: c.surface,
          reason: finding.why,
        },
      };
    }
    return null;
  } catch (err) {
    logAudit({ action: "error", guard: "sensitive-file", reason: String(err) });
    return null; // fail-open
  }
}
