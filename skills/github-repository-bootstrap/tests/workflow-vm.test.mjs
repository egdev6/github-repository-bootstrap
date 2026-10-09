import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TIMEOUT_MS,
  FIXTURE_EVENT_PATH,
  FIXTURE_TOKEN,
  extractNodeHeredoc,
  runWorkflowScript,
} from "./helpers/workflow-vm.mjs";

// Read-only behavioral contract for the in-process workflow fixture runner.
// Every fixture program below is project-owned and reviewed. The fixture API
// seeds only fake dependencies and a virtual environment, and the helper
// performs no host I/O or spawns. `node:vm` is NOT a security boundary: hostile
// code CAN escape it, so only reviewed project-owned scripts may run here.
// These tests assert the four fixed virtual env keys; they do not claim that a
// malicious script cannot read the real host environment.
const YAML = (eol, indent = "      ") =>
  ["jobs:", "  run:", "    steps:", "      - run: |", `${indent}node <<'NODE'`, `${indent}console.log("hi")`, `${indent}NODE`, ""].join(eol);

const READ_AND_GET = [
  'const { execFileSync } = require("node:child_process");',
  'const fs = require("node:fs");',
  'const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));',
  'const body = execFileSync("gh", ["api", "repos/" + process.env.GITHUB_REPOSITORY + "/issues/" + event.issue.number], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });',
  "console.log(body);",
].join("\n");

test("extractNodeHeredoc returns the exact single LF body", () => {
  assert.equal(extractNodeHeredoc(YAML("\n")), '      console.log("hi")\n');
});

test("extractNodeHeredoc preserves CRLF bytes", () => {
  assert.equal(extractNodeHeredoc(YAML("\r\n")), '      console.log("hi")\r\n');
});

test("extractNodeHeredoc rejects missing, ambiguous, and unterminated heredocs", () => {
  assert.throws(() => extractNodeHeredoc("run: echo hi\n"), /exactly one/);
  assert.throws(() => extractNodeHeredoc(YAML("\n") + YAML("\n")), /exactly one/);
  assert.throws(() => extractNodeHeredoc(["jobs:", "  run:", "    node <<'NODE'", "    console.log(1)"].join("\n")), /not terminated/);
});

test("extractNodeHeredoc only matches quoted openers and a same-indent terminator", () => {
  assert.throws(() => extractNodeHeredoc(["run: |", "  node <<NODE", "  body", "  NODE"].join("\n")), /exactly one/);
  const shifted = ["run: |", "  node <<'NODE'", "    NODE inside", "  body", "  NODE", ""].join("\n");
  assert.equal(extractNodeHeredoc(shifted), "    NODE inside\n  body\n", "a differently indented NODE must not terminate");
});

test("runWorkflowScript requires a positive integer timeout within the vm range", () => {
  for (const timeout of [1.1, 0, -1, Infinity, NaN, 4_294_967_296]) {
    assert.throws(() => runWorkflowScript("", { timeout }), /positive integer/, String(timeout));
  }
  // A 1 ms bound is valid input, but wall-clock load can make node:vm raise the
  // execution-timeout error for even an empty script, so exactly two outcomes
  // are accepted. Any other outcome, including our own validation error, fails.
  try {
    assert.equal(runWorkflowScript("", { timeout: 1 }).logs.length, 0);
  } catch (error) {
    assert.equal(error.code, "ERR_SCRIPT_EXECUTION_TIMEOUT", `unexpected 1 ms outcome: ${error.message}`);
  }
  assert.equal(runWorkflowScript("", { timeout: 4_294_967_295 }).logs.length, 0);
});

test("runWorkflowScript injects the virtual event and records the gh GET call", () => {
  const context = runWorkflowScript(READ_AND_GET, {
    event: { issue: { number: 7 } },
    gh: [{ number: 7, labels: [{ name: "bug" }] }],
  });
  assert.deepEqual(context.calls, [{
    command: "gh",
    args: ["api", "repos/fixture/repo/issues/7"],
    options: { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  }]);
  assert.deepEqual(context.logs, [JSON.stringify({ number: 7, labels: [{ name: "bug" }] })]);
});

test("runWorkflowScript clones the event and keeps call records in the parent realm", () => {
  const event = { issue: { number: 9 } };
  const script = [
    'const { execFileSync } = require("node:child_process");',
    'const fs = require("node:fs");',
    'const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));',
    "event.issue.number = 99;",
    'execFileSync("gh", ["api", String(event.issue.number)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });',
  ].join("\n");
  const context = runWorkflowScript(script, { event, gh: ["{}"] });
  assert.equal(event.issue.number, 9, "the parent event must not be mutated");
  assert.ok(Array.isArray(context.calls[0].args), "recorded args must be a parent-realm array");
  assert.deepEqual(context.calls[0].args, ["api", "99"]);
});

test("runWorkflowScript records a gh mutation with the trusted fixture script", () => {
  const script = [
    'const { execFileSync } = require("node:child_process");',
    'execFileSync("gh", ["api", "--method", "POST", "repos/fixture/repo/issues/5/labels", "-f", "labels[]=status:needs-review"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });',
    'console.log("added");',
  ].join("\n");
  const context = runWorkflowScript(script, { gh: [""] });
  assert.equal(context.calls[0].args[3], "repos/fixture/repo/issues/5/labels");
  assert.deepEqual(context.logs, ["added"]);
});

test("runWorkflowScript snapshots call args before the gh handler can mutate them", () => {
  const script = 'const cp = require("node:child_process");\ncp.execFileSync("gh", ["api", "repos/fixture/repo/issues/1"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });';
  const context = runWorkflowScript(script, {
    gh: (call) => {
      call.args.splice(0, call.args.length, "corrupt");
      return {};
    },
  });
  assert.deepEqual(context.calls[0].args, ["api", "repos/fixture/repo/issues/1"]);
});

test("runWorkflowScript accepts string, queue, and handler responses and fails closed on undefined", () => {
  const echo = 'const { execFileSync } = require("node:child_process");\nconsole.log(execFileSync("gh", ["api", "x"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));';
  assert.deepEqual(runWorkflowScript(echo, { gh: ["raw-text"] }).logs, ["raw-text"]);
  assert.deepEqual(runWorkflowScript(echo, { gh: () => ({ ok: true }) }).logs, ['{"ok":true}']);
  assert.deepEqual(runWorkflowScript(echo, { gh: (call) => call.args[1] }).logs, ["x"]);
  assert.throws(() => runWorkflowScript(echo, { gh: [undefined] }), /response must be/);
  assert.throws(() => runWorkflowScript(echo, { gh: [] }), /exhausted/);
});

test("runWorkflowScript exposes only the virtual environment and no host globals", () => {
  const script = "console.log(JSON.stringify(process.env));\nconsole.log(String(typeof fetch));\nconsole.log(String(typeof require('node:fs').writeFileSync));";
  const context = runWorkflowScript(script, { eventName: "pull_request", repository: "acme/widgets" });
  assert.deepEqual(JSON.parse(context.logs[0]), {
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_REPOSITORY: "acme/widgets",
    GITHUB_EVENT_PATH: FIXTURE_EVENT_PATH,
    GH_TOKEN: FIXTURE_TOKEN,
  });
  assert.deepEqual(Object.keys(context.process), ["env"]);
  assert.equal(context.logs[1], "undefined");
  assert.equal(context.logs[2], "undefined");
});

test("runWorkflowScript fails closed on unknown modules, paths, and bad CLI signatures", () => {
  const cases = [
    ['require("node:os")', /unknown module node:os/],
    ['require("node:fs").readFileSync("/etc/hosts", "utf8")', /unknown path/],
    ['require("node:child_process").execFileSync("git", ["status"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })', /unexpected command git/],
    ['require("node:child_process").execFileSync("gh", [1], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })', /array of strings/],
    ['require("node:child_process").execFileSync("gh", ["api", "x"], { encoding: "utf8", stdio: "pipe" })', /options must be/],
    ['require("node:fs").readFileSync(process.env.GITHUB_EVENT_PATH, "latin1")', /requires utf8/],
  ];
  for (const [expression, pattern] of cases) {
    assert.throws(() => runWorkflowScript(expression, { gh: [] }), pattern, expression);
  }
});

test("runWorkflowScript propagates a gh fixture error with its stderr", () => {
  const script = [
    'const { execFileSync } = require("node:child_process");',
    'try { execFileSync("gh", ["api", "x"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }',
    "catch (error) { console.log(error.stderr); throw error; }",
  ].join("\n");
  const failure = new Error("gh: Forbidden");
  failure.stderr = "gh: Forbidden (HTTP 403)";
  assert.throws(() => runWorkflowScript(script, { gh: [failure] }), (error) => error.stderr === "gh: Forbidden (HTTP 403)");
  assert.deepEqual(runWorkflowScript(script.replace("throw error;", ""), { gh: [failure] }).logs, ["gh: Forbidden (HTTP 403)"]);
});

test("runWorkflowScript bounds a runaway script with ERR_SCRIPT_EXECUTION_TIMEOUT", () => {
  assert.throws(
    () => runWorkflowScript("while (true) {}", { timeout: 50 }),
    (error) => error.code === "ERR_SCRIPT_EXECUTION_TIMEOUT",
  );
});

test("runWorkflowScript propagates syntax errors instead of returning a status", () => {
  assert.throws(() => runWorkflowScript("const = ;"), (error) => error.name === "SyntaxError");
  assert.ok(Number.isFinite(DEFAULT_TIMEOUT_MS) && DEFAULT_TIMEOUT_MS > 0, "the default timeout must be finite");
});
