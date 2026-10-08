import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Behavioral fixtures for the Gitleaks security gate. Intentionally NOT named
// *.test.mjs: it needs the Linux Gitleaks 8.30.1 binary, so the three-OS npm
// matrix never discovers it. release.yml invokes it with GITLEAKS_BIN; no skip path.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const WORKFLOW = path.join(repoRoot, ".github/workflows/release.yml");
const VERSION = "8.30.1";
const TIMEOUT_MS = 10_000;
const MAX_BUFFER = 4 * 1024 * 1024;
const GITLEAKS_BIN = process.env.GITLEAKS_BIN;
function run(bin, args, options = {}) {
  const result = spawnSync(bin, args, {
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    ...options,
  });
  assert.equal(result.error, undefined, `spawn failed: ${result.error?.message ?? ""}`);
  assert.notEqual(result.status, null, "the process must exit normally, not be killed by a timeout");
  return result;
}

// Hard-fails (never skips) when the verified binary is absent or reports a wrong
// version, so a broken toolchain cannot silently turn the gate green.
function assertGitleaks(bin) {
  assert.equal(typeof bin, "string", "GITLEAKS_BIN must be set to the verified Gitleaks binary");
  assert.ok(bin.length > 0, "GITLEAKS_BIN must not be empty");
  assert.ok(fs.existsSync(bin), `GITLEAKS_BIN does not exist: ${bin}`);
  assert.ok(fs.statSync(bin).isFile(), `GITLEAKS_BIN is not a file: ${bin}`);
  const version = run(bin, ["version"]);
  assert.equal(version.status, 0, `gitleaks version must succeed: ${version.stderr}`);
  assert.equal(version.stdout.trim(), VERSION, `Gitleaks must be ${VERSION}, got ${version.stdout.trim()}`);
  return bin;
}

test("a missing, invalid, or non-8.30.1 GITLEAKS_BIN fails the gate instead of skipping", () => {
  const bin = assertGitleaks(GITLEAKS_BIN);
  assert.throws(() => assertGitleaks("/nonexistent/gitleaks"), /does not exist/);
  assert.throws(() => assertGitleaks(process.execPath), "a non-Gitleaks binary must be rejected");
  assert.equal(bin, GITLEAKS_BIN);
});

// No ambient credentials, no remotes, no shared config: fixture git commands run
// offline against a throwaway repository with hooks and prompts disabled.
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_SYSTEM: os.devNull,
  GIT_TERMINAL_PROMPT: "0",
};
function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, env: GIT_ENV });
  assert.equal(result.error, undefined, `git spawn failed: ${result.error?.message ?? ""}`);
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result;
}
function tempGitRepo() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gitleaks-fixture-"));
  const hooks = path.join(directory, ".git-hooks-disabled");
  fs.mkdirSync(hooks, { recursive: true });
  git(directory, ["init", "-q"]);
  git(directory, ["config", "user.email", "ci-fixture@example.com"]);
  git(directory, ["config", "user.name", "ci fixture"]);
  git(directory, ["config", "core.hooksPath", hooks]);
  return directory;
}
// Mirrors the workflow scan: external default-extending config, empty external
// ignore path, inline allow comments ignored, full history, redacted.
function scan(directory) {
  const config = path.join(directory, "gitleaks.toml");
  fs.writeFileSync(config, "[extend]\nuseDefault = true\n");
  const ignore = path.join(directory, "gitleaks-ignore");
  fs.writeFileSync(ignore, "");
  const report = path.join(directory, "gitleaks-report.json");
  const result = run(assertGitleaks(GITLEAKS_BIN), [
    "git",
    "--config", config,
    "--gitleaks-ignore-path", ignore,
    "--ignore-gitleaks-allow",
    "--log-opts=--all --full-history",
    "--redact=100",
    "--no-banner",
    "--report-format", "json",
    "--report-path", report,
    ".",
  ], { cwd: directory });
  return { result, report };
}
test("a secret removed from the working tree is still caught in history and fully redacted", () => {
  // Assembled at runtime so no contiguous secret literal is ever committed.
  const secret = ["ghp_", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"].join("");
  const repository = tempGitRepo();
  fs.writeFileSync(path.join(repository, "token.txt"), `token=${secret}\n`);
  git(repository, ["add", "."]);
  git(repository, ["commit", "-qm", "add fixture secret"]);
  git(repository, ["rm", "-q", "token.txt"]);
  git(repository, ["commit", "-qm", "remove fixture secret"]);
  assert.equal(fs.existsSync(path.join(repository, "token.txt")), false, "the secret must be gone from the working tree");
  const { result, report } = scan(repository);
  const json = fs.readFileSync(report, "utf8");
  assert.equal(result.status, 1, "a historical secret must fail the scan with a strict nonzero status");
  assert.ok(JSON.parse(json).length >= 1, "the historical secret must be reported");
  assert.equal(json.includes(secret), false, "the raw secret must never be written to the report");
  assert.equal(`${result.stdout}${result.stderr}`.includes(secret), false, "the raw secret must never be printed");
  assert.ok(json.includes("REDACTED"), "the report must be redacted");
});

test("a benign repository passes cleanly with no findings", () => {
  const repository = tempGitRepo();
  fs.writeFileSync(path.join(repository, "readme.txt"), "no secrets here\n");
  git(repository, ["add", "."]);
  git(repository, ["commit", "-qm", "benign"]);
  const { result, report } = scan(repository);
  assert.equal(result.status, 0, `a benign tree must pass: ${result.stderr}`);
  assert.equal(JSON.parse(fs.readFileSync(report, "utf8")).length, 0, "no findings are expected");
});
// Extracts only the aggregate gate's inline run expression, so the truth table
// exercises the shipped gate logic without executing unknown source.
function gateRunExpression() {
  const lines = fs.readFileSync(WORKFLOW, "utf8").split(/\r?\n/);
  const start = lines.findIndex((line) => line === "  test-gate:");
  assert.notEqual(start, -1, "the workflow must declare the test-gate job");
  let end = lines.findIndex((line, index) => index > start && /^ {2}[A-Za-z0-9_-]+:$/.test(line));
  if (end < 0) end = lines.length;
  const job = lines.slice(start, end);
  const runAt = job.findIndex((line) => /^\s*run:\s*\S/.test(line));
  assert.notEqual(runAt, -1, "the test-gate job must contain an inline run expression");
  return job[runAt].replace(/^\s*run:\s*/, "").trim();
}

test("the aggregate gate passes only when test and security both succeed", () => {
  const expression = gateRunExpression();
  const outcomes = ["success", "failure", "cancelled", "skipped"];
  let checked = 0;
  for (const testResult of outcomes) {
    for (const securityResult of outcomes) {
      const expected = testResult === "success" && securityResult === "success";
      const result = run("bash", ["-c", expression], {
        env: { ...process.env, MATRIX_RESULT: testResult, SECURITY_RESULT: securityResult },
      });
      assert.equal(result.status === 0, expected, `test=${testResult} security=${securityResult} must ${expected ? "pass" : "fail"}`);
      checked += 1;
    }
  }
  assert.equal(checked, 16, "all 16 result combinations must be exercised");
});
