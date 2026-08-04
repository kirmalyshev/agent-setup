/**
 * command-parse.ts — a deliberately small shell splitter.
 *
 * Not a shell parser. It answers exactly three questions, which is what the
 * guards need and no more:
 *
 *   segments(cmd)          → the pipeline/list members, so `ls; cat .env` is two
 *   verbOf(segment)        → the command word, after stripping `VAR=1` prefixes
 *   argsOf(segment)        → the remaining tokens, quotes removed
 *
 * Why an allowlist of reader verbs beats "does the command mention .env":
 * `echo '.env' >> .gitignore` and `git add .gitignore` mention `.env` and are
 * exactly what we want people doing. `cat .env` is the leak. The verb is the
 * signal; the path alone is not.
 *
 * Known limits, stated rather than hidden: `eval`, `bash -c "$VAR"`, base64-
 * encoded commands, and `$(…)` indirection defeat this. The guards are a
 * seatbelt against the accidental leak, not a sandbox against a determined
 * bypass — that boundary is the container, not a hook.
 */

/** Split on `;` `&&` `||` `|` `&` and newlines, ignoring separators inside quotes. */
export function segments(command: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let depth = 0; // $( … ) and ` … ` nesting

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    const next = command[i + 1];

    if (quote) {
      current += ch;
      if (ch === quote && command[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "$" && next === "(") {
      depth++;
      current += ch;
      continue;
    }
    if (ch === ")" && depth > 0) {
      depth--;
      current += ch;
      continue;
    }
    if (depth === 0) {
      // `2>&1`, `>&2`, `&>log` are redirections, not list separators. Splitting
      // on that `&` truncated the segment and lost everything after it —
      // `cat 2>&1 .env` parsed as ["cat 2>", "1 .env"], so the `.env` argument
      // was never seen by the reader check. Verified bypass; keep this guard.
      const isRedirectAmp =
        ch === "&" && (next === ">" || /[0-9]?\s*>\s*$/.test(current.slice(-4)));
      if (!isRedirectAmp && (ch === "\n" || ch === ";" || ch === "&" || ch === "|")) {
        // consume a doubled operator (&& ||) as one separator
        if ((ch === "&" || ch === "|") && next === ch) i++;
        if (current.trim()) out.push(current.trim());
        current = "";
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** Tokenize a segment, dropping surrounding quotes from each token. */
export function tokens(segment: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (quote) {
      if (ch === quote && segment[i - 1] !== "\\") quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current) out.push(current);
  return out;
}

const ENV_ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SHELL_OPERATOR_RE = /^[|;&<>]/;

/**
 * Verbs that run another command. The real verb is whatever follows, so these
 * are skipped when resolving it.
 *
 * `rtk` is here for a measured reason: it is a token-reduction proxy installed
 * as a PreToolUse hook that REWRITES commands before they run — `cat .env`
 * becomes `rtk read .env`, `grep KEY .env` becomes `rtk grep KEY .env`,
 * `head -5 .env` becomes `rtk read .env --max-lines 5`. A guard that sees the
 * rewritten form and does not look past the wrapper allows every one of those.
 * The same reasoning covers `bunx`/`npx`/`uvx` (`npx some-cat-tool .env`) and
 * the secret-injection runners (`op run -- cat .env`).
 */
const TRANSPARENT_WRAPPERS = new Set([
  "sudo", "doas", "command", "nohup", "time", "nice", "xargs", "watch", "eval",
  "rtk", "bunx", "npx", "pnpx", "uvx", "pipx", "dotenv", "direnv",
]);

/**
 * Wrappers that take a fixed subcommand before the real command
 * (`poetry run cat .env`, `docker exec c cat .env`, `op run -- cat .env`).
 * Only the listed subcommands are treated as wrapping; `docker build` is not.
 */
const WRAPPER_SUBCOMMANDS: Record<string, readonly string[]> = {
  poetry: ["run"], pipenv: ["run"], rye: ["run"], uv: ["run", "tool"],
  npm: ["exec"], pnpm: ["exec", "dlx"], yarn: ["dlx", "exec"], bun: ["x"],
  op: ["run"], doppler: ["run"],
  // Deliberately NOT here, and each for its own reason:
  //
  // `aws`, `vault`, `gcloud`, `az`, `gh` — their subcommands ARE the credential
  // dumps the rules match on. Stripping the prefix would make
  // `aws ssm get-parameter --with-decryption` unmatchable.
  //
  // `docker run` / `docker exec` / `kubectl exec` — the real command sits after
  // an image or container positional, and `docker run -e FOO=1 img cat .env`
  // cannot be resolved without modelling docker's whole flag grammar. Guessing
  // wrong here fails in the dangerous direction, and a container does not see
  // the host filesystem without an explicit bind mount anyway, so host path
  // rules do not transfer. Left uncovered on purpose; noted in README limits.
};

/** `--` ends a wrapper's own options (`op run -- cat .env`). */
function skipWrapperNoise(toks: string[], i: number): number {
  while (i < toks.length && (toks[i] === "--" || toks[i].startsWith("-"))) i++;
  return i;
}

/**
 * Index of the effective command word, after `VAR=value` prefixes and any chain
 * of wrappers. Shared by verbOf and argsOf so they can never disagree.
 */
function effectiveVerbIndex(toks: string[]): number {
  let i = 0;
  let moved = true;
  while (moved) {
    moved = false;
    while (i < toks.length && ENV_ASSIGN_RE.test(toks[i])) {
      i++;
      moved = true;
    }
    if (i >= toks.length) break;
    const verb = basename(toks[i]);

    // `env` is both a dump command and a prefix runner. Strip it ONLY when a
    // real command follows the assignments, so bare `env` and `env | grep`
    // still resolve to `env` and stay catchable by the dump rules, while
    // `env FOO=1 cat .env` resolves to `cat`.
    if (verb === "env") {
      let j = i + 1;
      while (j < toks.length && (ENV_ASSIGN_RE.test(toks[j]) || toks[j].startsWith("-"))) j++;
      // Only strip when a real command word follows. A shell operator means the
      // caller handed us more than one segment; `env` is then the actual verb
      // and must stay resolvable by the dump rules.
      if (j < toks.length && !SHELL_OPERATOR_RE.test(toks[j])) {
        i = j;
        moved = true;
        continue;
      }
      break;
    }

    if (TRANSPARENT_WRAPPERS.has(verb)) {
      i = skipWrapperNoise(toks, i + 1);
      moved = true;
      continue;
    }

    const subs = WRAPPER_SUBCOMMANDS[verb];
    if (subs && i + 1 < toks.length && subs.includes(toks[i + 1])) {
      i = skipWrapperNoise(toks, i + 2);
      moved = true;
      continue;
    }
    break;
  }
  return i;
}

/**
 * The effective command word: skips `VAR=value` prefixes and wrapper verbs
 * (`sudo cat .env` and `rtk read .env` must both resolve to a reader), and
 * strips any directory part so `/bin/cat` and `cat` are the same verb.
 */
export function verbOf(segment: string): string {
  const toks = tokens(segment);
  const i = effectiveVerbIndex(toks);
  return i < toks.length ? basename(toks[i]) : "";
}

/** Tokens after the effective verb, with flags kept (guards decide what to do with them). */
export function argsOf(segment: string): string[] {
  const toks = tokens(segment);
  const i = effectiveVerbIndex(toks);
  return toks.slice(i + 1);
}

/**
 * The segment with wrapper prefixes removed, so a rule anchored with `^` still
 * matches once a proxy has rewritten the command. `rtk aws secretsmanager
 * get-secret-value` has to match the same rule as the unwrapped form.
 */
export function stripWrappers(segment: string): string {
  const toks = tokens(segment);
  const i = effectiveVerbIndex(toks);
  return toks.slice(i).join(" ");
}

function basename(p: string): string {
  const cleaned = p.replace(/^['"]|['"]$/g, "");
  const idx = cleaned.lastIndexOf("/");
  return idx === -1 ? cleaned : cleaned.slice(idx + 1);
}

/** Whitespace-collapsed segment, for matching the SECRET_DUMP_COMMANDS regexes. */
export function normalizeSegment(segment: string): string {
  return segment.replace(/\s+/g, " ").trim();
}

/**
 * Commands whose FIRST positional argument is a PROGRAM — a filter, script, or
 * expression — rather than a path. `jq '.[].key' data.json` reads data.json;
 * the `.[].key` is code.
 *
 * Without this, that filter was classified as a path, matched the `pem-key`
 * rule on its `.key` suffix, and a read-only query got denied under a rule
 * about private keys. Observed in real use. The failure is doubly bad: it
 * blocks legitimate work AND teaches people that the guard cries wolf.
 *
 * Interpreters (`python`, `node`, `perl`) are deliberately absent — they take
 * their code via `-c`/`-e`, so their first positional really is a script path
 * and must stay a target.
 */
const PROGRAM_ARG_COMMANDS = new Set([
  "jq", "yq", "tomlq", "dasel", "awk", "gawk", "mawk", "nawk", "sed",
]);

/**
 * When the program is supplied by a flag, the first positional is a path after
 * all (`jq -f filter.jq .env`, `sed -e 's/a/b/' .env`). Presence of any of
 * these means: do not skip anything. Failing toward "treat it as a path" is the
 * safe direction — a false block costs one keypress, a missed read costs a
 * credential.
 */
const PROGRAM_FROM_FLAG = new Set(["-f", "--from-file", "--file", "-e", "--expression"]);

/**
 * Paths a segment would READ: positional args plus `< file` redirections.
 * Flag tokens and their `=`-attached values are excluded; `-f=x` style values
 * are not paths we care about.
 */
export function readTargets(segment: string): string[] {
  const out: string[] = [];
  const toks = argsOf(segment);
  let skipProgram =
    PROGRAM_ARG_COMMANDS.has(verbOf(segment)) && !toks.some((t) => PROGRAM_FROM_FLAG.has(t));
  for (const t of toks) {
    if (t.startsWith("-")) continue;
    if (skipProgram) {
      skipProgram = false;
      continue;
    }
    out.push(t);
  }
  for (const m of segment.matchAll(/(?:^|\s)<\s*([^\s<>|;&]+)/g)) out.push(m[1]);
  return out;
}
