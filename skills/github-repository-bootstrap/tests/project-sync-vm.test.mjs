import assert from "node:assert/strict";
import test from "node:test";
import {
  FIXTURE_EVENT_PATH,
  FIXTURE_TOKEN,
  MAX_TIMEOUT_MS,
  runWorkflowScript,
} from "./helpers/workflow-vm.mjs";

// Read-only behavioral contract for the opt-in `project-sync` fixture profile.
//
// The default `lifecycle` profile must stay compatible with the U3 contract in
// `workflow-vm.test.mjs`: exactly four env keys, an env-only `process`, and no
// stream, exit, or append surface. `project-sync` is a reviewed, project-owned
// fixture that adds a Buffer global, three fixture env keys, stdout/stderr/exit
// capture, and a virtual summary append target. `node:vm` is NOT a security
// boundary: hostile code CAN escape it, so only reviewed project-owned scripts
// may run here. Every fixture program below is project-owned, reviewed, and
// uses literal fake values only; no case spawns, reads host credentials, or
// touches the network.

test("default and explicit lifecycle profiles keep the four-key env and env-only process", () => {
  const script = [
    "console.log(JSON.stringify(process.env));",
    "console.log(String(typeof Buffer));",
    "console.log(String(typeof process.stdout));",
    "console.log(String(typeof process.stderr));",
    "console.log(String(typeof process.exit));",
  ].join("\n");
  for (const options of [{}, { profile: "lifecycle" }]) {
    const context = runWorkflowScript(script, options);
    assert.deepEqual(Object.keys(context).sort(), ["calls", "logs", "process"]);
    assert.deepEqual(Object.keys(context.process), ["env"]);
    assert.deepEqual(Object.keys(context.process.env), [
      "GITHUB_EVENT_NAME",
      "GITHUB_REPOSITORY",
      "GITHUB_EVENT_PATH",
      "GH_TOKEN",
    ]);
    assert.deepEqual(JSON.parse(context.logs[0]), {
      GITHUB_EVENT_NAME: "issues",
      GITHUB_REPOSITORY: "fixture/repo",
      GITHUB_EVENT_PATH: FIXTURE_EVENT_PATH,
      GH_TOKEN: FIXTURE_TOKEN,
    });
    assert.deepEqual(context.logs.slice(1), ["undefined", "undefined", "undefined", "undefined"]);
    assert.equal(Object.isFrozen(context.process), true);
    assert.equal(Object.isFrozen(context.process.env), false, "the default env must stay mutable");
    assert.equal(context.summary, undefined);
    assert.equal(context.exitCode, undefined);
  }
});

test("runWorkflowScript rejects an unknown, null, or non-string profile", () => {
  for (const profile of ["unknown", null, 42, "PROJECT-SYNC"]) {
    assert.throws(() => runWorkflowScript("", { profile }), /profile/, String(profile));
  }
});

test("project-sync adds the three fixture env keys and freezes a fresh env", () => {
  const script = [
    "console.log(JSON.stringify(process.env));",
    "console.log(String(Object.isFrozen(process.env)));",
  ].join("\n");
  const context = runWorkflowScript(script, {
    profile: "project-sync",
    repository: "acme/widgets",
    projectOwner: "octo",
    projectTitleBase64: "dGl0bGU=",
  });
  assert.deepEqual(Object.keys(context).sort(), ["calls", "exitCode", "logs", "process", "summary"]);
  assert.deepEqual(Object.keys(context.process), ["env", "stdout", "stderr", "exit"]);
  assert.deepEqual(JSON.parse(context.logs[0]), {
    GITHUB_EVENT_NAME: "issues",
    GITHUB_REPOSITORY: "acme/widgets",
    GITHUB_EVENT_PATH: FIXTURE_EVENT_PATH,
    GH_TOKEN: FIXTURE_TOKEN,
    PROJECT_OWNER: "octo",
    PROJECT_TITLE_BASE64: "dGl0bGU=",
    GITHUB_STEP_SUMMARY: "/virtual/step-summary.md",
  });
  assert.equal(context.logs[1], "true");
  assert.equal(Object.isFrozen(context.process), true);
  assert.equal(context.summary, "");
  assert.equal(context.exitCode, undefined);
});

test("project-sync rolls GH_TOKEN between the fixture token and an empty string", () => {
  const script = "console.log(JSON.stringify(process.env.GH_TOKEN));";
  assert.equal(runWorkflowScript(script, { profile: "project-sync", tokenPresent: true }).logs[0], JSON.stringify(FIXTURE_TOKEN));
  assert.equal(runWorkflowScript(script, { profile: "project-sync", tokenPresent: false }).logs[0], JSON.stringify(""));
  for (const tokenPresent of [0, "true", null]) {
    assert.throws(() => runWorkflowScript("", { profile: "project-sync", tokenPresent }), /tokenPresent/, String(tokenPresent));
  }
});

test("project-sync exposes Buffer for a UTF-8 and base64 roundtrip", () => {
  const script = [
    'const encoded = Buffer.from("café → 日本", "utf8").toString("base64");',
    "console.log(encoded);",
    'console.log(Buffer.from(encoded, "base64").toString("utf8"));',
    "console.log(String(typeof Buffer));",
  ].join("\n");
  const context = runWorkflowScript(script, { profile: "project-sync" });
  assert.equal(Buffer.from(context.logs[1], "utf8").toString("base64"), context.logs[0]);
  assert.equal(context.logs[1], "café → 日本");
  assert.equal(context.logs[2], "function");
});

test("project-sync captures stdout and stderr writes and returns booleans", () => {
  const script = [
    'console.log(String(process.stdout.write("out-1")));',
    'console.log(String(process.stderr.write("err-1")));',
    'process.stdout.write("out-2");',
  ].join("\n");
  const context = runWorkflowScript(script, { profile: "project-sync" });
  assert.deepEqual(context.logs, ["out-1", "true", "err-1", "true", "out-2"]);
});

test("project-sync process.exit(0) and exit(1) halt the program and stop gh calls", () => {
  const script = [
    'const { execFileSync } = require("node:child_process");',
    'console.log("before");',
    "process.exit(1);",
    'console.log("footer");',
    'execFileSync("gh", ["api", "x"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });',
  ].join("\n");
  const context = runWorkflowScript(script, { profile: "project-sync", gh: [] });
  assert.deepEqual(context.logs, ["before"]);
  assert.deepEqual(context.calls, []);
  assert.equal(context.exitCode, 1);
  assert.equal(runWorkflowScript("process.exit(0);", { profile: "project-sync" }).exitCode, 0);
  assert.equal(runWorkflowScript("process.exit();", { profile: "project-sync" }).exitCode, 0);
});

test("project-sync process.exit rejects non-integer and out-of-range codes", () => {
  for (const code of [-1, 256, 1.5, "1", null, true]) {
    assert.throws(
      () => runWorkflowScript(`process.exit(${JSON.stringify(code)});`, { profile: "project-sync" }),
      /exit code/,
      String(code),
    );
  }
  assert.equal(runWorkflowScript("process.exit(255);", { profile: "project-sync" }).exitCode, 255);
});

test("project-sync rethrows ordinary errors that carry an exitCode property", () => {
  const script = 'const error = new Error("boom"); error.exitCode = 3; throw error;';
  assert.throws(
    () => runWorkflowScript(script, { profile: "project-sync" }),
    (error) => error.message === "boom" && error.exitCode === 3,
  );
});

test("project-sync accumulates summary appends and returns the joined string", () => {
  const script = [
    'const fs = require("node:fs");',
    'fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, "line-1\\n");',
    'fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, "line-2\\n");',
    'console.log("done");',
  ].join("\n");
  const context = runWorkflowScript(script, { profile: "project-sync" });
  assert.equal(context.summary, "line-1\nline-2\n");
  assert.deepEqual(context.logs, ["done"]);
});

test("project-sync disables summary writes on a blank env and tolerates a simulated failure", () => {
  const guarded = [
    'const fs = require("node:fs");',
    "const summaryPath = process.env.GITHUB_STEP_SUMMARY;",
    'if (!summaryPath) { console.warn("summary disabled"); }',
    'else { try { fs.appendFileSync(summaryPath, "ignored\\n"); } catch (error) { console.warn("summary failed: " + error.message); } }',
  ].join("\n");
  const disabled = runWorkflowScript(guarded, { profile: "project-sync", summaryEnabled: false });
  assert.equal(disabled.process.env.GITHUB_STEP_SUMMARY, "");
  assert.equal(disabled.summary, "");
  assert.deepEqual(disabled.logs, ["summary disabled"]);
  const failed = runWorkflowScript(guarded, { profile: "project-sync", summaryFailure: true });
  assert.equal(failed.summary, "");
  assert.deepEqual(failed.logs, ["summary failed: fixture fs: simulated summary write failure"]);
});

test("project-sync fails closed on unknown paths, modules, commands, and append targets", () => {
  const cases = [
    ['require("node:path")', /unknown module node:path/],
    ['require("node:fs").readFileSync("/etc/hosts", "utf8")', /unknown path/],
    ['require("node:fs").appendFileSync(process.env.GITHUB_EVENT_PATH, "x")', /unknown path/],
    ['require("node:fs").appendFileSync(process.env.GITHUB_STEP_SUMMARY, 42)', /string/],
    ['require("node:fs").writeFileSync(process.env.GITHUB_STEP_SUMMARY, "x")', /writeFileSync/],
    ['require("node:child_process").execFileSync("git", ["status"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })', /unexpected command git/],
    ['require("node:child_process").execFileSync("gh", [1], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })', /array of strings/],
    ['require("node:child_process").execFileSync("gh", ["api", "x"], { encoding: "utf8", stdio: "pipe" })', /options must be/],
  ];
  for (const [expression, pattern] of cases) {
    assert.throws(() => runWorkflowScript(expression, { profile: "project-sync", gh: [] }), pattern, expression);
  }
});

test("project-sync snapshots gh args and keeps the parent event unmutated", () => {
  const event = { issue: { number: 9 } };
  const script = [
    'const fs = require("node:fs");',
    'const { execFileSync } = require("node:child_process");',
    'const live = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));',
    "live.issue.number = 99;",
    'execFileSync("gh", ["api", "repos/acme/widgets/issues/" + live.issue.number], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });',
  ].join("\n");
  const context = runWorkflowScript(script, {
    profile: "project-sync",
    event,
    gh: (call) => {
      call.args.splice(0, call.args.length, "corrupt");
      return {};
    },
  });
  assert.equal(event.issue.number, 9);
  assert.deepEqual(context.calls[0].args, ["api", "repos/acme/widgets/issues/99"]);
});

test("project-sync reuses the timeout bounds and still times out a runaway script", () => {
  for (const timeout of [1.1, 0, -1, Infinity, NaN, MAX_TIMEOUT_MS + 1]) {
    assert.throws(() => runWorkflowScript("", { profile: "project-sync", timeout }), /positive integer/, String(timeout));
  }
  assert.equal(runWorkflowScript("", { profile: "project-sync", timeout: MAX_TIMEOUT_MS }).logs.length, 0);
  assert.throws(
    () => runWorkflowScript("while (true) {}", { profile: "project-sync", timeout: 50 }),
    (error) => error.code === "ERR_SCRIPT_EXECUTION_TIMEOUT",
  );
});

test("project-sync propagates a syntax error instead of returning a status", () => {
  assert.throws(() => runWorkflowScript("const = ;", { profile: "project-sync" }), (error) => error.name === "SyntaxError");
});

test("an exit sentinel is private to its run and never swallowed by another profile", () => {
  const previous = runWorkflowScript("0;", { profile: "project-sync" });
  let stale;
  try {
    previous.process.exit(0);
  } catch (error) {
    stale = error;
  }
  assert.ok(stale instanceof Error, "the captured exit sentinel must be an Error");
  const script = [
    'const { execFileSync } = require("node:child_process");',
    'execFileSync("gh", ["api", "repos/fixture/repo/issues/1"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });',
  ].join("\n");
  for (const profile of [undefined, "lifecycle", "project-sync"]) {
    assert.throws(() => runWorkflowScript(script, { profile, gh: [stale] }), (error) => error === stale, `${profile} queue`);
    assert.throws(
      () => runWorkflowScript(script, { profile, gh: () => { throw stale; } }),
      (error) => error === stale,
      `${profile} handler`,
    );
  }
});
