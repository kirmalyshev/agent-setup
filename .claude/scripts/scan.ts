#!/usr/bin/env bun
/**
 * scan.ts — the same detection core, on demand.
 *
 * The hooks guard what an agent does. This guards what a human is about to do:
 * share a diff, attach a log, publish a repo, paste a config into a ticket. Same
 * catalog, same suppression rules, so a clean scan means the same thing in both
 * places.
 *
 *   bun .claude/scripts/scan.ts <path…>        walk files and directories
 *   bun .claude/scripts/scan.ts --staged       scan the staged diff
 *   bun .claude/scripts/scan.ts --diff main    scan the diff against a ref
 *   … | bun .claude/scripts/scan.ts --stdin    scan a pipe (logs, env dumps)
 *
 *   --json      machine-readable output for CI
 *   --all       report medium and low findings too (default: high only)
 *   --quiet     exit code only
 *
 * EXIT: 0 clean · 1 findings at the reported level · 2 usage error
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { allowPathMatchers, loadConfig } from "../hooks/lib/config";
import { classifyPath, scanText, wouldTruncate, type SecretFinding } from "../hooks/lib/detect";

const SKIP_DIRS = new Set([
  ".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build",
  ".next", ".nuxt", "target", ".terraform", "vendor", ".mypy_cache",
  ".pytest_cache", ".turbo", ".cache", "coverage",
]);

const BINARY_EXT =
  /\.(?:png|jpe?g|gif|webp|avif|ico|svgz|pdf|zip|gz|tgz|bz2|xz|7z|rar|mp3|mp4|mov|avi|wav|flac|woff2?|ttf|otf|eot|so|dylib|dll|exe|bin|dat|wasm|class|jar|pyc|o|a|lock)$/i;

const MAX_FILE_BYTES = 2 * 1024 * 1024;

interface FileResult {
  path: string;
  findings: SecretFinding[];
  /** set when the file itself is a credential store we refused to scan into */
  sensitivePath?: string;
  /** the file exceeded the scan cap, so a clean result covers only its prefix */
  truncated?: boolean;
  /** the file was never opened — larger than MAX_FILE_BYTES */
  skipped?: string;
}

function walk(root: string, out: string[]): void {
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(root);
  } catch {
    return;
  }
  if (st.isFile()) {
    out.push(root);
    return;
  }
  if (!st.isDirectory()) return;

  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    walk(join(root, name), out);
  }
}

function scanFile(
  path: string,
  allowHashes: readonly string[],
  allowRes: readonly RegExp[],
): FileResult | null {
  // A .env is expected to be full of secrets; reporting each line is noise.
  // Flag the FILE, and let the caller confirm it is gitignored. `allowRes` is
  // honoured here so the CLI and the hooks agree about the same repo — without
  // it, an allowlisted fixture dir was exempt in a session and reported here.
  const sensitive = classifyPath(path, allowRes);
  if (sensitive) return { path, findings: [], sensitivePath: sensitive.ruleId };

  if (BINARY_EXT.test(path)) return null;
  let body: string;
  try {
    const st = statSync(path);
    // Never opened is not the same as clean. Silently dropping the file made a
    // scan report success over content it had not looked at — the same false
    // all-clear the truncation branch below exists to prevent.
    if (st.size > MAX_FILE_BYTES) {
      return {
        path,
        findings: [],
        skipped: `${(st.size / (1024 * 1024)).toFixed(1)} MB — larger than the ${MAX_FILE_BYTES / (1024 * 1024)} MB per-file limit`,
      };
    }
    body = readFileSync(path, "utf-8");
  } catch {
    return null;
  }
  if (body.includes("\0")) return null; // binary we did not predict

  const findings = scanText(body, { allowHashes });
  const truncated = wouldTruncate(body);
  return findings.length || truncated ? { path, findings, truncated } : null;
}

function gitDiff(args: string[]): string {
  const proc = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    process.stderr.write(new TextDecoder().decode(proc.stderr));
    process.exit(2);
  }
  return new TextDecoder().decode(proc.stdout);
}

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Bun.stdin.stream()) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

function main(): Promise<void> | void {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const positional = argv.filter((a) => !a.startsWith("--"));
  const cfg = loadConfig();
  const allowHashes = cfg.allowHashes;

  const asJson = flags.has("--json");
  const reportAll = flags.has("--all");
  const quiet = flags.has("--quiet");

  const results: FileResult[] = [];

  const finish = () => {
    const filtered = results
      .map((r) => ({
        ...r,
        findings: r.findings.filter(
          (f) => (reportAll || f.confidence === "high") && !cfg.ignorePatternIds.includes(f.patternId),
        ),
      }))
      .filter((r) => r.findings.length || r.sensitivePath || r.truncated || r.skipped);

    if (asJson) {
      process.stdout.write(`${JSON.stringify({ posture: cfg.posture, results: filtered }, null, 2)}\n`);
    } else if (!quiet) {
      if (!filtered.length) {
        process.stdout.write(`✔ agent-setup: no ${reportAll ? "" : "high-confidence "}findings\n`);
      } else {
        for (const r of filtered) {
          if (r.skipped) {
            process.stdout.write(
              `\n! ${r.path}\n    NOT SCANNED — ${r.skipped}. Scan it separately, or exclude it deliberately.\n`,
            );
            continue;
          }
          if (r.truncated && !r.findings.length) {
            process.stdout.write(
              `\n! ${r.path}\n    larger than the scan cap — only the first 512 KB was inspected, so this is NOT a clean result\n`,
            );
            continue;
          }
          if (r.sensitivePath) {
            process.stdout.write(
              `\n! ${r.path}\n    credential store (${r.sensitivePath}) — confirm it is gitignored and never attached to a ticket\n`,
            );
            continue;
          }
          process.stdout.write(`\n✖ ${r.path}\n`);
          for (const f of r.findings) {
            process.stdout.write(
              `    ${f.line}: ${f.label} [${f.confidence}] ${f.preview}  (sha256:${f.valueHash})\n`,
            );
          }
        }
        const count = filtered.reduce((n, r) => n + Math.max(r.findings.length, 1), 0);
        process.stdout.write(`\n${count} finding(s) across ${filtered.length} location(s)\n`);
      }
    }
    process.exit(filtered.length ? 1 : 0);
  };

  if (flags.has("--stdin")) {
    return readStdin().then((body) => {
      const findings = scanText(body, { allowHashes });
      if (findings.length) results.push({ path: "(stdin)", findings });
      finish();
    });
  }

  if (flags.has("--staged") || flags.has("--diff")) {
    const ref = flags.has("--diff") ? (positional[0] ?? "HEAD") : null;
    const body = ref ? gitDiff(["diff", "--unified=0", ref]) : gitDiff(["diff", "--cached", "--unified=0"]);
    // Only added lines can introduce a secret.
    const added = body
      .split("\n")
      .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
      .join("\n");
    const findings = scanText(added, { allowHashes });
    if (findings.length) results.push({ path: ref ? `(diff vs ${ref})` : "(staged diff)", findings });
    return finish();
  }

  const roots = positional.length ? positional : ["."];
  const allowRes = allowPathMatchers(cfg);
  const files: string[] = [];
  for (const r of roots) walk(resolve(r), files);
  for (const f of files) {
    const res = scanFile(f, allowHashes, allowRes);
    if (!res) continue;
    // Relative only when it is actually shorter and inside the cwd; a path full
    // of `../..` is harder to read than the absolute one.
    const rel = relative(process.cwd(), res.path);
    const display = rel && !rel.startsWith("..") ? rel : res.path;
    results.push({ ...res, path: display });
  }
  return finish();
}

await main();
