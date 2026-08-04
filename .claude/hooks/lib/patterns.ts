/**
 * patterns.ts — the detection catalog. Pure data, no I/O, no LLM.
 *
 * Three independent catalogs:
 *   SECRET_PATTERNS   credential VALUE shapes, ranked by confidence
 *   SENSITIVE_PATHS   files whose CONTENTS must never enter an LLM context
 *   COMMAND CATALOGS  which shell verbs read file contents, which dump secrets
 *
 * Confidence drives posture (see config.ts):
 *   high    provider-specific shape, effectively zero false positives → blocks
 *   medium  structural shape that also occurs in docs/fixtures        → warns (blocks in strict)
 *   low     name-based heuristic / entropy                            → warns
 *
 * Adding a pattern is the normal way to extend this baseline. Keep regexes
 * anchored on a provider prefix wherever possible; a bare "40 base64 chars"
 * pattern generates enough noise that people disable the whole hook, which is
 * strictly worse than not having the pattern.
 */

export type Confidence = "high" | "medium" | "low";

export interface SecretPattern {
  /** stable id — appears in audit logs and allowlists */
  id: string;
  /** human label for the block message */
  label: string;
  re: RegExp;
  confidence: Confidence;
  /** capture group holding the credential value; 0 = whole match */
  valueGroup?: number;
  /** what the engineer has to do now that it has leaked */
  rotate?: string;
}

/**
 * Provider-specific credential shapes. Order matters: the first match on a
 * given text range wins (see dedupeFindings in detect.ts), so specific
 * prefixes must precede the generic families.
 */
export const SECRET_PATTERNS: readonly SecretPattern[] = [
  // ── AI / LLM providers ────────────────────────────────────────────────
  {
    id: "anthropic-api-key",
    label: "Anthropic API key",
    re: /\bsk-ant-(?:api|admin)[0-9]{2}-[A-Za-z0-9_-]{24,}/,
    confidence: "high",
    rotate: "Revoke at console.anthropic.com → API keys.",
  },
  {
    id: "openrouter-key",
    label: "OpenRouter API key",
    re: /\bsk-or-v1-[A-Za-z0-9]{32,}/,
    confidence: "high",
    rotate: "Revoke at openrouter.ai/settings/keys.",
  },
  {
    id: "openai-api-key",
    label: "OpenAI API key",
    re: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}/,
    confidence: "high",
    rotate: "Revoke at platform.openai.com/api-keys.",
  },
  {
    id: "openai-legacy-key",
    label: "OpenAI legacy API key",
    re: /\bsk-[A-Za-z0-9]{48}\b/,
    confidence: "high",
    rotate: "Revoke at platform.openai.com/api-keys.",
  },
  {
    id: "google-api-key",
    label: "Google API key",
    re: /\bAIza[0-9A-Za-z_-]{35}\b/,
    confidence: "high",
    rotate: "Revoke in GCP console → APIs & Services → Credentials.",
  },
  {
    id: "groq-key",
    label: "Groq API key",
    re: /\bgsk_[A-Za-z0-9]{40,}/,
    confidence: "high",
    rotate: "Revoke at console.groq.com/keys.",
  },
  {
    id: "huggingface-token",
    label: "Hugging Face token",
    re: /\bhf_[A-Za-z0-9]{30,}/,
    confidence: "high",
    rotate: "Revoke at huggingface.co/settings/tokens.",
  },
  {
    id: "replicate-token",
    label: "Replicate API token",
    re: /\br8_[A-Za-z0-9]{35,}/,
    confidence: "high",
    rotate: "Revoke at replicate.com/account/api-tokens.",
  },

  // ── Cloud providers ───────────────────────────────────────────────────
  {
    id: "aws-access-key-id",
    label: "AWS access key ID",
    re: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/,
    confidence: "high",
    rotate: "Deactivate + delete the key in IAM, then audit CloudTrail for use.",
  },
  {
    id: "aws-secret-access-key",
    label: "AWS secret access key",
    re: /\baws_?secret_?access_?key\b["']?\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})/i,
    valueGroup: 1,
    confidence: "high",
    rotate: "Deactivate + delete the key pair in IAM, then audit CloudTrail.",
  },
  {
    id: "aws-session-token",
    label: "AWS session token",
    re: /\baws_?session_?token\b["']?\s*[:=]\s*["']?([A-Za-z0-9/+=]{100,})/i,
    valueGroup: 1,
    confidence: "high",
    rotate: "Short-lived, but revoke the assumed role's session and audit CloudTrail.",
  },
  {
    id: "gcp-service-account",
    label: "GCP service-account key file",
    re: /"type"\s*:\s*"service_account"[\s\S]{0,400}?"private_key"\s*:/,
    confidence: "high",
    rotate: "Delete the key in IAM → Service Accounts → Keys and issue a new one.",
  },
  {
    id: "google-oauth-refresh",
    label: "Google OAuth refresh token",
    re: /\b1\/\/[0-9A-Za-z_-]{50,}/,
    confidence: "high",
    rotate: "Revoke at myaccount.google.com/permissions or via the OAuth client.",
  },
  {
    id: "azure-storage-key",
    label: "Azure storage account key",
    re: /\bAccountKey\s*=\s*([A-Za-z0-9+/=]{60,})/,
    valueGroup: 1,
    confidence: "high",
    rotate: "Rotate key1/key2 in the storage account → Access keys.",
  },
  {
    id: "digitalocean-token",
    label: "DigitalOcean PAT",
    re: /\bdop_v1_[a-f0-9]{64}\b/,
    confidence: "high",
    rotate: "Revoke at cloud.digitalocean.com/account/api/tokens.",
  },

  // ── Source control / packaging ────────────────────────────────────────
  {
    id: "github-token",
    label: "GitHub token",
    re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/,
    confidence: "high",
    rotate: "Revoke at github.com/settings/tokens and check the audit log.",
  },
  {
    id: "github-fine-grained-pat",
    label: "GitHub fine-grained PAT",
    re: /\bgithub_pat_[A-Za-z0-9_]{60,}/,
    confidence: "high",
    rotate: "Revoke at github.com/settings/tokens?type=beta.",
  },
  {
    id: "gitlab-pat",
    label: "GitLab PAT",
    re: /\bglpat-[A-Za-z0-9_-]{20,}/,
    confidence: "high",
    rotate: "Revoke in GitLab → Access Tokens.",
  },
  {
    id: "npm-token",
    label: "npm access token",
    re: /\bnpm_[A-Za-z0-9]{36}\b/,
    confidence: "high",
    rotate: "Revoke with `npm token revoke` and rotate CI credentials.",
  },

  // ── SaaS ──────────────────────────────────────────────────────────────
  {
    id: "slack-token",
    label: "Slack token",
    re: /\bxox[baprse]-[A-Za-z0-9-]{10,}/,
    confidence: "high",
    rotate: "Rotate the app/bot token in the Slack app config.",
  },
  {
    id: "slack-webhook",
    label: "Slack incoming webhook",
    re: /https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9_]+\/B[A-Za-z0-9_]+\/[A-Za-z0-9]{16,}/,
    confidence: "high",
    rotate: "Delete the webhook in the Slack app config — anyone with the URL can post.",
  },
  {
    id: "stripe-live-key",
    label: "Stripe LIVE secret key",
    re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/,
    confidence: "high",
    rotate: "Roll immediately in the Stripe dashboard → Developers → API keys.",
  },
  {
    id: "stripe-test-key",
    label: "Stripe test secret key",
    re: /\b(?:sk|rk)_test_[A-Za-z0-9]{20,}/,
    confidence: "medium",
    rotate: "Test-mode key — roll it, but no production impact.",
  },
  {
    id: "sendgrid-key",
    label: "SendGrid API key",
    re: /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{40,}/,
    confidence: "high",
    rotate: "Delete the key in SendGrid → Settings → API Keys.",
  },
  {
    id: "twilio-api-key",
    label: "Twilio API key SID",
    re: /\bSK[0-9a-fA-F]{32}\b/,
    confidence: "high",
    rotate: "Delete the key in the Twilio console → Account → API keys.",
  },
  {
    id: "linear-key",
    label: "Linear API key",
    re: /\blin_api_[A-Za-z0-9]{32,}/,
    confidence: "high",
    rotate: "Revoke in Linear → Settings → API.",
  },
  {
    id: "notion-token",
    label: "Notion integration token",
    re: /\b(?:secret_[A-Za-z0-9]{40,}|ntn_[A-Za-z0-9]{40,})/,
    confidence: "high",
    rotate: "Rotate the integration secret in Notion → Integrations.",
  },
  {
    id: "posthog-personal-key",
    label: "PostHog personal API key",
    re: /\bphx_[A-Za-z0-9]{40,}/,
    confidence: "high",
    rotate: "Revoke in PostHog → Personal API keys.",
  },

  // ── Generic transport / structural shapes ─────────────────────────────
  {
    id: "private-key-block",
    label: "PEM private key",
    re: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/,
    confidence: "high",
    rotate: "Treat the key pair as compromised: reissue and remove the old public key everywhere.",
  },
  {
    id: "jwt",
    label: "JWT / bearer assertion",
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    confidence: "high",
    rotate: "Invalidate the session/token server-side; a signed JWT is valid until it expires.",
  },
  {
    id: "authorization-bearer",
    label: "Authorization: Bearer header",
    re: /\bAuthorization\s*:\s*Bearer\s+([A-Za-z0-9._~+/=-]{24,})/i,
    valueGroup: 1,
    confidence: "high",
    rotate: "Rotate the credential behind the bearer token.",
  },
  {
    id: "authorization-basic",
    label: "Authorization: Basic header",
    re: /\bAuthorization\s*:\s*Basic\s+([A-Za-z0-9+/=]{16,})/i,
    valueGroup: 1,
    confidence: "high",
    rotate: "Rotate the username/password pair it encodes.",
  },
  {
    id: "db-connection-uri",
    label: "database URI with inline password",
    re: /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis[s]?|amqps?|clickhouse|snowflake):\/\/[^\s:/@]+:([^\s@/]{6,})@/,
    valueGroup: 1,
    confidence: "high",
    rotate: "Rotate the database user's password; assume the DB was reachable.",
  },
  {
    id: "generic-secret-assignment",
    label: "secret-named assignment",
    re: /\b[A-Za-z_][A-Za-z0-9_.]*(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE[_-]?KEY|CREDENTIALS?|ACCESS[_-]?KEY)S?\b["']?\s*[:=]\s*["']?([^\s"',;}{)]{12,})/i,
    valueGroup: 1,
    confidence: "low",
    rotate: "If this is a live credential, rotate it at the issuing provider.",
  },

  // ── Personal / regulated data (light layer — see README limits) ───────
  {
    id: "credit-card",
    label: "payment card number",
    re: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/,
    confidence: "high",
    rotate: "PCI scope. Notify the cardholder and your compliance owner; do not store it.",
  },
  {
    // Grouped-in-fours would miss every real IBAN whose length is not a
    // multiple of four (a German IBAN is 22 characters). Match loosely and let
    // the mod-97 validator in detect.ts carry the precision.
    id: "iban",
    label: "IBAN",
    re: /\b[A-Z]{2}[0-9]{2}(?:[ ]?[A-Z0-9]){11,30}\b/,
    confidence: "medium",
    rotate: "Personal financial data — remove it from the transcript and any logs.",
  },
  {
    id: "us-ssn",
    label: "US SSN",
    re: /\b(?!000|666|9)[0-9]{3}-(?!00)[0-9]{2}-(?!0000)[0-9]{4}\b/,
    confidence: "medium",
    rotate: "Regulated PII — remove it and notify your compliance owner.",
  },
];

/**
 * Files whose CONTENTS must not reach an LLM context. Matched against a
 * POSIX-normalized path. `.env.example` and friends are deliberately excluded
 * by ENV_SAFE_SUFFIXES — those files exist to be read.
 */
export const SENSITIVE_PATHS: ReadonlyArray<{ id: string; re: RegExp; why: string }> = [
  // The suffix class allows dots. Without them `.env.local.bak`,
  // `.env.prod.backup`, and `.env.save.old` were all readable while `.env.bak`
  // was blocked — a gap that widens exactly when someone is shuffling env files
  // around, which is when they are most likely to be copied somewhere careless.
  { id: "dotenv", re: /(?:^|\/)\.env(?:\.[A-Za-z0-9_.-]+)?$/, why: "environment file — holds live credentials" },
  { id: "aws-credentials", re: /(?:^|\/)\.aws\/(?:credentials|config)$/, why: "AWS CLI credential store" },
  { id: "gcloud-adc", re: /(?:^|\/)gcloud\/application_default_credentials\.json$/, why: "GCP application default credentials" },
  { id: "gcloud-dir", re: /(?:^|\/)\.config\/gcloud\/(?:credentials|legacy_credentials)\b/, why: "gcloud credential store" },
  { id: "ssh-private-key", re: /(?:^|\/)\.ssh\/(?:id_[A-Za-z0-9_]+|[A-Za-z0-9_-]+)$/, why: "SSH private key material" },
  { id: "pem-key", re: /\.(?:pem|key|p12|pfx|jks|keystore|ppk|asc|gpg)$/i, why: "private key / keystore" },
  { id: "npmrc", re: /(?:^|\/)\.npmrc$/, why: "npm registry auth token" },
  { id: "pypirc", re: /(?:^|\/)\.pypirc$/, why: "PyPI upload credentials" },
  { id: "netrc", re: /(?:^|\/)\.netrc$/, why: "plaintext host credentials" },
  { id: "git-credentials", re: /(?:^|\/)\.git-credentials$/, why: "stored git passwords" },
  { id: "gh-hosts", re: /(?:^|\/)\.config\/gh\/hosts\.yml$/, why: "GitHub CLI OAuth token" },
  { id: "kubeconfig", re: /(?:^|\/)(?:\.kube\/config|kubeconfig(?:\.[A-Za-z0-9_-]+)?)$/, why: "cluster admin credentials" },
  { id: "docker-config", re: /(?:^|\/)\.docker\/config\.json$/, why: "registry auth tokens" },
  { id: "service-account-json", re: /(?:^|\/)[A-Za-z0-9_.-]*(?:service[_-]?account|serviceaccount|credentials?)[A-Za-z0-9_.-]*\.json$/i, why: "service-account key file" },
  { id: "gnupg", re: /(?:^|\/)\.gnupg\//, why: "GPG private keyring" },
  { id: "terraform-state", re: /(?:^|\/)(?:terraform\.tfstate(?:\.backup)?|\.terraform\/terraform\.tfstate)$/, why: "Terraform state — contains resolved secrets" },
  { id: "pgpass", re: /(?:^|\/)\.pgpass$/, why: "Postgres password file" },
  { id: "mycnf", re: /(?:^|\/)\.my\.cnf$/, why: "MySQL password file" },
  { id: "keychain", re: /(?:^|\/)Library\/Keychains\//, why: "macOS keychain database" },
  { id: "unix-shadow", re: /^\/etc\/(?:shadow|master\.passwd|sudoers)$/, why: "system password hashes" },
  { id: "shell-history", re: /(?:^|\/)\.(?:bash|zsh|sh|python|psql|mysql|node_repl)_history$/, why: "shell history routinely contains pasted secrets" },
  { id: "onepassword-export", re: /(?:^|\/)[A-Za-z0-9_.-]*1password[A-Za-z0-9_.-]*\.(?:1pif|csv|json)$/i, why: "password manager export" },
];

/** `.env.<suffix>` files that are templates, not credential stores. */
export const ENV_SAFE_SUFFIXES: readonly string[] = [
  "example", "examples", "sample", "samples", "template", "templates",
  "dist", "default", "defaults", "tpl", "schema", "d.ts",
];

/**
 * Shell verbs that emit file CONTENTS. A sensitive path passed to one of these
 * is a leak; the same path passed to `ls`, `stat`, `test`, or `echo … >>
 * .gitignore` is not, which is why this is an allowlist of readers rather than
 * a scan for the path anywhere in the command.
 */
export const READER_COMMANDS: readonly string[] = [
  // `read`, `json`, `smart`, `tree` are the reading subcommands of the `rtk`
  // proxy, which rewrites `cat .env` into `rtk read .env` before it runs. The
  // wrapper is stripped in command-parse.ts; these are the verbs left behind.
  "read", "json", "smart",
  "cat", "bat", "batcat", "head", "tail", "less", "more", "most", "view",
  "nl", "tac", "rev", "strings", "xxd", "od", "hexdump", "base64", "uuencode",
  "grep", "egrep", "fgrep", "rg", "ag", "ack", "sed", "awk", "gawk", "perl",
  "jq", "yq", "tomlq", "dasel", "python", "python3", "ruby", "node", "bun", "deno",
  "source", ".", "dotenv", "envsubst", "op", "sops", "age", "gpg",
  "cp", "mv", "rsync", "scp", "sftp", "tar", "zip", "curl", "wget", "http", "httpie",
  "pbcopy", "clip", "tee", "diff", "vimdiff", "colordiff", "delta", "code", "open",
];

/** `git <sub>` reveals file contents only for these subcommands. */
export const GIT_READER_SUBCOMMANDS: readonly string[] = [
  "show", "diff", "cat-file", "stash", "log", "blame", "grep",
];

/**
 * Commands whose entire purpose is to print a credential. Blocked outright:
 * the value lands in the transcript, which is the leak we exist to prevent.
 * Each entry matches a normalized (whitespace-collapsed) command segment.
 */
export const SECRET_DUMP_COMMANDS: ReadonlyArray<{
  id: string;
  re: RegExp;
  alternative: string;
  /** skip the rule when the next pipeline stage projects names only */
  pipelineSensitive?: boolean;
}> = [
  {
    id: "env-dump",
    re: /^(?:env|printenv)(?:\s+-0)?\s*(?:\||>|$)/,
    alternative: "Reference the variable by NAME (`$MY_TOKEN`), or `env | cut -d= -f1` to list names only.",
    pipelineSensitive: true,
  },
  {
    // `env` was blocked and `printenv MY_TOKEN` was not, which is the same leak
    // one variable at a time — and the form someone reaches for immediately
    // after being blocked. Matched on the variable NAME, so `printenv PATH` and
    // `echo $HOME` stay free; only names that advertise a credential are dumps.
    //
    // `echo` is covered for the same reason, but only in its `$VAR` form: the
    // regex requires a `$` right after the verb (optionally quoted), so
    // `echo "set your API_KEY in .env"` is prose and passes. Shell expansion in
    // general remains a documented limit — this closes the named-variable case,
    // not `eval` or command substitution.
    id: "named-secret-var-print",
    re: /^(?:printenv\s+|echo\s+["']?\$\{?)[A-Za-z0-9_]*(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIALS?|PRIVATE[_-]?KEY|ACCESS[_-]?KEY)[A-Za-z0-9_]*/i,
    alternative:
      "Let the consumer read the variable itself, or `test -n \"$MY_TOKEN\" && echo set` to confirm it is populated without printing it.",
  },
  {
    id: "export-dump",
    re: /^(?:export|set)\s*(?:-p)?\s*(?:\||>|$)/,
    alternative: "Use `compgen -e` to list exported names without values.",
    pipelineSensitive: true,
  },
  {
    id: "macos-keychain",
    re: /^security\s+(?:find-generic-password|find-internet-password|dump-keychain)\b/,
    alternative: "Read the secret in your own terminal; hand the agent only what it needs by name.",
  },
  {
    id: "gcloud-token",
    re: /^gcloud\s+auth\s+print-(?:access|identity)-token\b/,
    alternative: "Let the tool that needs it fetch its own token; do not materialize it in the transcript.",
  },
  {
    id: "gcloud-secret",
    re: /^gcloud\s+secrets\s+versions\s+access\b/,
    alternative: "Pipe it straight into the consumer, or inject it via the deployment's secret mount.",
  },
  {
    id: "aws-configure-get",
    re: /^aws\s+configure\s+get\b/,
    alternative: "Use the AWS SDK's default credential chain instead of printing the key.",
  },
  {
    id: "aws-secretsmanager",
    re: /^aws\s+secretsmanager\s+get-secret-value\b/,
    alternative: "Inject the secret at runtime (task definition / Lambda env) rather than printing it.",
  },
  {
    id: "aws-ssm-decrypt",
    re: /^aws\s+ssm\s+get-parameters?(?:-by-path)?\b[\s\S]*--with-decryption\b/,
    alternative: "Drop `--with-decryption` to inspect metadata, or inject the value at runtime.",
  },
  {
    id: "azure-keyvault",
    re: /^az\s+keyvault\s+secret\s+(?:show|download)\b/,
    alternative: "Use a Key Vault reference in app settings instead of printing the value.",
  },
  {
    // Bare `kubectl get secret` prints NAME/TYPE/DATA/AGE — no values — and
    // `describe` prints key names with byte counts. Only an explicit
    // yaml/json/go-template/`{.data…}` projection reveals the payload, so only
    // those forms are blocked.
    id: "kubectl-secret",
    // `jsonpath` must precede `json\b` in the alternation, and `json` needs the
    // word boundary — otherwise `-o jsonpath='{.metadata.name}'` matches on its
    // `json` prefix and the safe form gets blocked.
    re: /^kubectl\s+get\s+secrets?\b[\s\S]*(?:-o|--output)[= ]\s*'?(?:yaml|jsonpath[^{]*\{\.data|json\b|go-template)/,
    alternative: "`kubectl get secret` alone lists names; `-o jsonpath='{.metadata.name}'` is also safe.",
  },
  {
    id: "vault-read",
    re: /^vault\s+(?:read|kv\s+get)\b/,
    alternative: "Use `vault kv metadata get` for metadata, or an agent-injected template.",
  },
  {
    id: "doppler-secrets",
    re: /^doppler\s+secrets(?!\s+(?:names|--only-names))\b/,
    alternative: "`doppler secrets --only-names`, or `doppler run -- <cmd>` to inject without printing.",
  },
  {
    id: "onepassword-read",
    re: /^op\s+(?:read|item\s+get)\b/,
    alternative: "`op run -- <cmd>` injects the secret into the child process without printing it.",
  },
  {
    id: "gh-auth-token",
    re: /^gh\s+auth\s+token\b/,
    alternative: "`gh` already authenticates its own API calls — use `gh api` directly.",
  },
  {
    id: "platform-config-dump",
    re: /^(?:heroku\s+config(?!:)|flyctl?\s+secrets\s+list|railway\s+variables|vercel\s+env\s+pull|netlify\s+env:list|supabase\s+secrets\s+list)\b/,
    alternative: "List names only, or inject at deploy time.",
  },
  {
    // Backwards before: requiring `--format` meant the NARROW form was blocked
    // (`--format '{{.Id}}'` reveals nothing) while the BROAD one was allowed —
    // bare `docker inspect` prints the entire object, Config.Env included.
    // Now the absence of a format selector is what makes it a dump.
    id: "docker-inspect-full",
    re: /^docker\s+inspect\b(?![\s\S]*(?:--format|\s-f\b))/,
    alternative:
      "Narrow it: `docker inspect --format '{{.State.Status}}' <c>`. The full object includes Config.Env.",
  },
  {
    id: "docker-env-inspect",
    re: /^docker\s+inspect\b[\s\S]*\.(?:Config\.)?Env\b/,
    alternative: "Inspect a narrower field; container env commonly carries credentials.",
  },
];

/**
 * Downstream pipeline stages that strip values and keep only variable NAMES.
 * `env | cut -d= -f1` is the alternative the env-dump rule recommends, so it
 * had better not be blocked by that same rule. Anything not listed here is
 * assumed to pass values through.
 */
/**
 * These are the ONLY way past a high-confidence deny rule, which makes them the
 * part of the catalog that has to be exactly right — an exemption that is too
 * generous is a bypass, not a convenience.
 *
 * Two measured holes, both of the same shape: the old matchers asked "is there a
 * field other than 1?" and answered by looking for `-f` followed by 2-9. A field
 * LIST or RANGE starting at 1 passes that test and prints values anyway:
 *
 *   env | cut -d= -f1,2     was allowed, prints NAME=VALUE
 *   env | cut -d= -f1-      was allowed, prints the whole line
 *   env | awk -F= '{print $1, $2}'   was allowed, prints the value too
 *
 * So they are positive now: field 1 must be the WHOLE field spec (terminated by
 * whitespace, a quote, or end of segment), and an awk program may not reference
 * any field other than `$1`. Anything else falls through to the deny rule, which
 * is the safe direction for an exemption.
 */
export const NAME_ONLY_PROJECTIONS: readonly RegExp[] = [
  // `-f1` and nothing else: rejects -f1,2 / -f1- / -f1-3 / -f10 / -f2.
  /^cut\b(?=[^|]*-d\s*'?=)(?=[^|]*-f\s*'?1['"]?(?:\s|$))/,
  // `print $1` and no other field reference, so `$0` and `$1, $2` both fall through.
  /^awk\b(?=[^|]*-F\s*'?=)(?=[^|]*print\s+\$1\b)(?![^|]*\$(?:0|[2-9]))/,
  /^sed\b[^|]*s\/=\.\*\$?\/\//,
  /^grep\b(?=[^|]*-o)(?=[^|]*=['"]?\s*$)/,
];

/** Tool names that move data to a third party. Their inputs get scanned. */
export const EGRESS_TOOL_PATTERNS: readonly RegExp[] = [
  /^WebFetch$/,
  /^WebSearch$/,
  /^mcp__/,
];

/** Shell verbs that move data off the machine. Their command line gets scanned. */
export const EGRESS_COMMANDS: readonly string[] = [
  "curl", "wget", "http", "httpie", "nc", "ncat", "netcat", "telnet",
  "scp", "sftp", "rsync", "ssh", "ftp", "gh", "glab", "aws", "gcloud", "az",
  "slack", "pbcopy", "mail", "sendmail", "mutt", "msmtp",
];

/**
 * Values that look like credentials but are documentation. Checked against the
 * matched VALUE, case-insensitively, as a whole-value match.
 */
export const PLACEHOLDER_VALUE_RE =
  /^(?:x{3,}|y{3,}|z{3,}|a{3,}|0{3,}|1{3,}|\.{3,}|_{3,}|-{3,}|\*{3,}|#{3,}|\$\{[^}]*\}|\$[A-Z_][A-Z0-9_]*|<[^>]*>|\[[^\]]*\]|\{\{[^}]*\}\}|(?:your|my|the|some|a)[-_]?(?:api)?[-_]?(?:key|token|secret|password|value|here)[-_]?(?:here|goes[-_]?here)?|changeme|change[-_]?me|replace[-_]?me|todo|tbd|n\/a|none|null|nil|undefined|example|sample|placeholder|dummy|fake|test|testing|foo|bar|baz|secret|password|redacted|removed|hidden|masked|sk-[x*.]+|abc123|123456\d*|deadbeef|insert[-_]?[a-z]*[-_]?here)$/i;

/** Inline suppression markers — the industry-standard spellings, so people can reuse muscle memory. */
export const INLINE_ALLOW_RE =
  /(?:gitleaks:allow|pragma:\s*allowlist\s+secret|noqa:\s*secret|trufflehog:ignore|detect-secrets:ignore|agent-setup:allow)/i;

/**
 * Well-known documentation credentials. Suppressed unconditionally because they
 * appear in every tutorial and blocking them trains people to disable the hook.
 * Keyed by prefix, so a partial match on the head of the value is enough.
 *
 * ASSEMBLED FROM PARTS ON PURPOSE — do not inline them as single literals.
 * A contiguous credential-shaped string here is a real credential shape to every
 * *other* scanner in the pipeline: GitHub push protection rejected exactly these
 * three lines on the first push of this repo. An inline suppression marker
 * silences our scanner only; it has no effect on GitHub's, gitleaks', or a
 * vendor's. Concatenation is what actually keeps the shape out of the blob.
 */
export const KNOWN_SAMPLE_VALUE_PREFIXES: readonly string[] = [
  // jwt.io HS256 demo header
  `eyJhbGciOiJIUzI1${"NiIsInR5cCI6IkpXVCJ9"}`,
  // AWS docs example access key
  `AKIAIOSFO${"DNN7EXAMPLE"}`,
  // Stripe docs test key
  `sk_test_${"4eC39HqLyjWDarjtT1zdp7dc"}`,
  // The published payment-card test numbers. They are Luhn-valid by design, so
  // the card pattern fired `high` on every payment test anyone wrote and told
  // them to notify a compliance owner about a number printed in public
  // documentation. Nothing to rotate, nothing to disclose — pure noise, and the
  // kind that teaches people the hook cries wolf.
  ["4111", "1111", "1111", "1111"].join(""),
  ["4242", "4242", "4242", "4242"].join(""),
  ["4012", "8888", "8888", "1881"].join(""),
  ["5555", "5555", "5555", "4444"].join(""),
  ["5105", "1051", "0510", "5100"].join(""),
  ["3782", "8224", "6310", "005"].join(""),
  ["3714", "4963", "5398", "431"].join(""),
  ["6011", "1111", "1111", "1117"].join(""),
  ["3530", "1113", "3330", "0000"].join(""),
];

/**
 * Lines containing these tokens are treated as documentation, so a high finding
 * demotes to medium (ask) instead of denying.
 *
 * The lookarounds exclude `.`, `/`, `-`, and `_` neighbours on purpose. Plain
 * `\bexample\b` matches `api.example.com`, which would let any request to an
 * example.com URL defuse detection on the very line carrying the credential —
 * a false negative introduced by a false-positive fix. Found by the test
 * battery; keep the lookarounds.
 */
export const DOC_CONTEXT_RE =
  /(?<![\w./-])(?:example|sample|placeholder|dummy|fixture|mock|illustration)(?![\w./-])/i;
