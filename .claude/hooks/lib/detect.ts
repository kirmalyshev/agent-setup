/**
 * detect.ts — pure detection core. No I/O, no network, no LLM.
 *
 * Everything the guards decide flows from these three functions:
 *   scanText(text)        → SecretFinding[]   credential shapes in a payload
 *   classifyPath(path)    → PathFinding|null  is this file's content off-limits
 *   shannonEntropy(s)     → number            supporting signal for `low` hits
 *
 * Design rules that keep this usable at company scale:
 *   - Suppression happens HERE, once, not in each guard. Placeholders, inline
 *     allow markers, and known documentation credentials never reach a guard.
 *   - Findings carry a redacted preview and a value hash, never the value. A
 *     leak detector that writes secrets to its own log is a leak.
 *   - Overlapping matches collapse to the most specific pattern (catalog order),
 *     so an Anthropic key does not also report as a generic assignment.
 */

import { createHash } from "node:crypto";
import {
  DOC_CONTEXT_RE,
  ENV_SAFE_SUFFIXES,
  INLINE_ALLOW_RE,
  KNOWN_SAMPLE_VALUE_PREFIXES,
  PLACEHOLDER_VALUE_RE,
  SECRET_PATTERNS,
  SENSITIVE_PATHS,
  type Confidence,
  type SecretPattern,
} from "./patterns";

export interface SecretFinding {
  patternId: string;
  label: string;
  confidence: Confidence;
  /** sha256 of the matched value, first 12 hex chars — safe to log and allowlist */
  valueHash: string;
  /** first 4 + last 2 characters, everything else masked */
  preview: string;
  /** 1-based line number within the scanned text */
  line: number;
  rotate?: string;
}

export interface PathFinding {
  ruleId: string;
  why: string;
  path: string;
}

/**
 * Payload cap. Exported so callers can say when they hit it: a scan that
 * silently stopped at 512 KB and reported "clean" is a false all-clear, which is
 * worse than refusing to scan.
 */
export const MAX_SCAN_BYTES = 512 * 1024;

/** True when scanText would only inspect a prefix of this payload. */
export function wouldTruncate(text: string): boolean {
  return text.length > MAX_SCAN_BYTES;
}

export function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/** `sk-ant-api03-Ab…9x` → `sk-a…9x` — enough to recognize, not enough to use. */
export function redact(value: string): string {
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}${"*".repeat(Math.min(value.length - 6, 12))}${value.slice(-2)}`;
}

export function shannonEntropy(s: string): number {
  if (!s) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Luhn check — keeps the card pattern from firing on order IDs and timestamps. */
export function passesLuhn(digits: string): boolean {
  const d = digits.replace(/\D/g, "");
  if (d.length < 13) return false;
  let sum = 0;
  let double = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

/** ISO 7064 mod-97 check — same job for IBANs. */
export function passesIbanChecksum(raw: string): boolean {
  const s = raw.replace(/\s+/g, "").toUpperCase();
  if (s.length < 15 || s.length > 34) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    const chunk =
      code >= 65 && code <= 90 ? String(code - 55) : code >= 48 && code <= 57 ? ch : null;
    if (chunk === null) return false;
    for (const digit of chunk) remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
  }
  return remainder === 1;
}

/**
 * Line-number lookup over a payload, built once per scan.
 *
 * The obvious implementation counts newlines from offset 0 for every finding,
 * which is O(index) per hit and therefore O(n·m) over a payload — inside a
 * PreToolUse hook that blocks every Bash call, on payloads capped at 512 KB.
 * One pass to collect line starts plus a binary search per finding is O(n + m
 * log n) and gives identical answers; detect.test.ts pins them.
 */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

/** 1-based line containing `index`, given the precomputed starts. */
function lineAt(starts: readonly number[], index: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function lineTextAt(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index) + 1;
  let end = text.indexOf("\n", index);
  if (end === -1) end = text.length;
  return text.slice(start, end);
}

function isKnownSample(value: string): boolean {
  return KNOWN_SAMPLE_VALUE_PREFIXES.some((p) => value.startsWith(p));
}

/**
 * Structural validators that turn a shape match into a real finding. Patterns
 * whose id is absent here are accepted as-is.
 */
const VALIDATORS: Record<string, (value: string, lineText: string) => boolean> = {
  "credit-card": (v) => passesLuhn(v),
  iban: (v) => passesIbanChecksum(v),
  // A "secret-named assignment" is only interesting if the value looks opaque.
  "generic-secret-assignment": (v) => shannonEntropy(v) >= 3.0 && /[0-9]/.test(v) && !/\s/.test(v),
};

function matchesFor(text: string, p: SecretPattern): Array<{ value: string; index: number }> {
  const out: Array<{ value: string; index: number }> = [];
  const re = new RegExp(p.re.source, p.re.flags.includes("g") ? p.re.flags : `${p.re.flags}g`);
  for (const m of text.matchAll(re)) {
    const group = p.valueGroup ?? 0;
    const value = m[group] ?? m[0];
    if (!value) continue;
    const offset = group === 0 ? (m.index ?? 0) : (m.index ?? 0) + Math.max(0, m[0].indexOf(value));
    out.push({ value, index: offset });
  }
  return out;
}

export interface ScanOptions {
  /** extra value hashes to suppress — approved dummies from config */
  allowHashes?: readonly string[];
  /** honour `gitleaks:allow`-style inline markers (default true) */
  honourInlineAllow?: boolean;
  /** demote `high` to `medium` when the line reads like documentation (default true) */
  demoteDocContext?: boolean;
}

/**
 * Find credential shapes in an arbitrary payload. Suppression order:
 * inline marker → known sample → allowlisted hash → placeholder → validator.
 */
export function scanText(text: string, opts: ScanOptions = {}): SecretFinding[] {
  if (!text) return [];
  const body = text.length > MAX_SCAN_BYTES ? text.slice(0, MAX_SCAN_BYTES) : text;
  const honourInline = opts.honourInlineAllow !== false;
  const demoteDoc = opts.demoteDocContext !== false;
  const allowHashes = new Set(opts.allowHashes ?? []);

  const raw: Array<SecretFinding & { start: number; end: number; rank: number }> = [];
  const starts = lineStarts(body);

  SECRET_PATTERNS.forEach((p, rank) => {
    for (const { value, index } of matchesFor(body, p)) {
      const lineText = lineTextAt(body, index);
      if (honourInline && INLINE_ALLOW_RE.test(lineText)) continue;
      if (isKnownSample(value)) continue;

      const valueHash = hashValue(value);
      if (allowHashes.has(valueHash)) continue;
      if (PLACEHOLDER_VALUE_RE.test(value)) continue;

      const validate = VALIDATORS[p.id];
      if (validate && !validate(value, lineText)) continue;

      let confidence = p.confidence;
      if (demoteDoc && confidence === "high" && DOC_CONTEXT_RE.test(lineText)) confidence = "medium";

      raw.push({
        patternId: p.id,
        label: p.label,
        confidence,
        valueHash,
        preview: redact(value),
        line: lineAt(starts, index),
        rotate: p.rotate,
        start: index,
        end: index + value.length,
        rank,
      });
    }
  });

  return dedupeOverlapping(raw);
}

/**
 * Collapse overlapping matches. Catalog order is specificity order, so the
 * lowest rank covering a range wins and the rest are dropped.
 */
function dedupeOverlapping(
  raw: Array<SecretFinding & { start: number; end: number; rank: number }>,
): SecretFinding[] {
  const sorted = [...raw].sort((a, b) => a.rank - b.rank || a.start - b.start);
  const claimed: Array<[number, number]> = [];
  const kept: SecretFinding[] = [];

  for (const f of sorted) {
    const overlaps = claimed.some(([s, e]) => f.start < e && f.end > s);
    if (overlaps) continue;
    claimed.push([f.start, f.end]);
    const { start: _s, end: _e, rank: _r, ...finding } = f;
    kept.push(finding);
  }
  return kept.sort((a, b) => a.line - b.line);
}

/** True when a `.env.<suffix>` path is a committed template rather than a secret store. */
export function isTemplateEnvFile(path: string): boolean {
  const base = path.split("/").pop() ?? path;
  const m = base.match(/^\.env\.(.+)$/);
  if (!m) return false;
  return ENV_SAFE_SUFFIXES.includes(m[1].toLowerCase());
}

/** Normalize for path matching: backslashes → slashes, strip quotes and trailing slash. */
export function normalizePath(p: string): string {
  return p
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
}

/** Decide whether a path's CONTENTS are off-limits. Returns null when readable. */
export function classifyPath(rawPath: string, allowPathRes: readonly RegExp[] = []): PathFinding | null {
  const path = normalizePath(rawPath);
  if (!path) return null;
  if (isTemplateEnvFile(path)) return null;
  if (allowPathRes.some((re) => re.test(path))) return null;
  // A .pub key is the half you are meant to share.
  if (/\.pub$/.test(path)) return null;

  for (const rule of SENSITIVE_PATHS) {
    if (rule.re.test(path)) return { ruleId: rule.id, why: rule.why, path };
  }
  return null;
}

/** Highest confidence present in a finding set, or null when empty. */
export function peakConfidence(findings: readonly SecretFinding[]): Confidence | null {
  if (findings.some((f) => f.confidence === "high")) return "high";
  if (findings.some((f) => f.confidence === "medium")) return "medium";
  if (findings.some((f) => f.confidence === "low")) return "low";
  return null;
}

/** One-line-per-finding block, safe to print in a hook message. */
export function formatFindings(findings: readonly SecretFinding[]): string {
  return findings
    .map(
      (f) =>
        `    • ${f.label} [${f.confidence}] line ${f.line} — ${f.preview}  (sha256:${f.valueHash})`,
    )
    .join("\n");
}
