import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";
import { fileURLToPath } from "node:url";
import { CODE_SAFETY_DESTINATION } from "../scripts/lib.mjs";
import { renderCodeSafetyWorkflow } from "../scripts/code-safety-renderer.mjs";
import { installGhFixture, runBootstrapCli } from "./helpers/native-cli-fixtures.mjs";

// Focused native CLI integration contract for the optional Code safety module
// (T2b). It drives the public plan/apply CLI against the PATH-visible fake `gh`
// and reads only an isolated throwaway repository. It performs no network,
// Docker, target-script or real-GitHub call, and no installed source is edited.
const skillRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const DESTINATION = CODE_SAFETY_DESTINATION;
const DESTINATION_TARGET = path.normalize(DESTINATION);
const packagedAsset = path.join(skillRoot, "assets", "templates", "code-safety.yml");
const packagedBytes = fs.readFileSync(packagedAsset);
afterEach(() => assert.deepEqual(fs.readFileSync(packagedAsset), packagedBytes,
  "CLI fixture tests must not modify the real packaged workflow"));

const GH_REPLIES = {
  "--version": "gh version test\n",
  "api -i user": "HTTP/2 200\nx-oauth-scopes: repo\n",
  "api users/acme-org": '{"type":"Organization"}',
  "api repos/acme-org/widgets":
    '{"full_name":"acme-org/widgets","node_id":"R_1","owner":{"login":"acme-org"}}',
  "api user": '{"login":"maintainer"}',
};

const policy = (overrides = {}) => ({
  schemaVersion: 1,
  maxTextBytes: 1048576,
  allowedSymlinks: [],
  allowedRootLifecycleHooks: [],
  bidiExceptions: [],
  ...overrides,
});

function withNativeContext(codeSafety, scenario, options = {}) {
  const directory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "bootstrap-code-safety-")),
  );
  const repository = path.join(directory, "repository");
  const bin = path.join(directory, "bin");
  const configPath = path.join(directory, "config.json");
  const logPath = path.join(directory, "gh.log");
  try {
    fs.mkdirSync(bin);
    execFileSync("git", ["init", repository], { stdio: "ignore" });
    execFileSync("git", [
      "-C",
      repository,
      "remote",
      "add",
      "origin",
      "https://github.com/acme-org/widgets.git",
    ]);
    const config = { account: "acme-org", repository: "acme-org/widgets" };
    if (codeSafety !== undefined) config.codeSafety = codeSafety;
    options.configure?.(config);
    fs.writeFileSync(configPath, JSON.stringify(config));
    const activeSkill = options.copySkill
      ? path.join(directory, "skill")
      : skillRoot;
    if (options.copySkill)
      for (const name of ["scripts", "assets"])
        fs.cpSync(path.join(skillRoot, name), path.join(activeSkill, name), {
          recursive: true,
        });
    const context = {
      directory,
      repository,
      bin,
      configPath,
      logPath,
      skillRoot: activeSkill,
    };
    installGhFixture(bin, options.fixtures?.(context, config) ?? GH_REPLIES);
    return scenario(context, (mode, authorize) =>
      runBootstrapCli({
        skillRoot: activeSkill,
        bin,
        configPath,
        repository,
        mode,
        authorize,
        logPath,
      }),
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const assetPath = (context) =>
  path.join(context.skillRoot, "assets", "templates", "code-safety.yml");
const workflowPath = (context) => path.join(context.repository, DESTINATION);
const workflowExists = (context) => fs.existsSync(workflowPath(context));
const readWorkflow = (context) => fs.readFileSync(workflowPath(context), "utf8");
const renderedAsset = (context, policyValue) =>
  renderCodeSafetyWorkflow(fs.readFileSync(assetPath(context), "utf8"), policyValue);

function successfulPlan(run) {
  const result = run("plan");
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  const report = JSON.parse(result.stdout);
  assert.equal(report.success, true);
  return report;
}

function applyAndRead(run, authorization, status = 0) {
  const result = run("apply", authorization);
  assert.equal(result.status, status, result.stdout);
  assert.equal(result.stderr, "");
  const report = JSON.parse(result.stdout);
  assert.equal(report.success, status === 0);
  return report;
}

function assertOnlyReadOnlyCalls(context, replies = GH_REPLIES) {
  for (const line of fs.readFileSync(context.logPath, "utf8").trim().split("\n")) {
    const argv = JSON.parse(line);
    assert.ok(
      Object.hasOwn(replies, argv.join(" ")),
      `unexpected command outside the read-only fixture: ${line}`,
    );
  }
}

test("inactive code safety never reads the asset, observes it or writes the workflow", () => {
  for (const codeSafety of [undefined, false]) {
    withNativeContext(codeSafety, (context, run) => {
      // A directory in place of the packaged asset proves the inactive path
      // never touches it: an active render fails on a non-regular source.
      fs.rmSync(assetPath(context));
      fs.mkdirSync(assetPath(context));
      const plan = successfulPlan(run);
      assert.equal("workflows" in plan.discovered, false);
      assert.deepEqual(plan.plan.filter((entry) => entry.resource === "workflow"), []);
      const report = applyAndRead(run, plan.authorization.value);
      assert.deepEqual(report.completed.filter((entry) => entry.resource === "workflow"), []);
      assert.deepEqual(report.skipped.filter((entry) => entry.resource === "workflow"), []);
      assert.equal(workflowExists(context), false);
      assertOnlyReadOnlyCalls(context);
    }, { copySkill: true });
  }
});

test("active ensure creates the missing workflow under the exact plan authorization", () => {
  withNativeContext({ mode: "ensure" }, (context, run) => {
    const plan = successfulPlan(run);
    assert.equal(plan.discovered.workflows, 1);
    assert.deepEqual(
      plan.plan.filter((entry) => entry.resource === "workflow"),
      [{ resource: "workflow", target: DESTINATION, action: "create", reason: "missing" }],
    );
    const report = applyAndRead(run, plan.authorization.value);
    assert.deepEqual(
      report.completed.filter((entry) => entry.resource === "workflow"),
      [{ resource: "workflow", target: DESTINATION_TARGET, action: "create" }],
    );
    assert.equal(readWorkflow(context), renderedAsset(context, undefined));
    assert.equal(fs.statSync(workflowPath(context)).isFile(), true);
    // Windows stat mode does not expose POSIX group/other write permissions;
    // this assertion is not an ACL check. All CLI and byte checks run there.
    if (process.platform !== "win32")
      assert.equal((fs.statSync(workflowPath(context)).mode & 0o022) === 0, true);
    assertOnlyReadOnlyCalls(context);
  });
});

test("a wrong authorization rejects without creating the workflow", () => {
  withNativeContext({ mode: "ensure" }, (context, run) => {
    successfulPlan(run);
    const result = run("apply", "APPLY_GITHUB_PROJECT_BOOTSTRAP:deadbeef");
    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    const report = JSON.parse(result.stdout);
    assert.equal(report.success, false);
    assert.equal(report.authorization.authorized, false);
    assert.deepEqual(report.completed, []);
    assert.deepEqual(report.skipped, []);
    assert.deepEqual(report.failures, [
      { message: "apply authorization does not match the exact reviewed canonical plan" },
    ]);
    assert.equal(workflowExists(context), false);
    assertOnlyReadOnlyCalls(context);
  });
});

test("active ensure preserves an existing workflow", () => {
  withNativeContext({ mode: "ensure" }, (context, run) => {
    fs.mkdirSync(path.dirname(workflowPath(context)), { recursive: true });
    fs.writeFileSync(workflowPath(context), "human workflow\n");
    const plan = successfulPlan(run);
    assert.deepEqual(
      plan.plan.filter((entry) => entry.resource === "workflow"),
      [
        {
          resource: "workflow",
          target: DESTINATION,
          action: "skip",
          reason: "existing workflow is unmanaged in ensure mode",
        },
      ],
    );
    const report = applyAndRead(run, plan.authorization.value);
    assert.deepEqual(report.skipped.filter((entry) => entry.resource === "workflow"), [
      {
        resource: "workflow",
        target: DESTINATION_TARGET,
        reason: "existing workflow is unmanaged in ensure mode",
      },
    ]);
    assert.equal(readWorkflow(context), "human workflow\n");
  });
});

test("active replace creates missing, skips equal and updates different bytes", () => {
  withNativeContext({ mode: "replace" }, (context, run) => {
    const rendered = renderedAsset(context, undefined);
    fs.mkdirSync(path.dirname(workflowPath(context)), { recursive: true });
    // Missing destination plans and applies a create.
    const createPlan = successfulPlan(run);
    assert.equal(createPlan.plan.find((entry) => entry.resource === "workflow").action, "create");
    applyAndRead(run, createPlan.authorization.value);
    assert.equal(readWorkflow(context), rendered);
    // Equal bytes plan and apply a skip.
    const equalPlan = successfulPlan(run);
    assert.deepEqual(
      equalPlan.plan.find((entry) => entry.resource === "workflow"),
      {
        resource: "workflow",
        target: DESTINATION,
        action: "skip",
        reason: "already matches rendered source",
      },
    );
    const equalReport = applyAndRead(run, equalPlan.authorization.value);
    assert.equal(equalReport.skipped.filter((entry) => entry.resource === "workflow").length, 1);
    assert.equal(readWorkflow(context), rendered);
    // Different bytes plan and apply an update.
    fs.writeFileSync(workflowPath(context), "stale workflow\n");
    const updatePlan = successfulPlan(run);
    assert.deepEqual(
      updatePlan.plan.find((entry) => entry.resource === "workflow"),
      {
        resource: "workflow",
        target: DESTINATION,
        action: "update",
        reason: "managed replacement differs",
      },
    );
    const updateReport = applyAndRead(run, updatePlan.authorization.value);
    assert.deepEqual(updateReport.completed.filter((entry) => entry.resource === "workflow"), [
      { resource: "workflow", target: DESTINATION_TARGET, action: "update" },
    ]);
    assert.equal(readWorkflow(context), rendered);
  });
});

test("the reviewed policy is bound into the authorization and the created bytes", () => {
  withNativeContext({ mode: "ensure" }, (context, run) => {
    const withoutPolicy = successfulPlan(run).authorization.value;
    fs.writeFileSync(
      context.configPath,
      JSON.stringify({
        account: "acme-org",
        repository: "acme-org/widgets",
        codeSafety: { mode: "ensure", policy: policy() },
      }),
    );
    const withPolicy = successfulPlan(run);
    assert.notEqual(withPolicy.authorization.value, withoutPolicy);
    applyAndRead(run, withPolicy.authorization.value);
    assert.equal(readWorkflow(context), renderedAsset(context, policy()));
    assert.equal(readWorkflow(context).includes("__REPOSITORY_POLICY_BASE64__"), false);
  });
});

test("unexpected source drift between plan and apply fails closed before any mutation", () => {
  withNativeContext({ mode: "ensure" }, (context, run) => {
    const asset = assetPath(context);
    const changed = Buffer.concat([fs.readFileSync(asset), Buffer.from("early drift")]);
    const plan = successfulPlan(run);
    installGhFixture(context.bin, {
      ...GH_REPLIES,
      "api user": {
        stdout: GH_REPLIES["api user"],
        write: { file: asset, base64: changed.toString("base64") },
      },
    });
    const result = run("apply", plan.authorization.value);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    const report = JSON.parse(result.stdout);
    assert.equal(report.success, false);
    assert.deepEqual(report.completed, []);
    assert.deepEqual(report.skipped, []);
    assert.deepEqual(report.failures, [
      { message: "Code safety workflow source or destination changed after authorization" },
    ]);
    assert.equal(workflowExists(context), false);
    assert.deepEqual(fs.readFileSync(asset), changed);
    assertOnlyReadOnlyCalls(context, {
      ...GH_REPLIES,
      "api user": { stdout: GH_REPLIES["api user"], write: { file: asset, base64: changed.toString("base64") } },
    });
  }, { copySkill: true });
});

test("late source drift after a completed write fails closed and preserves the report", () => {
  const label = { "type:bug": { color: "D73A4A" } };
  withNativeContext(
    { mode: "ensure" },
    (context, run) => {
      assert.notEqual(context.skillRoot, skillRoot, "late drift must use an isolated skill copy");
      const asset = assetPath(context);
      const changed = Buffer.concat([fs.readFileSync(asset), Buffer.from("late drift")]);
      const post =
        "api --method POST repos/acme-org/widgets/labels -f name=type:bug -f color=D73A4A -f description=";
      const replies = {
        ...GH_REPLIES,
        "api --paginate --slurp repos/acme-org/widgets/labels?per_page=100": "[]",
        [post]: { stdout: "{}", write: { file: asset, base64: changed.toString("base64") } },
      };
      installGhFixture(context.bin, replies);
      const plan = successfulPlan(run);
      installGhFixture(context.bin, replies);
      const result = run("apply", plan.authorization.value);
      assert.equal(result.status, 1);
      assert.equal(result.stderr, "");
      const report = JSON.parse(result.stdout);
      assert.equal(report.success, false);
      assert.deepEqual(report.completed, [
        { resource: "label", target: "type:bug", action: "create" },
      ]);
      assert.deepEqual(report.failures, [
        { message: "Code safety workflow source or destination changed after authorization" },
      ]);
      assert.equal(workflowExists(context), false);
      assert.deepEqual(fs.readFileSync(asset), changed);
    },
    { copySkill: true, configure: (config) => { config.labels = label; } },
  );
});

test("non-regular packaged source and symlinked destination parents fail before mutations", () => {
  withNativeContext({ mode: "ensure" }, (context, run) => {
    fs.rmSync(assetPath(context));
    fs.mkdirSync(assetPath(context));
    const result = run("plan");
    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    const report = JSON.parse(result.stdout);
    assert.equal(report.success, false);
    assert.deepEqual(report.failures, [
      { message: "Code safety source is not a regular file: code-safety.yml" },
    ]);
    assert.equal(fs.existsSync(path.join(context.repository, ".github")), false);
  }, { copySkill: true });
  withNativeContext({ mode: "replace" }, (context, run) => {
    const outside = path.join(context.directory, "outside");
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(context.repository, ".github"), "junction");
    const result = run("plan");
    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    const report = JSON.parse(result.stdout);
    assert.equal(report.success, false);
    assert.deepEqual(report.completed, []);
    assert.deepEqual(report.skipped, []);
    assert.match(report.failures[0].message, /symbolic link/);
    assert.deepEqual(fs.readdirSync(outside), []);
  });
});
