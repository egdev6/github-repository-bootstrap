import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { authorizationValue, normalizeConfig, normalizeGitHubOrigin } from "../scripts/lib.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  fixedTemplateDescriptors,
  renderFixedTemplate,
} from "../scripts/fixed-template-renderer.mjs";
import { installGhFixture, runBootstrapCli } from "./helpers/native-cli-fixtures.mjs";

import { captureFixedTemplates, fixedTemplateState, verifyFixedTemplates } from "../scripts/fixed-template-state.mjs";

const skillRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const TARGETS = {
  config: ".github/ISSUE_TEMPLATE/config.yml",
  bug_report: ".github/ISSUE_TEMPLATE/bug_report.yml",
  feature_request: ".github/ISSUE_TEMPLATE/feature_request.yml",
  pull_request: ".github/pull_request_template.md",
};
const TEMPLATE_ORDER = [
  TARGETS.config,
  TARGETS.bug_report,
  TARGETS.feature_request,
  TARGETS.pull_request,
];
const FORM_SETS = [
  [],
  ["bug_report"],
  ["feature_request"],
  ["bug_report", "feature_request"],
  ["feature_request", "bug_report"],
];
const FORMS = ["bug_report", "feature_request"];
const LABELS = { bug_report: ["type:bug"], feature_request: ["type:bug"] };
const GH_REPLIES = {
  "--version": "gh version test\n",
  "api -i user": "HTTP/2 200\nx-oauth-scopes: repo\n",
  "api users/acme-org": '{"type":"Organization"}',
  "api repos/acme-org/widgets":
    '{"full_name":"acme-org/widgets","node_id":"R_1","owner":{"login":"acme-org"}}',
  "api user": '{"login":"maintainer"}',
  "api --paginate --slurp repos/acme-org/widgets/labels?per_page=100":
    '[[{"name":"type:bug","color":"D73A4A","description":""}]]',
};

function expectedDescriptors(issueForms, pullRequest) {
  return [
    { source: "config.yml", target: TARGETS.config, labelKey: null },
    ...issueForms.map((name) => ({
      source: `${name}.yml`,
      target: TARGETS[name],
      labelKey: name,
    })),
    ...(pullRequest
      ? [{ source: "pull_request_template.md", target: TARGETS.pull_request, labelKey: null }]
      : []),
  ];
}

test("descriptors keep selection order, POSIX targets and form label keys", () => {
  for (const issueForms of FORM_SETS) {
    for (const pullRequest of [false, true]) {
      assert.deepEqual(
        fixedTemplateDescriptors({ issueForms, pullRequest }),
        expectedDescriptors(issueForms, pullRequest),
        `${issueForms.join(",")}/${pullRequest}`,
      );
    }
  }
});

test("descriptors return fresh arrays and reject malformed containers", () => {
  const issueForms = ["bug_report"];
  const descriptors = fixedTemplateDescriptors({ issueForms, pullRequest: true });
  descriptors.push({ source: "extra", target: "extra", labelKey: null });
  descriptors[0].target = "mutated";
  assert.deepEqual(issueForms, ["bug_report"]);
  assert.deepEqual(
    fixedTemplateDescriptors({ issueForms, pullRequest: true }).map(
      (descriptor) => descriptor.target,
    ),
    [
      ".github/ISSUE_TEMPLATE/config.yml",
      ".github/ISSUE_TEMPLATE/bug_report.yml",
      ".github/pull_request_template.md",
    ],
  );
  assert.throws(() => fixedTemplateDescriptors({}), TypeError);
  assert.throws(() => fixedTemplateDescriptors({ issueForms: null }), TypeError);
});

test("renderer preserves the original first-marker and label-key rules", () => {
  const source = "labels: __LABELS__\n";
  const preserved = "labels: __LABELS__\r\ncaf\u00e9 \u4f60\u597d\n";
  const cases = [
    ["first marker", source + "notes: __LABELS__\n", "bug_report",
      { bug_report: ["type:bug"] }, 'labels: ["type:bug"]\nnotes: __LABELS__\n'],
    ["missing labels", source, "bug_report", {}, "labels: []\n"],
    ["explicit empty labels", source, "bug_report", { bug_report: [] }, "labels: []\n"],
    ["JSON escaping", source, "feature_request", { feature_request: ["a,b", 'quote"x'] },
      'labels: ["a,b","quote\\"x"]\n'],
    ["missing selected key", source, "feature_request", { bug_report: ["type:bug"] },
      "labels: []\n"],
    ["no label key", preserved, null, { bug_report: ["type:bug"] }, preserved],
    ["empty label key", preserved, "", { bug_report: ["type:bug"] }, preserved],
    ["no marker", "no marker\r\n", "bug_report", { bug_report: ["x"] }, "no marker\r\n"],
    ["rendered CRLF Unicode", preserved, "bug_report", { bug_report: ["type:bug"] },
      'labels: ["type:bug"]\r\ncaf\u00e9 \u4f60\u597d\n'],
  ];
  for (const [name, input, key, values, expected] of cases)
    assert.equal(renderFixedTemplate(input, key, values), expected, name);
});

function templateEntries(entries) {
  return entries.filter((entry) => entry.resource === "template");
}

function expectedEntries(targets, action) {
  return targets.map((target) => [path.normalize(target), action]);
}

function readTemplate(context, relative) {
  return fs.readFileSync(path.join(context.repository, relative), "utf8");
}

function goldenTemplates() {
  return new Map(TEMPLATE_ORDER.map((relative) => {
    const name = path.posix.basename(relative);
    const labelKey = FORMS.find((form) => `${form}.yml` === name);
    const source = fs.readFileSync(
      path.join(skillRoot, "assets", "templates", name),
      "utf8",
    );
    const content = labelKey
      ? source.replace("__LABELS__", JSON.stringify(LABELS[labelKey] ?? []))
      : source;
    return [relative, content];
  }));
}

function templates(mode) {
  return {
    issueForms: [...FORMS],
    issueFormLabels: { ...LABELS },
    pullRequest: true,
    mode,
  };
}

function withNativeContext(templateConfig, scenario, options = {}) {
  const directory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "bootstrap-fixed-template-renderer-")),
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
    const config = {
      account: "acme-org",
      repository: "acme-org/widgets",
      labels: { "type:bug": { color: "D73A4A" } },
    };
    if (templateConfig) config.templates = templateConfig;
    options.configure?.(config);
    fs.writeFileSync(configPath, JSON.stringify(config));
    installGhFixture(bin, GH_REPLIES);
    const activeSkill = options.copySkill ? path.join(directory, "skill") : skillRoot;
    if (options.copySkill)
      for (const name of ["scripts", "assets"])
        fs.cpSync(path.join(skillRoot, name), path.join(activeSkill, name), { recursive: true });
    const context = { directory, repository, bin, configPath, logPath, skillRoot: activeSkill };
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

function planAndApply(run) {
  const planRun = run("plan");
  assert.equal(planRun.status, 0);
  assert.equal(planRun.stderr, "");
  const plan = JSON.parse(planRun.stdout);
  assert.equal(plan.success, true);
  const applyRun = run("apply", plan.authorization.value);
  assert.equal(applyRun.status, 0);
  assert.equal(applyRun.stderr, "");
  const report = JSON.parse(applyRun.stdout);
  assert.equal(report.success, true);
  return { plan, report };
}

function assertNoRemoteWrites(context) {
  const joined = fs.readFileSync(context.logPath, "utf8");
  for (const line of joined.trim().split("\n")) {
    const argv = JSON.parse(line);
    assert.ok(
      Object.hasOwn(GH_REPLIES, argv.join(" ")),
      `unexpected command outside the read-only fixture: ${line}`,
    );
  }
  assert.match(joined, /labels\?per_page=100/);
  assert.doesNotMatch(joined, /graphql|project/i);
}

test("native ensure preserves existing destinations and reports the old skip", () => {
  withNativeContext(templates("ensure"), (context, run) => {
    fs.mkdirSync(path.join(context.repository, ".github", "ISSUE_TEMPLATE"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(context.repository, TARGETS.bug_report), "stale bug\n");
    fs.writeFileSync(
      path.join(context.repository, TARGETS.feature_request),
      "stale feature\n",
    );
    const { report } = planAndApply(run);
    assert.deepEqual(
      templateEntries(report.completed).map((entry) => [entry.target, entry.action]),
      expectedEntries([TARGETS.config, TARGETS.pull_request], "create"),
    );
    assert.deepEqual(
      templateEntries(report.skipped).map((entry) => [entry.target, entry.reason]),
      expectedEntries(
        [TARGETS.bug_report, TARGETS.feature_request],
        "existing template is unmanaged in ensure mode",
      ),
    );
    assert.equal(readTemplate(context, TARGETS.bug_report), "stale bug\n");
    assert.equal(readTemplate(context, TARGETS.feature_request), "stale feature\n");
    const golden = goldenTemplates();
    assert.equal(readTemplate(context, TARGETS.config), golden.get(TARGETS.config));
    assert.equal(readTemplate(context, TARGETS.pull_request), golden.get(TARGETS.pull_request));
    assertNoRemoteWrites(context);
  });
});

test("native replace creates missing, updates different and always updates equal bytes", () => {
  withNativeContext(templates("replace"), (context, run) => {
    fs.mkdirSync(path.join(context.repository, ".github", "ISSUE_TEMPLATE"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(context.repository, TARGETS.bug_report), "stale bug\n");
    const golden = goldenTemplates();
    const first = planAndApply(run);
    assert.deepEqual(
      templateEntries(first.report.completed).map((entry) => [entry.target, entry.action]),
      [
        [TARGETS.config, "create"],
        [TARGETS.bug_report, "update"],
        [TARGETS.feature_request, "create"],
        [TARGETS.pull_request, "create"],
      ].map(([target, action]) => [path.normalize(target), action]),
    );
    for (const [relative, content] of golden)
      assert.equal(readTemplate(context, relative), content, relative);
    assert.deepEqual(templateEntries(first.report.skipped), []);
    const second = planAndApply(run);
    assert.deepEqual(
      templateEntries(second.report.completed).map((entry) => [entry.target, entry.action]),
      expectedEntries(TEMPLATE_ORDER, "update"),
    );
    for (const [relative, content] of golden)
      assert.equal(readTemplate(context, relative), content, relative);
    assert.deepEqual(templateEntries(second.report.skipped), []);
    assertNoRemoteWrites(context);
  });
});

test("native template-absent config performs no template work", () => {
  withNativeContext(null, (context, run) => {
    const { plan, report } = planAndApply(run);
    assert.equal(plan.plan.some((entry) => entry.resource === "template"), false);
    assert.equal(report.completed.some((entry) => entry.resource === "template"), false);
    assert.equal(report.skipped.some((entry) => entry.resource === "template"), false);
    assert.equal(
      fs.existsSync(path.join(context.repository, ".github", "ISSUE_TEMPLATE")),
      false,
    );
    assertNoRemoteWrites(context);
  });
});

const byteHash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const assetRoot = (context) => path.join(context.skillRoot, "assets", "templates");

function successfulPlan(run) {
  const result = run("plan");
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  const report = JSON.parse(result.stdout);
  assert.equal(report.success, true);
  return report;
}

function rejectedApply(run, authorization, message, completed = [], skipped = []) {
  const result = run("apply", authorization);
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  const report = JSON.parse(result.stdout);
  assert.equal(report.success, false);
  assert.deepEqual(report.failures, [{ message }]);
  assert.deepEqual(report.completed, completed);
  assert.deepEqual(report.skipped, skipped);
  return report;
}

test("fixed-template state hashes every raw asset, rendered payload and destination", () => {
  withNativeContext(templates("replace"), (context) => {
    const destination = path.join(context.repository, TARGETS.bug_report);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const rawDestination = Buffer.from([0xff, 0x0a]);
    fs.writeFileSync(destination, rawDestination);
    const records = captureFixedTemplates(templates("replace"), context.repository, assetRoot(context));
    const golden = goldenTemplates();
    const expected = expectedDescriptors(FORMS, true).map((descriptor) => ({
      ...descriptor,
      sourceHash: byteHash(fs.readFileSync(path.join(assetRoot(context), descriptor.source))),
      renderedHash: byteHash(Buffer.from(golden.get(descriptor.target), "utf8")),
      destinationHash: descriptor.target === TARGETS.bug_report ? byteHash(rawDestination) : null,
    }));
    assert.deepEqual(fixedTemplateState(records), expected);
    for (const record of records) assert.equal(record.content, golden.get(record.target));
    assert.deepEqual(
      verifyFixedTemplates(templates("replace"), context.repository, assetRoot(context), expected),
      records,
    );
    assert.deepEqual(fs.readFileSync(destination), rawDestination);
    for (const source of ["config.yml", "bug_report.yml", "feature_request.yml", "pull_request_template.md"]) {
      const file = path.join(assetRoot(context), source);
      const before = fs.readFileSync(file);
      fs.writeFileSync(file, Buffer.concat([before, Buffer.from("drift")]));
      assert.throws(
        () => verifyFixedTemplates(templates("replace"), context.repository, assetRoot(context), expected),
        { message: "Fixed template source or destination changed after authorization" },
      );
      fs.writeFileSync(file, before);
    }
  }, { copySkill: true });
});

test("native authorization rejects same-rendered raw source drift for every asset", () => {
  for (const mode of ["ensure", "replace"])
    for (const source of ["config.yml", "bug_report.yml", "feature_request.yml", "pull_request_template.md"])
      withNativeContext(templates(mode), (context, run) => {
        const file = path.join(assetRoot(context), source);
        const base = fs.readFileSync(file);
        const first = Buffer.concat([base, Buffer.from([0xff])]);
        const second = Buffer.concat([base, Buffer.from([0xfe])]);
        fs.writeFileSync(file, first);
        const plan = successfulPlan(run);
        fs.writeFileSync(file, second);
        assert.equal(first.toString("utf8"), second.toString("utf8"));
        assert.notEqual(byteHash(first), byteHash(second));
        const report = rejectedApply(run, plan.authorization.value,
          "apply authorization does not match the exact reviewed canonical plan");
        assert.equal(report.authorization.authorized, false);
        assert.equal(fs.existsSync(path.join(context.repository, ".github")), false);
        assert.deepEqual(fs.readFileSync(file), second);
        assertNoRemoteWrites(context);
        planAndApply(run);
        for (const relative of TEMPLATE_ORDER)
          assert.equal(readTemplate(context, relative), goldenTemplates().get(relative) +
            (path.posix.basename(relative) === source ? "\uFFFD" : ""));
        assertNoRemoteWrites(context);
      }, { copySkill: true });
});

test("native destination byte drift rejects before mutations in both modes", () => {
  for (const mode of ["ensure", "replace"])
    for (const relative of TEMPLATE_ORDER)
      withNativeContext(templates(mode), (context, run) => {
        const file = path.join(context.repository, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const first = Buffer.from([0xff]);
        const second = Buffer.from([0xfe]);
        fs.writeFileSync(file, first);
        const plan = successfulPlan(run);
        fs.writeFileSync(file, second);
        const report = rejectedApply(run, plan.authorization.value,
          "apply authorization does not match the exact reviewed canonical plan");
        assert.equal(report.authorization.authorized, false);
        assert.deepEqual(fs.readFileSync(file), second);
        for (const other of TEMPLATE_ORDER.filter((entry) => entry !== relative))
          assert.equal(fs.existsSync(path.join(context.repository, other)), false);
        assertNoRemoteWrites(context);
        planAndApply(run);
        const golden = goldenTemplates();
        assert.equal(readTemplate(context, relative),
          mode === "ensure" ? second.toString("utf8") : golden.get(relative));
        for (const other of TEMPLATE_ORDER.filter((entry) => entry !== relative))
          assert.equal(readTemplate(context, other), golden.get(other));
        assertNoRemoteWrites(context);
      }, { copySkill: true });
});

test("native non-regular assets and destinations fail before mutations", () => {
  for (const kind of ["source", "destination"])
    withNativeContext(templates("ensure"), (context, run) => {
      const file = kind === "source"
        ? path.join(assetRoot(context), "config.yml")
        : path.join(context.repository, TARGETS.config);
      if (kind === "source") fs.unlinkSync(file);
      fs.mkdirSync(file, { recursive: true });
      const result = run("plan");
      assert.equal(result.status, 1);
      assert.equal(result.stderr, "");
      const report = JSON.parse(result.stdout);
      assert.equal(report.success, false);
      assert.deepEqual(report.completed, []);
      assert.deepEqual(report.skipped, []);
      assert.deepEqual(report.failures, [{ message:
        "Template " + kind + " is not a regular file: " +
        (kind === "source" ? "config.yml" : TARGETS.config) }]);
      assert.equal(fs.lstatSync(file).isDirectory(), true);
      for (const other of TEMPLATE_ORDER.filter((entry) => entry !== TARGETS.config))
        assert.equal(fs.existsSync(path.join(context.repository, other)), false);
    }, { copySkill: true });
});

test("late native byte drift preserves the mocked label result without template writes", () => {
  withNativeContext(templates("replace"), (context, run) => {
    const file = path.join(assetRoot(context), "config.yml");
    const changed = Buffer.concat([fs.readFileSync(file), Buffer.from("late drift")]);
    const command = "api --method POST repos/acme-org/widgets/labels -f name=type:probe -f color=000000 -f description=";
    installGhFixture(context.bin, {
      ...GH_REPLIES,
      [command]: { stdout: "{}", write: { file, base64: changed.toString("base64") } },
    });
    const plan = successfulPlan(run);
    const report = rejectedApply(run, plan.authorization.value,
      "Fixed template source or destination changed after authorization",
      [{ resource: "label", target: "type:probe", action: "create" }],
      [{
        resource: "label", target: "type:bug",
        reason: "existing label is unmanaged or already matches",
      }]);
    assert.equal(report.authorization.authorized, true);
    assert.equal(fs.existsSync(path.join(context.repository, ".github")), false);
    assert.deepEqual(fs.readFileSync(file), changed);
    const calls = fs.readFileSync(context.logPath, "utf8").trim().split("\n")
      .map((line) => JSON.parse(line).join(" "));
    assert.equal(calls.filter((call) => call === command).length, 1);
    for (const call of calls)
      assert.ok(call === command || Object.hasOwn(GH_REPLIES, call), call);
  }, {
    copySkill: true,
    configure: (config) => { config.labels["type:probe"] = { color: "000000" }; },
  });
});

test("template-absent native authorization retains the legacy observation shape", () => {
  withNativeContext(null, (context, run) => {
    const plan = successfulPlan(run);
    const observed = {
      labels: [{ name: "type:bug", color: "D73A4A", description: "" }],
      milestones: [], templates: [], files: [], project: null, fields: [], views: [],
      viewsSupported: undefined, repositoryId: "R_1",
      validation: {
        authenticatedAccount: "maintainer", configuredAccountType: "Organization",
        repository: "acme-org/widgets", repositoryId: "R_1", grantedScopes: ["repo"],
      },
    };
    const origin = "https://github.com/acme-org/widgets.git";
    const target = {
      repoDir: fs.realpathSync(context.repository), origin,
      normalizedOrigin: normalizeGitHubOrigin(origin), repository: "acme-org/widgets",
    };
    const config = normalizeConfig(JSON.parse(fs.readFileSync(context.configPath, "utf8")));
    assert.equal(plan.authorization.value, authorizationValue({ config, target, observed, plan: plan.plan }));
    assert.equal(fs.existsSync(path.join(context.repository, ".github")), false);
    assertNoRemoteWrites(context);
  });
});

test("fixed-template capture rejects missing sources and destination ancestor links", () => {
  withNativeContext(templates("replace"), (context) => {
    const file = path.join(assetRoot(context), "config.yml");
    fs.unlinkSync(file);
    assert.throws(
      () => captureFixedTemplates(templates("replace"), context.repository, assetRoot(context)),
      { code: "ENOENT" },
    );
    assert.equal(fs.existsSync(path.join(context.repository, ".github")), false);
  }, { copySkill: true });
  withNativeContext(templates("replace"), (context, run) => {
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
    assert.deepEqual(report.failures, [{
      message: "Template destination contains a symbolic link: " + TARGETS.config,
    }]);
    assert.deepEqual(fs.readdirSync(outside), []);
  });
});

test("native source symlinks fail closed", { skip: process.platform === "win32" }, () => {
  withNativeContext(templates("replace"), (context, run) => {
    const file = path.join(assetRoot(context), "config.yml");
    fs.unlinkSync(file);
    fs.symlinkSync(path.join(assetRoot(context), "bug_report.yml"), file);
    const result = run("plan");
    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    const report = JSON.parse(result.stdout);
    assert.equal(report.success, false);
    assert.deepEqual(report.completed, []);
    assert.deepEqual(report.skipped, []);
    assert.deepEqual(report.failures, [{
      message: "Template source is not a regular file: config.yml",
    }]);
    assert.equal(fs.existsSync(path.join(context.repository, ".github")), false);
  }, { copySkill: true });
});

test("early capture drift fails before the first mutation with reviewed authorization", () => {
  withNativeContext(templates("replace"), (context, run) => {
    const file = path.join(assetRoot(context), "config.yml");
    const changed = Buffer.concat([fs.readFileSync(file), Buffer.from("early drift")]);
    const plan = successfulPlan(run);
    installGhFixture(context.bin, {
      ...GH_REPLIES,
      "api user": {
        stdout: GH_REPLIES["api user"],
        write: { file, base64: changed.toString("base64") },
      },
    });
    const report = rejectedApply(run, plan.authorization.value,
      "Fixed template source or destination changed after authorization");
    assert.equal(report.authorization.authorized, true);
    assert.equal(fs.existsSync(path.join(context.repository, ".github")), false);
    assert.deepEqual(fs.readFileSync(file), changed);
    assertNoRemoteWrites(context);
  }, { copySkill: true });
});
