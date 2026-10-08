import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { lintWorkflows } from "../../../scripts/lint-workflows.mjs";

// Behavioral fixtures for the actionlint security gate. Intentionally NOT
// *.test.mjs: it needs the Linux actionlint 1.7.12 binary, so release.yml runs
// it with ACTIONLINT_BIN and the three-OS npm matrix never discovers it. There
// is no skip path: a missing or wrong binary hard-fails.
const LINT_URL = new URL("../../../scripts/lint-workflows.mjs", import.meta.url);
const VERSION = "1.7.12";
const TIMEOUT_MS = 10_000;
const MAX_BUFFER = 4 * 1024 * 1024;
const BIN = process.env.ACTIONLINT_BIN;

function run(argv, options = {}) {
  const result = spawnSync(argv[0], argv.slice(1), { encoding: "utf8", timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, ...options });
  assert.equal(result.error, undefined, `spawn failed: ${result.error?.message ?? ""}`);
  assert.notEqual(result.status, null, "the process must exit normally, not be killed by a timeout");
  return result;
}

// Hard-fails (never skips) when the verified binary is absent or not 1.7.12.
function assertActionlint(bin) {
  assert.equal(typeof bin, "string", "ACTIONLINT_BIN must be set to the verified actionlint binary");
  assert.ok(bin.length > 0, "ACTIONLINT_BIN must not be empty");
  assert.ok(fs.existsSync(bin), `ACTIONLINT_BIN does not exist: ${bin}`);
  assert.ok(fs.statSync(bin).isFile(), `ACTIONLINT_BIN is not a file: ${bin}`);
  const version = run([bin, "-version"]);
  assert.equal(version.status, 0, `actionlint -version must succeed: ${version.stderr}`);
  assert.equal(version.stdout.trim().split("\n")[0], VERSION, `actionlint must be ${VERSION}, got ${version.stdout.trim()}`);
  return bin;
}

const tempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "actionlint-fixture-"));
const remove = (directory) => fs.rmSync(directory, { recursive: true, force: true });
function write(base, relative, content) {
  const target = path.join(base, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

// A marker written only if a workflow body actually executed. Linting must
// never run it; the same marker catches accidental execution in every fixture.
const EXECUTED = "executed.marker";
const markerPath = (base) => path.join(base, EXECUTED);
const VALID = [
  "name: valid",
  "on: [push]",
  "jobs:",
  "  valid:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  `      - run: echo executed > ${EXECUTED}`,
  "",
].join("\n");
// The invalid step holds a private-looking expression; the safe formatter must
// report position and kind without echoing it.
const INVALID = [
  "name: invalid",
  "on: [push]",
  "jobs:",
  "  invalid:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - if: ${{ unknown.private_content_marker }}",
  `        run: echo executed > ${EXECUTED}`,
  "",
].join("\n");
// A repository config that would silence every path if it were honored.
const IGNORE_CONFIG = "paths:\n  '**/*.{yml,yaml}':\n    ignore: ['.*']\n";

const lint = (root) => lintWorkflows(root, assertActionlint(BIN));

test("a missing or non-1.7.12 ACTIONLINT_BIN fails the gate instead of skipping", () => {
  const bin = assertActionlint(BIN);
  assert.throws(() => assertActionlint("/nonexistent/actionlint"), /does not exist/);
  assert.throws(() => assertActionlint(process.execPath), "a non-actionlint binary must be rejected");
  assert.throws(() => lintWorkflows(tempRoot(), "/nonexistent/actionlint"), /does not exist/);
  assert.equal(bin, BIN);
});

test("valid live and future distributed workflows lint clean and never execute", () => {
  const root = tempRoot();
  try {
    write(root, ".github/workflows/live.yaml", VALID);
    write(root, "skills/future-advisor/assets/templates/asset.yaml", VALID);
    const { status, diagnostics } = lint(root);
    assert.equal(status, 0, diagnostics);
    assert.equal(fs.existsSync(markerPath(root)), false, "linting a valid workflow must not execute it");
  } finally {
    remove(root);
  }
});

test("an invalid future asset fails safely even when a repo ignore matches it", () => {
  const root = tempRoot();
  try {
    write(root, ".github/workflows/live.yaml", VALID);
    write(root, ".github/actionlint.yaml", IGNORE_CONFIG);
    write(root, "skills/future-advisor/assets/templates/asset.yaml", INVALID);
    const { status, diagnostics } = lint(root);
    assert.equal(status, 1, "an invalid asset must fail the lint");
    assert.ok(diagnostics.length > 0, "diagnostics must not be empty on failure");
    assert.match(diagnostics, /skills\/future-advisor\/assets\/templates\/asset\.yaml:\d+:\d+/);
    assert.equal(diagnostics.includes("private_content_marker"), false, "no source or private path may be printed");
    assert.equal(diagnostics.includes("Message"), false, "no message field may be printed");
    assert.equal(fs.existsSync(markerPath(root)), false, "linting must never execute an invalid workflow");
  } finally {
    remove(root);
  }
});

test("importing the wrapper is inert and exposes the scanner API", () => {
  const script = `const m = await import(${JSON.stringify(LINT_URL.href)}); if (typeof m.lintWorkflows !== "function") process.exit(2);`;
  const result = run([process.execPath, "--input-type=module", "-e", script, "unrelated-argv-argument"]);
  assert.equal(result.status, 0, `the wrapper import must stay inert: ${result.stderr}`);
  assert.equal(result.stdout.trim(), "", "importing the wrapper must not print CLI output");
});
