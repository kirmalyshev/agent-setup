#!/usr/bin/env bun
/**
 * merge-settings.ts — idempotent hook registration in ~/.claude/settings.json.
 *
 * Called by install.sh. Kept separate because JSON surgery on a file an engineer
 * has hand-edited deserves real parsing, not sed.
 *
 * The contract that makes re-running safe: every entry this script owns has a
 * command string containing OWNERSHIP_MARKER. Install removes all marked entries
 * and re-adds the current set; uninstall removes them and adds nothing. A
 * teammate's own hooks are never touched, and no entry can be duplicated.
 *
 *   bun merge-settings.ts --install [--hooks-dir DIR] [--settings FILE] [--dry-run]
 *   bun merge-settings.ts --uninstall [--settings FILE] [--dry-run]
 *   bun merge-settings.ts --check [--settings FILE]
 *
 * EXIT: 0 ok · 1 drift found (--check) · 2 error
 */

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const OWNERSHIP_MARKER = "agent-setup/hooks";

interface HookCommand {
  type: string;
  command: string;
  timeout?: number;
}
interface HookGroup {
  matcher?: string;
  hooks: HookCommand[];
}
type HooksBlock = Record<string, HookGroup[]>;

const TOOL_MATCHER =
  "Read|NotebookRead|Grep|Bash|Write|Edit|MultiEdit|NotebookEdit|WebFetch|WebSearch|mcp__.*";
const OUTPUT_MATCHER = "Read|NotebookRead|Grep|Bash|WebFetch|WebSearch|mcp__.*";

function desiredGroups(hooksDir: string): HooksBlock {
  const run = (file: string, timeout: number): HookCommand => ({
    type: "command",
    command: `bun "${hooksDir}/${file}"`,
    timeout,
  });
  return {
    SessionStart: [{ hooks: [run("SessionNotice.hook.ts", 10)] }],
    UserPromptSubmit: [{ hooks: [run("PromptSecurity.hook.ts", 10)] }],
    PreToolUse: [{ matcher: TOOL_MATCHER, hooks: [run("PreToolSecurity.hook.ts", 15)] }],
    PostToolUse: [{ matcher: OUTPUT_MATCHER, hooks: [run("PostToolSecurity.hook.ts", 15)] }],
  };
}

function isOurs(group: HookGroup): boolean {
  return (group.hooks ?? []).some(
    (h) => typeof h?.command === "string" && h.command.includes(OWNERSHIP_MARKER),
  );
}

function readSettings(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      fail(`${path} does not contain a JSON object — refusing to overwrite it.`);
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    fail(`${path} is not valid JSON (${String(err)}). Fix or move it, then re-run.`);
  }
}

function fail(msg: string): never {
  process.stderr.write(`merge-settings: ${msg}\n`);
  process.exit(2);
}

function backup(path: string): string | null {
  if (!existsSync(path)) return null;
  // Next to the file being modified, not under $HOME — otherwise a
  // CLAUDE_CONFIG_DIR install writes its backup into an unrelated config tree.
  const dir = join(dirname(path), "backups");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(dir, `settings.json.${stamp}.agent-setup.bak`);
  copyFileSync(path, dest);
  return dest;
}

function stripOurs(hooks: HooksBlock): { hooks: HooksBlock; removed: number } {
  const out: HooksBlock = {};
  let removed = 0;
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      out[event] = groups;
      continue;
    }
    const kept = groups.filter((g) => {
      if (isOurs(g)) {
        removed++;
        return false;
      }
      return true;
    });
    if (kept.length) out[event] = kept;
  }
  return { hooks: out, removed };
}

function main(): void {
  const argv = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (name: string) => argv.includes(`--${name}`);

  const settingsPath = flag("settings") ?? join(homedir(), ".claude", "settings.json");
  const hooksDir = flag("hooks-dir") ?? join(homedir(), ".claude", "agent-setup", "hooks");
  const dryRun = has("dry-run");

  if (!hooksDir.includes(OWNERSHIP_MARKER)) {
    fail(
      `--hooks-dir must contain "${OWNERSHIP_MARKER}" so entries stay identifiable on uninstall (got: ${hooksDir}).`,
    );
  }

  const settings = readSettings(settingsPath);
  const existing: HooksBlock =
    settings.hooks && typeof settings.hooks === "object" && !Array.isArray(settings.hooks)
      ? (settings.hooks as HooksBlock)
      : {};

  if (has("check")) {
    const desired = desiredGroups(hooksDir);
    const missing = Object.entries(desired).filter(([event, groups]) => {
      const cmds = (existing[event] ?? []).flatMap((g) => g.hooks?.map((h) => h.command) ?? []);
      return groups.some((g) => !g.hooks.every((h) => cmds.includes(h.command)));
    });
    if (missing.length) {
      process.stdout.write(`drift: not registered for ${missing.map(([e]) => e).join(", ")}\n`);
      process.exit(1);
    }
    process.stdout.write("registered: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse\n");
    process.exit(0);
  }

  const { hooks: cleaned, removed } = stripOurs(existing);
  let added = 0;

  if (has("install")) {
    for (const [event, groups] of Object.entries(desiredGroups(hooksDir))) {
      cleaned[event] = [...(cleaned[event] ?? []), ...groups];
      added += groups.length;
    }
  } else if (!has("uninstall")) {
    fail("expected one of --install, --uninstall, --check");
  }

  settings.hooks = cleaned;
  if (!Object.keys(cleaned).length) delete settings.hooks;

  const serialized = `${JSON.stringify(settings, null, 2)}\n`;

  if (dryRun) {
    // Only the hooks block is printed. settings.json legitimately holds `env`
    // entries with credentials in them, so dumping the whole file to stdout —
    // straight into a transcript — would be this tool leaking secrets while
    // installing a secret guard.
    process.stdout.write(
      `would write ${settingsPath}\n` +
        `  removed ${removed} previous agent-setup entr${removed === 1 ? "y" : "ies"}\n` +
        `  added   ${added} entr${added === 1 ? "y" : "ies"}\n` +
        `  hooks block after the change (rest of the file untouched):\n` +
        `${JSON.stringify({ hooks: cleaned }, null, 2)
          .split("\n")
          .map((l) => `    ${l}`)
          .join("\n")}\n`,
    );
    return;
  }

  const backupPath = backup(settingsPath);
  mkdirSync(dirname(settingsPath), { recursive: true });
  // Write-then-rename. settings.json is the control plane: a crash or a full
  // disk partway through a direct write leaves it truncated, and Claude Code
  // silently ignores a settings file it cannot parse — so the failure would
  // present as "my hooks stopped working" with no clue why. rename(2) within
  // one directory is atomic, so the file is either the old one or the new one.
  //
  // The mode has to be carried across explicitly. A plain write to an existing
  // file KEEPS its permissions; write-to-temp + rename does not — the result
  // inherits the temp file's default 0644. settings.json legitimately holds `env`
  // blocks with credentials in them (see the dry-run branch above), so the first
  // version of this change quietly turned a 0600 config world-readable: a
  // disclosure introduced by a durability fix. Measured, not theorised.
  const priorMode = existsSync(settingsPath) ? statSync(settingsPath).mode & 0o777 : undefined;
  const tmpPath = `${settingsPath}.agent-setup.${process.pid}.tmp`;
  writeFileSync(tmpPath, serialized, priorMode === undefined ? {} : { mode: priorMode });
  if (priorMode !== undefined) chmodSync(tmpPath, priorMode); // umask can mask the mode above
  renameSync(tmpPath, settingsPath);

  process.stdout.write(
    `${has("install") ? "registered" : "removed"} agent-setup hooks in ${settingsPath}\n` +
      `  previous entries removed: ${removed}\n` +
      `  entries added:            ${added}\n` +
      (backupPath ? `  backup:                   ${backupPath}\n` : ""),
  );

  if (has("install")) warnIfGenerated(settingsPath, settings);
}

/**
 * Detect a settings.json that is itself GENERATED, and say so loudly.
 *
 * Some setups rebuild settings.json from source files on every session start —
 * typically a SessionStart hook running a merge tool with
 * `--output ~/.claude/settings.json`. Writing hook entries straight into the
 * output means install succeeds, `--check` passes, and then the next session
 * start silently erases them — the baseline reads as installed and enforces
 * nothing, which is the failure mode this whole project exists to avoid.
 *
 * The heuristic is narrow on purpose: look for a hook command that names this
 * very settings file as an output/destination. That is what a generator looks
 * like, and it does not fire on ordinary configs.
 *
 * "This very file" means the RESOLVED PATH, not the basename. Matching
 * `settings.json` as a substring made any generator writing any settings.json
 * anywhere trip the warning for an unrelated file — measured on a machine with a
 * generator writing ~/.claude/settings.json while the install targeted a second
 * config dir's settings.json, two files that can never affect each other. A
 * warning that fires when it cannot apply is worse than no warning: it teaches
 * people to skim past installer output.
 */

/** Expand `$HOME`, `${HOME}` and a leading `~` so a command's path can be compared. */
function expandHomeish(p: string): string {
  const home = homedir();
  return p.replace(/\$\{?HOME\}?/g, home).replace(/^~(?=\/|$)/, home);
}

/** True when `cmd` names `settingsPath` itself as a path, by resolved absolute path. */
function namesPath(cmd: string, settingsPath: string): boolean {
  const target = resolve(expandHomeish(settingsPath));
  for (const rawToken of cmd.split(/\s+/)) {
    const token = rawToken
      .replace(/^--?[A-Za-z0-9][A-Za-z0-9-]*=/, "") // --output=<path>
      .replace(/^['"]|['"]$/g, "");
    if (!token.endsWith(".json")) continue;
    const expanded = expandHomeish(token);
    // A relative path cannot be resolved without knowing the generator's cwd;
    // treating it as a match would reintroduce the false positive.
    if (!expanded.startsWith("/")) continue;
    if (resolve(expanded) === target) return true;
  }
  return false;
}
function warnIfGenerated(settingsPath: string, settings: Record<string, unknown>): void {
  try {
    const hooks = settings.hooks as HooksBlock | undefined;
    if (!hooks) return;
    const writers: string[] = [];

    for (const [event, groups] of Object.entries(hooks)) {
      if (!Array.isArray(groups)) continue;
      for (const g of groups) {
        for (const h of g.hooks ?? []) {
          const cmd = typeof h?.command === "string" ? h.command : "";
          if (!cmd || cmd.includes(OWNERSHIP_MARKER)) continue;
          const looksLikeOutput = /--output|--out\b|>\s*\S*settings\.json/.test(cmd);
          if (looksLikeOutput && namesPath(cmd, settingsPath)) {
            writers.push(`${event}: ${cmd.slice(0, 160)}`);
          }
        }
      }
    }
    if (!writers.length) return;

    process.stdout.write(
      [
        "",
        "  ⚠ NOTE — this settings file appears to be GENERATED:",
        ...writers.map((w) => `      ${w}`),
        "",
        "    A hook rebuilds this file, so the entries just written MAY be lost on the",
        "    next run. Whether they are depends on something we cannot see from the",
        "    command line above: some generators also back-propagate direct edits to",
        "    the output back into their source, via a backport step before the merge,",
        "    in which case nothing more is needed.",
        "",
        "    So verify rather than guess. Start a fresh session, then:",
        "",
        "      ./install.sh --check        (with the same --config-dir)",
        "",
        "    Entries still there  → the generator back-propagates; you are done.",
        "    Entries gone         → re-run against the generator's SOURCE file:",
        "",
        "      ./install.sh --settings-file <source-settings-file>",
        "",
      ].join("\n"),
    );
  } catch {
    /* advisory only — never affects the write that already succeeded */
  }
}

main();
