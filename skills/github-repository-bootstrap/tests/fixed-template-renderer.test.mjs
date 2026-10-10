import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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

function withNativeContext(templateConfig, scenario) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bootstrap-fixed-template-renderer-"));
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
    fs.writeFileSync(configPath, JSON.stringify(config));
    installGhFixture(bin, GH_REPLIES);
    const context = { directory, repository, bin, configPath, logPath };
    return scenario(context, (mode, authorize) =>
      runBootstrapCli({
        skillRoot,
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
