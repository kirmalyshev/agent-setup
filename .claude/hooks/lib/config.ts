/**
 * config.ts — layered configuration for the security baseline.
 *
 * Three layers, most specific wins:
 *   1. built-in defaults (this file)                       — safe without any config
 *   2. <repo>/.claude/security.config.json                 — the company baseline, committed
 *   3. ~/.claude/agent-setup.local.json                 — per-engineer overrides, never committed
 *
 * `posture` is the single dial an engineer normally touches:
 *   strict    block high + medium         — for repos touching production credentials
 *   balanced  block high, warn the rest   — the shipped default
 *   audit     warn everything, block none — pilot mode / noisy legacy repos
 *
 * Everything fails OPEN on a malformed config: a broken JSON file must not brick
 * every tool call in the session. A config error is surfaced on stderr once and
 * the built-in defaults take over.
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Confidence } from "./patterns";

export type Posture = "strict" | "balanced" | "audit";

export interface SecurityConfig {
  posture: Posture;
  /** confidence levels that produce a hard block (derived from posture unless overridden) */
  blockConfidence: Confidence[];
  /** pattern ids never reported, at any confidence */
  ignorePatternIds: string[];
  /** approved dummy values, by `sha256:<12hex>` or bare 12-hex hash */
  allowHashes: string[];
  /** glob patterns whose files may be read even if they match SENSITIVE_PATHS */
  allowPaths: string[];
  /** SENSITIVE_PATHS rule ids to disable wholesale */
  ignorePathRuleIds: string[];
  /** SECRET_DUMP_COMMANDS ids to disable wholesale */
  ignoreDumpCommandIds: string[];
  /** inject the one-screen policy reminder at session start */
  sessionNotice: boolean;
  /** absolute path of the JSONL audit log */
  auditLog: string;
  /** scan PostToolUse responses for credentials that already entered context */
  auditToolOutput: boolean;
}

const POSTURE_BLOCKS: Record<Posture, Confidence[]> = {
  strict: ["high", "medium"],
  balanced: ["high"],
  audit: [],
};

function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

/**
 * The Claude Code config dir these hooks belong to. Honours CLAUDE_CONFIG_DIR
 * for the same reason install.sh takes --config-dir: the per-engineer override
 * file and the audit log have to live in the SAME tree the hooks were installed
 * into. Split those across two trees and an engineer edits an override that
 * nothing reads, which is worse than having no override mechanism at all.
 *
 * The invariant that makes env-or-default sufficient: Claude Code reads exactly
 * two possible config dirs — $CLAUDE_CONFIG_DIR when exported, otherwise
 * $HOME/.claude. So a session that loaded these hooks necessarily resolves the
 * same dir install.sh wrote them into; there is no third case where a custom dir
 * is active without the variable being set.
 */
export function claudeConfigDir(): string {
  const fromEnv = process.env.CLAUDE_CONFIG_DIR;
  return fromEnv ? expandHome(fromEnv) : join(homedir(), ".claude");
}

const DEFAULTS: SecurityConfig = {
  posture: "balanced",
  blockConfidence: POSTURE_BLOCKS.balanced,
  ignorePatternIds: [],
  allowHashes: [],
  allowPaths: [],
  ignorePathRuleIds: [],
  ignoreDumpCommandIds: [],
  sessionNotice: true,
  auditLog: join(claudeConfigDir(), "security", "agent-setup", "audit.jsonl"),
  auditToolOutput: true,
};

function readJsonIfPresent(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null;
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch (err) {
    process.stderr.write(`[agent-setup] ignoring malformed config ${path}: ${String(err)}\n`);
    return null;
  }
}

function strArray(v: unknown, fallback: string[]): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : fallback;
}

function apply(base: SecurityConfig, raw: Record<string, unknown> | null): SecurityConfig {
  if (!raw) return base;
  const next: SecurityConfig = { ...base };

  if (raw.posture === "strict" || raw.posture === "balanced" || raw.posture === "audit") {
    next.posture = raw.posture;
    next.blockConfidence = POSTURE_BLOCKS[raw.posture];
  }
  if (Array.isArray(raw.blockConfidence)) {
    next.blockConfidence = raw.blockConfidence.filter(
      (c): c is Confidence => c === "high" || c === "medium" || c === "low",
    );
  }
  next.ignorePatternIds = strArray(raw.ignorePatternIds, base.ignorePatternIds);
  next.allowHashes = strArray(raw.allowHashes, base.allowHashes).map((h) =>
    h.replace(/^sha256:/, ""),
  );
  next.allowPaths = strArray(raw.allowPaths, base.allowPaths);
  next.ignorePathRuleIds = strArray(raw.ignorePathRuleIds, base.ignorePathRuleIds);
  next.ignoreDumpCommandIds = strArray(raw.ignoreDumpCommandIds, base.ignoreDumpCommandIds);
  if (typeof raw.sessionNotice === "boolean") next.sessionNotice = raw.sessionNotice;
  if (typeof raw.auditToolOutput === "boolean") next.auditToolOutput = raw.auditToolOutput;
  if (typeof raw.auditLog === "string" && raw.auditLog) next.auditLog = expandHome(raw.auditLog);

  return next;
}

/**
 * The baseline config lives next to the hooks. It has to be findable three ways,
 * because installs differ: straight out of the checkout, through the
 * ~/.claude/agent-setup symlink, and through a realpath-resolved entry point
 * (Bun resolves symlinked entry files, so import.meta.url may already point into
 * the repo). Cheap to check all three; expensive to debug when one is missing.
 */
function repoConfigCandidates(): string[] {
  // fileURLToPath, NOT `new URL(...).pathname` — the latter keeps percent
  // encoding, so a checkout under `~/my repo/` resolved to `…/my%20repo/…`,
  // no candidate existed, and the committed baseline was silently discarded:
  // posture fell back to `balanced` and every allowPaths / ignore* entry with
  // it. A strict org would have been downgraded without a word.
  const here = dirname(fileURLToPath(import.meta.url)); // …/hooks/lib
  const candidates = [
    join(resolve(here, "..", ".."), "security.config.json"),
    join(claudeConfigDir(), "agent-setup", "security.config.json"),
  ];
  try {
    const real = realpathSync(here);
    candidates.unshift(join(resolve(real, "..", ".."), "security.config.json"));
  } catch {
    /* not a symlink, or unreadable — the other candidates cover it */
  }
  return [...new Set(candidates)];
}

function readFirstPresent(paths: readonly string[]): Record<string, unknown> | null {
  for (const p of paths) {
    const parsed = readJsonIfPresent(p);
    if (parsed) return parsed;
  }
  return null;
}

let cached: SecurityConfig | null = null;

export function loadConfig(): SecurityConfig {
  if (cached) return cached;

  // Test/CI isolation: when set, this file is the ONLY layer above the defaults.
  // The check battery uses it so a teammate's local overrides cannot change what
  // the tests assert, and so test runs never touch the real audit log.
  //
  // It REPLACES the whole cascade, which makes it a weakening lever as much as a
  // test seam: anything able to set an environment variable can point enforcement
  // at `{"posture":"audit"}`. That is not a boundary this project claims to hold
  // — anyone who can set your environment can also edit your settings.json — but
  // it is worth documenting rather than leaving to be discovered, so the README
  // names it under Configuration.
  //
  // Deliberately silent: announcing it on stderr would print on EVERY hook
  // invocation, which means every tool call in a session, which is how a
  // security hook becomes noise people mute.
  const testConfig = process.env.AGENT_SETUP_TEST_CONFIG;
  if (testConfig) {
    cached = apply(DEFAULTS, readJsonIfPresent(testConfig));
    return cached;
  }

  let cfg = DEFAULTS;
  cfg = apply(cfg, readFirstPresent(repoConfigCandidates()));
  cfg = apply(cfg, readJsonIfPresent(join(claudeConfigDir(), "agent-setup.local.json")));
  // A project-local override, for a repo that is not the baseline repo itself.
  if (process.env.CLAUDE_PROJECT_DIR) {
    cfg = apply(
      cfg,
      readJsonIfPresent(join(process.env.CLAUDE_PROJECT_DIR, ".claude", "agent-setup.json")),
    );
  }
  cached = cfg;
  return cfg;
}

/** Test seam — lets the battery exercise postures without touching disk. */
export function overrideConfigForTests(cfg: Partial<SecurityConfig>): SecurityConfig {
  cached = { ...DEFAULTS, ...cfg };
  return cached;
}

export function resetConfigCache(): void {
  cached = null;
}

export function shouldBlock(cfg: SecurityConfig, confidence: Confidence): boolean {
  return cfg.blockConfidence.includes(confidence);
}

export type Decision = "deny" | "ask" | "warn";

/**
 * The enforcement ladder. Anything the posture blocks is denied outright;
 * everything one notch below it is escalated to the human instead of being
 * silently allowed or silently blocked. That middle rung is what keeps false
 * positives cheap — one keypress, not a broken workflow.
 */
export function decisionFor(cfg: SecurityConfig, confidence: Confidence): Decision {
  if (cfg.blockConfidence.includes(confidence)) return "deny";
  const rank: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };
  const lowestBlocked = cfg.blockConfidence.reduce(
    (min, c) => Math.min(min, rank[c]),
    Number.POSITIVE_INFINITY,
  );
  // The rung directly beneath the block threshold asks; below that, warn.
  return rank[confidence] === lowestBlocked - 1 ? "ask" : "warn";
}

/** Minimal glob → RegExp: `**` crosses separators, `*` does not, `?` is one char. */
export function globToRegExp(glob: string): RegExp {
  const expanded = expandHome(glob);
  let out = "";
  for (let i = 0; i < expanded.length; i++) {
    const ch = expanded[i];
    if (ch === "*") {
      if (expanded[i + 1] === "*") {
        out += ".*";
        i++;
        if (expanded[i + 1] === "/") i++;
      } else {
        out += "[^/]*";
      }
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      continue;
    }
    out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  // Unanchored at the front so `tests/fixtures/**` matches an absolute path too.
  return new RegExp(`(?:^|/)${out}$`);
}

export function allowPathMatchers(cfg: SecurityConfig): RegExp[] {
  return cfg.allowPaths.map(globToRegExp);
}
