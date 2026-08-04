/**
 * detect.test.ts — the detection core, including the cases that must NOT fire.
 *
 * The false-positive half of this file is the important half. A baseline that
 * blocks `env VAR=1 make`, `.env.example`, or `PASSWORD = "${DB_PASS}"` gets
 * switched off within a week, and then it protects nobody.
 *
 * Run: bun test .claude/hooks/tests/
 */

import { describe, expect, test } from "bun:test";
import {
  classifyPath,
  isTemplateEnvFile,
  passesIbanChecksum,
  passesLuhn,
  peakConfidence,
  redact,
  scanText,
  shannonEntropy,
} from "../lib/detect";
import { argsOf, normalizeSegment, readTargets, segments, verbOf } from "../lib/command-parse";
import { decisionFor, globToRegExp, type SecurityConfig } from "../lib/config";

const ids = (text: string) => scanText(text).map((f) => f.patternId);

// Synthetic credentials. Structurally valid so the patterns fire, but issued by
// nobody — none of these authenticate against anything.
//
// EVERY ONE IS ASSEMBLED FROM PARTS, and new ones must be too. A contiguous
// credential-shaped literal in this file is a real credential shape to every
// other scanner in the pipeline — GitHub push protection rejected the GitLab and
// Slack fixtures on this repo's first push, when they were single literals. The
// `agent-setup:allow` marker silences our own scanner and nothing else, so
// concatenation is the part that actually works.
const FAKE = {
  anthropic: `sk-ant-api03-${"A1b2C3d4E5f6G7h8".repeat(2)}_-xyz`,
  openai: `sk-proj-${"Zz9Yy8Xx7Ww6Vv5U".repeat(2)}`,
  openrouter: `sk-or-v1-${"4f".repeat(24)}`,
  awsId: `AKIA${"2ZZZQQ4TEXAMPLE9"}`,
  github: `ghp_${"aB3".repeat(12)}`,
  gitlab: `glpat-${"A1b2C3d4E5f6G7h8I9j0"}`,
  slack: `xoxb-${"2914571828-2917284712-abcdefghijklmnop"}`,
  google: `AIza${"Bc9".repeat(11)}xy`,
  stripeLive: `sk_live_${"9aZ".repeat(8)}`,
  stripeTest: `sk_test_${"9aZ".repeat(8)}`,
  npm: `npm_${"c7Q".repeat(12)}`,
  jwt: `eyJhbGciOiJSUzI1NiJ9.${"eyJzdWIiOiJzdmMtYWNjb3VudCIsImV4cCI6OTk5OX0"}.${"c2lnbmF0dXJlLXZhbHVlLWhlcmU"}`,
  pem: `-----BEGIN RSA ${"PRIVATE KEY"}-----\nMIIEpAIBAAKCAQEA\n-----END RSA ${"PRIVATE KEY"}-----`,
  dbUri: `postgresql://svc_app:${"Hunter2Hunter2"}@db.internal:5432/prod`,
  sendgrid: `SG.${"a1B2c3D4e5F6g7H8i9J0k1"}.${"L2m3N4o5P6q7R8s9T0u1V2w3X4y5Z6a7B8c9D0e1F2g"}`,
} as const;

describe("provider credential shapes", () => {
  test.each([
    ["anthropic-api-key", FAKE.anthropic],
    ["openai-api-key", FAKE.openai],
    ["openrouter-key", FAKE.openrouter],
    ["aws-access-key-id", FAKE.awsId],
    ["github-token", FAKE.github],
    ["gitlab-pat", FAKE.gitlab],
    ["slack-token", FAKE.slack],
    ["google-api-key", FAKE.google],
    ["stripe-live-key", FAKE.stripeLive],
    ["npm-token", FAKE.npm],
    ["jwt", FAKE.jwt],
    ["private-key-block", FAKE.pem],
    ["db-connection-uri", FAKE.dbUri],
    ["sendgrid-key", FAKE.sendgrid],
  ])("detects %s", (id, sample) => {
    expect(ids(String(sample))).toContain(id);
  });

  test("every provider shape is high confidence", () => {
    for (const sample of [FAKE.anthropic, FAKE.awsId, FAKE.github, FAKE.pem, FAKE.dbUri]) {
      expect(peakConfidence(scanText(sample))).toBe("high");
    }
  });

  // The published test cards are Luhn-valid by design, so the card pattern fired
  // high on them and told anyone writing a payment test to notify a compliance
  // owner. They are documentation values; suppress them like the other doc
  // credentials. Assembled from parts, per this file's convention.
  const DOC_CARDS = [
    ["visa", ["4111", "1111", "1111", "1111"]],
    ["visa-alt", ["4242", "4242", "4242", "4242"]],
    ["mastercard", ["5555", "5555", "5555", "4444"]],
    ["mastercard-2", ["5105", "1051", "0510", "5100"]],
    ["amex", ["3782", "8224", "6310", "005"]],
    ["discover", ["6011", "1111", "1111", "1117"]],
  ] as const;

  // A fixture that does not match the pattern would make the suppression test
  // vacuous — which is exactly what happened on the first draft, where two of
  // these were assembled to 17 digits and "passed" without ever being detected.
  test.each(DOC_CARDS)("%s fixture is a valid card number to begin with", (_name, parts) => {
    expect(passesLuhn(parts.join(""))).toBe(true);
  });

  test.each(DOC_CARDS)("the published %s test card is not reported", (_name, parts) => {
    expect(scanText(`const testCard = "${parts.join("")}";`)).toEqual([]);
  });

  test("a card number that is not a published sample is still reported", () => {
    const real = ["4539", "1488", "0343", "6467"].join(""); // Luhn-valid, not a doc sample
    expect(passesLuhn(real)).toBe(true);
    expect(scanText(`card=${real}`).map((f) => f.patternId)).toContain("credit-card");
  });

  test("stripe test keys are medium, live keys are high", () => {
    expect(scanText(FAKE.stripeTest)[0]?.confidence).toBe("medium");
    expect(scanText(FAKE.stripeLive)[0]?.confidence).toBe("high");
  });

  test("finds a key inside a realistic .env line", () => {
    const found = scanText(`ANTHROPIC_API_KEY=${FAKE.anthropic}\nPORT=8080\n`);
    expect(found.map((f) => f.patternId)).toContain("anthropic-api-key");
    expect(found[0].line).toBe(1);
  });

  test("reports every distinct credential in a multi-line payload", () => {
    const payload = [`AWS_ACCESS_KEY_ID=${FAKE.awsId}`, `GITHUB_TOKEN=${FAKE.github}`].join("\n");
    expect(ids(payload).sort()).toEqual(["aws-access-key-id", "github-token"]);
  });

  // Line numbers are what an operator greps for after an audit row. Pinned
  // deliberately: the naive implementation rescanned from offset 0 for every
  // finding, and the faster one it was replaced with is only worth having if it
  // agrees with it exactly — including on the last line and with no trailing
  // newline.
  test("line numbers are exact across a long payload", () => {
    const lines = Array.from({ length: 500 }, (_, i) => `filler ${i}`);
    lines[0] = `AWS_ACCESS_KEY_ID=${FAKE.awsId}`;
    lines[249] = `GITHUB_TOKEN=${FAKE.github}`;
    lines[499] = `ANTHROPIC_API_KEY=${FAKE.anthropic}`;
    const found = scanText(lines.join("\n"));
    expect(found.map((f) => f.line)).toEqual([1, 250, 500]);
  });

  test("line numbers survive CRLF and a leading blank line", () => {
    const found = scanText(`\r\n\r\nGITHUB_TOKEN=${FAKE.github}\r\n`);
    expect(found[0]?.line).toBe(3);
  });
});

describe("no secret is ever echoed back", () => {
  test("preview masks the middle and the finding carries no raw value", () => {
    const [finding] = scanText(FAKE.anthropic);
    expect(finding.preview).not.toContain(FAKE.anthropic.slice(6, 20));
    expect(JSON.stringify(finding)).not.toContain(FAKE.anthropic);
  });

  test("redact keeps only four leading and two trailing characters", () => {
    expect(redact("abcdefghijklmnop")).toBe("abcd**********op");
    expect(redact("short")).toBe("*****");
  });

  test("the same value always hashes to the same allowlistable id", () => {
    expect(scanText(FAKE.github)[0].valueHash).toBe(scanText(FAKE.github)[0].valueHash);
    expect(scanText(FAKE.github)[0].valueHash).toHaveLength(12);
  });
});

describe("suppression — the cases that must not fire", () => {
  test.each([
    ['API_KEY=""', "empty value"],
    ["API_KEY=changeme", "changeme"],
    ["API_KEY=your-api-key-here", "documentation placeholder"],
    ["SECRET_TOKEN=<your-token>", "angle-bracket placeholder"],
    ["DB_PASSWORD=${DB_PASSWORD}", "shell interpolation"],
    ["password: xxxxxxxxxxxxxxxx", "masked value"],
    ["AWS_SECRET_ACCESS_KEY=REDACTED", "redacted marker"],
    ["const TOKEN = process.env.TOKEN", "env reference, not a value"],
    ["PASSWORD=null", "null literal"],
  ])("%s → no finding (%s)", (line) => {
    expect(scanText(line)).toEqual([]);
  });

  test("inline allow markers suppress the line", () => {
    expect(scanText(`token = "${FAKE.github}"  # gitleaks:allow`)).toEqual([]);
    expect(scanText(`token = "${FAKE.github}"  # agent-setup:allow`)).toEqual([]);
  });

  test("known documentation credentials are never reported", () => {
    expect(scanText(`AWS_ACCESS_KEY_ID=AKIAIOSFO${"DNN7EXAMPLE"}`)).toEqual([]);
    expect(
      scanText(
        `eyJhbGciOiJIUzI1${"NiIsInR5cCI6IkpXVCJ9"}.${"eyJzdWIiOiIxMjM0NTY3ODkwIn0"}.${"dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"}`,
      ),
    ).toEqual([]);
  });

  test("an allowlisted hash suppresses that exact value", () => {
    const hash = scanText(FAKE.github)[0].valueHash;
    expect(scanText(FAKE.github, { allowHashes: [hash] })).toEqual([]);
  });

  test("a documentation line demotes high to medium rather than blocking", () => {
    // Same-line only, deliberately. A demote that looked at neighbouring lines
    // would let one `# example` comment defuse a whole .env file below it.
    expect(scanText(`GITHUB_TOKEN=${FAKE.github}  # example value`)[0].confidence).toBe("medium");
    expect(scanText(`# example only\nGITHUB_TOKEN=${FAKE.github}`)[0].confidence).toBe("high");
  });

  test("the generic assignment heuristic needs an opaque value", () => {
    expect(ids("MY_SECRET=hello world this is prose")).not.toContain("generic-secret-assignment");
    // Synthetic entropy fixture, not a credential. The trailing marker is for
    // gitleaks' own generic-api-key heuristic and must sit on the same line to
    // take effect; our scanner reads the value, not the line, so the assertion
    // is unaffected either way.
    expect(ids("MY_SECRET=q7Tz91LmXb44eR0w")).toContain("generic-secret-assignment"); // gitleaks:allow
  });
});

describe("structural validators", () => {
  test("card numbers require a valid Luhn checksum", () => {
    // The detection fixtures here are deliberately NOT the published test cards:
    // those are suppressed as documentation samples now, so using one would test
    // the sample list rather than the Luhn gate this case exists for. The
    // checksum assertions keep the canonical Visa number, where its being a
    // known sample is irrelevant.
    const visaSample = ["4111", "1111", "1111", "1111"].join("");
    expect(passesLuhn(visaSample)).toBe(true);
    expect(passesLuhn(`${visaSample.slice(0, -1)}2`)).toBe(false);

    const valid = ["4539", "1488", "0343", "6467"].join(""); // Luhn-valid, not a sample
    expect(ids(`card ${valid}`)).toContain("credit-card");
    expect(ids(`order ${valid.slice(0, -1)}8`)).not.toContain("credit-card");
  });

  test("IBANs require a valid mod-97 checksum", () => {
    expect(passesIbanChecksum("DE89 3704 0044 0532 0130 00")).toBe(true);
    expect(passesIbanChecksum("DE89 3704 0044 0532 0130 01")).toBe(false);
  });

  test("entropy separates opaque tokens from prose", () => {
    expect(shannonEntropy("q7Tz91LmXb44eR0w")).toBeGreaterThan(3.0);
    expect(shannonEntropy("aaaaaaaaaaaaaaaa")).toBeLessThan(1.0);
  });
});

describe("overlapping matches collapse to the most specific pattern", () => {
  test("an Anthropic key is not also reported as a generic assignment", () => {
    const found = ids(`ANTHROPIC_API_KEY=${FAKE.anthropic}`);
    expect(found).toEqual(["anthropic-api-key"]);
  });

  test("a bearer header is not also reported as a JWT", () => {
    const found = ids(`Authorization: Bearer ${FAKE.jwt}`);
    expect(found).toHaveLength(1);
  });
});

describe("sensitive path classification", () => {
  test.each([
    "/Users/dev/app/.env",
    "/Users/dev/app/.env.local",
    "/Users/dev/app/.env.production",
    "/Users/dev/.aws/credentials",
    "/Users/dev/.ssh/id_ed25519",
    "/Users/dev/app/certs/server.pem",
    "/Users/dev/.npmrc",
    "/Users/dev/.kube/config",
    "/Users/dev/.git-credentials",
    "/Users/dev/app/terraform.tfstate",
    "/Users/dev/gcp-service-account.json",
    "/Users/dev/.zsh_history",
    "/etc/shadow",
  ])("%s is off-limits", (p) => {
    expect(classifyPath(p)).not.toBeNull();
  });

  test.each([
    "/Users/dev/app/.env.example",
    "/Users/dev/app/.env.sample",
    "/Users/dev/app/.env.template",
    "/Users/dev/.ssh/id_ed25519.pub",
    "/Users/dev/app/src/config.ts",
    "/Users/dev/app/README.md",
    "/Users/dev/app/package.json",
  ])("%s is readable", (p) => {
    expect(classifyPath(p)).toBeNull();
  });

  test("template env detection is suffix-based, not substring-based", () => {
    expect(isTemplateEnvFile(".env.example")).toBe(true);
    expect(isTemplateEnvFile(".env.production")).toBe(false);
  });

  test("an allowPaths glob overrides the block", () => {
    const re = [globToRegExp("testdata/**")];
    expect(classifyPath("/repo/testdata/nested/.env", re)).toBeNull();
    expect(classifyPath("/repo/src/.env", re)).not.toBeNull();
  });
});

describe("command parsing", () => {
  test("splits pipelines and lists", () => {
    expect(segments("ls -la; cat .env | head -1 && echo done")).toEqual([
      "ls -la",
      "cat .env",
      "head -1",
      "echo done",
    ]);
  });

  test("separators inside quotes are not separators", () => {
    expect(segments(`echo "a;b" && ls`)).toEqual([`echo "a;b"`, "ls"]);
  });

  test("verb resolution skips env assignments, wrappers, and directories", () => {
    expect(verbOf("cat .env")).toBe("cat");
    expect(verbOf("FOO=1 BAR=2 cat .env")).toBe("cat");
    expect(verbOf("sudo cat .env")).toBe("cat");
    expect(verbOf("/bin/cat .env")).toBe("cat");
    // `env` is both a dump command and a prefix runner, so it resolves both
    // ways on purpose: bare `env` stays `env` and remains catchable by the
    // dump rules, while `env FOO=1 <cmd>` resolves to the wrapped command —
    // otherwise `env FOO=1 cat .env` reads as a harmless `env` invocation.
    expect(verbOf("env")).toBe("env");
    expect(verbOf(segments("env | grep KEY")[0])).toBe("env");
    // Defensive: even handed a whole pipeline, `env` must not resolve to `|`.
    expect(verbOf("env | grep KEY")).toBe("env");
    expect(verbOf("env FOO=1 make build")).toBe("make");
    expect(verbOf("env FOO=1 cat .env")).toBe("cat");
    expect(verbOf("rtk read .env")).toBe("read");
    expect(verbOf("op run -- cat .env")).toBe("cat");
  });

  test("read targets exclude flags and include redirections", () => {
    expect(readTargets("grep -i secret .env")).toContain(".env");
    expect(readTargets("grep -i secret .env")).not.toContain("-i");
    expect(readTargets("wc -l < .env")).toContain(".env");
  });

  test("args are quote-stripped", () => {
    expect(argsOf(`cat "my file.env"`)).toEqual(["my file.env"]);
  });

  test("normalizeSegment collapses whitespace for rule matching", () => {
    expect(normalizeSegment("  aws   configure    get  ")).toBe("aws configure get");
  });
});

describe("the enforcement ladder", () => {
  const cfg = (posture: SecurityConfig["posture"], blocks: SecurityConfig["blockConfidence"]) =>
    ({ posture, blockConfidence: blocks }) as SecurityConfig;

  test("balanced: deny high, ask medium, warn low", () => {
    const c = cfg("balanced", ["high"]);
    expect(decisionFor(c, "high")).toBe("deny");
    expect(decisionFor(c, "medium")).toBe("ask");
    expect(decisionFor(c, "low")).toBe("warn");
  });

  test("strict: deny high and medium, ask low", () => {
    const c = cfg("strict", ["high", "medium"]);
    expect(decisionFor(c, "high")).toBe("deny");
    expect(decisionFor(c, "medium")).toBe("deny");
    expect(decisionFor(c, "low")).toBe("ask");
  });

  test("audit: nothing is ever denied", () => {
    const c = cfg("audit", []);
    for (const level of ["high", "medium", "low"] as const) {
      expect(decisionFor(c, level)).toBe("warn");
    }
  });
});
