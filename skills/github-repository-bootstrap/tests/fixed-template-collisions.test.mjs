import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validationErrors } from "../scripts/lib.mjs";

const skillRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// The four fixed template destinations the current runtime can install.
const CONFIG_TEMPLATE = ".github/ISSUE_TEMPLATE/config.yml";
const BUG_TEMPLATE = ".github/ISSUE_TEMPLATE/bug_report.yml";
const FEATURE_TEMPLATE = ".github/ISSUE_TEMPLATE/feature_request.yml";
const PULL_REQUEST_TEMPLATE = ".github/pull_request_template.md";

const base = { account: "acme-org", repository: "acme-org/widgets" };

function templates(issueForms, pullRequest, mode = "ensure") {
  return {
    issueForms,
    issueFormLabels: Object.fromEntries(issueForms.map((name) => [name, []])),
    pullRequest,
    mode,
  };
}

function files(destinations, mode = "replace") {
  return Object.fromEntries(
    destinations.map((destination) => [
      destination,
      { source: "governance/source.txt", mode },
    ]),
  );
}

// Each fixed destination paired with the selection that reserves it.
function fixedCases() {
  return [
    [CONFIG_TEMPLATE, templates([], false)],
    [BUG_TEMPLATE, templates(["bug_report"], false)],
    [FEATURE_TEMPLATE, templates(["feature_request"], false)],
    [PULL_REQUEST_TEMPLATE, templates([], true)],
  ];
}

// The guard's own signal, isolated from every other validation error.
function collisionPaths(destination, templateConfig, fileMode = "replace") {
  return validationErrors({
    ...base,
    templates: templateConfig,
    files: files([destination], fileMode),
  })
    .filter(
      (error) =>
        error.path.startsWith("$.files.") &&
        /ownership collision/.test(error.message),
    )
    .map((error) => error.path);
}

test("rejects a files destination equal to every current fixed template path", () => {
  for (const [destination, templateConfig] of fixedCases()) {
    assert.deepEqual(
      collisionPaths(destination, templateConfig),
      [`$.files.${destination}`],
      destination,
    );
  }
});

test("rejects ancestor and descendant collisions for every fixed template path", () => {
  for (const [reserved, templateConfig] of fixedCases()) {
    for (const destination of [
      path.posix.dirname(reserved),
      `${reserved}/nested/file.txt`,
    ]) {
      assert.deepEqual(
        collisionPaths(destination, templateConfig),
        [`$.files.${destination}`],
        `${destination} vs ${reserved}`,
      );
    }
  }
});

test("reserves only the selected fixed template destinations", () => {
  const noFormsNoPullRequest = templates([], false);
  assert.deepEqual(collisionPaths(CONFIG_TEMPLATE, noFormsNoPullRequest), [
    `$.files.${CONFIG_TEMPLATE}`,
  ]);
  for (const destination of [
    BUG_TEMPLATE,
    FEATURE_TEMPLATE,
    PULL_REQUEST_TEMPLATE,
  ])
    assert.deepEqual(
      collisionPaths(destination, noFormsNoPullRequest),
      [],
      destination,
    );

  const bugOnly = templates(["bug_report"], false);
  assert.deepEqual(collisionPaths(BUG_TEMPLATE, bugOnly), [
    `$.files.${BUG_TEMPLATE}`,
  ]);
  for (const destination of [FEATURE_TEMPLATE, PULL_REQUEST_TEMPLATE])
    assert.deepEqual(collisionPaths(destination, bugOnly), [], destination);

  const featureOnly = templates(["feature_request"], false);
  assert.deepEqual(collisionPaths(FEATURE_TEMPLATE, featureOnly), [
    `$.files.${FEATURE_TEMPLATE}`,
  ]);
  assert.deepEqual(collisionPaths(BUG_TEMPLATE, featureOnly), []);

  assert.deepEqual(collisionPaths(PULL_REQUEST_TEMPLATE, templates([], true)), [
    `$.files.${PULL_REQUEST_TEMPLATE}`,
  ]);

  // Omitting `templates` reserves no fixed destination at all.
  assert.deepEqual(
    validationErrors({
      ...base,
      files: files([
        CONFIG_TEMPLATE,
        BUG_TEMPLATE,
        FEATURE_TEMPLATE,
        PULL_REQUEST_TEMPLATE,
      ]),
    }),
    [],
  );
});

test("rejects the collision for every file and template mode combination", () => {
  for (const fileMode of ["ensure", "replace"]) {
    for (const templateMode of ["ensure", "replace"]) {
      assert.deepEqual(
        collisionPaths(
          BUG_TEMPLATE,
          templates(["bug_report"], false, templateMode),
          fileMode,
        ),
        [`$.files.${BUG_TEMPLATE}`],
        `${fileMode}/${templateMode}`,
      );
    }
  }
});

test("does not reject prefix, source-only, or unselected destinations", () => {
  const templateConfig = templates(["bug_report", "feature_request"], true);
  const safeDestinations = [
    ".github/ISSUE_TEMPLATE/config.yml.bak",
    ".github/ISSUE_TEMPLATE/bug-report.yml",
    ".github/ISSUE_TEMPLATE2/config.yml",
    ".github/pull_request_template.md.bak",
    ".github/workflows/ci.yml",
  ];
  assert.deepEqual(
    validationErrors({
      ...base,
      templates: templateConfig,
      files: files(safeDestinations),
    }),
    [],
  );

  // Only the files destination is reserved; a source equal to a fixed
  // destination is not a collision.
  assert.deepEqual(
    validationErrors({
      ...base,
      templates: templateConfig,
      files: {
        ".github/legal.md": { source: CONFIG_TEMPLATE, mode: "replace" },
      },
    }),
    [],
  );

  // A fixed destination whose selection is disabled stays available.
  assert.deepEqual(
    collisionPaths(PULL_REQUEST_TEMPLATE, templates(["bug_report"], false)),
    [],
  );
});

test("malformed guard inputs keep returning validation errors without throwing", () => {
  const malformed = [
    {
      ...base,
      files: [".github/ISSUE_TEMPLATE/config.yml"],
      templates: templates([], false),
    },
    { ...base, files: files([CONFIG_TEMPLATE]), templates: ["bug_report"] },
    {
      ...base,
      files: files([CONFIG_TEMPLATE]),
      templates: { ...templates([], false), issueForms: "bug_report" },
    },
    {
      ...base,
      files: { [BUG_TEMPLATE]: null },
      templates: templates(["bug_report"], false),
    },
    {
      ...base,
      files: files([BUG_TEMPLATE]),
      templates: { ...templates([], false), pullRequest: "yes" },
    },
  ];
  const recorded = [];
  for (const config of malformed) {
    let errors;
    assert.doesNotThrow(() => {
      errors = validationErrors(config);
    });
    assert.equal(Array.isArray(errors), true);
    recorded.push(errors.map((error) => error.path));
  }
  assert.equal(recorded[0].includes("$.files"), true);
  assert.equal(recorded[1].includes("$.templates"), true);
  assert.equal(recorded[2].includes("$.templates.issueForms"), true);
  assert.equal(recorded[3].includes(`$.files.${BUG_TEMPLATE}`), true);
  assert.equal(recorded[4].includes("$.templates.pullRequest"), true);
});

test("still rejects future fields and keeps the shipped example valid", () => {
  const future = [
    [
      { ...base, branchProtection: { requiredApprovingReviewCount: 1 } },
      "$.branchProtection",
    ],
    [
      { ...base, templates: { ...templates([], false), issueWorkflow: {} } },
      "$.templates.issueWorkflow",
    ],
    [
      {
        ...base,
        project: { title: "Roadmap", fields: {}, views: {}, issueSync: {} },
      },
      "$.project.issueSync",
    ],
  ];
  for (const [config, expectedPath] of future) {
    const paths = validationErrors(config).map((error) => error.path);
    assert.equal(paths.includes(expectedPath), true, expectedPath);
    assert.deepEqual(
      validationErrors(config).filter((error) =>
        /ownership collision/.test(error.message),
      ),
      [],
      expectedPath,
    );
  }

  const example = JSON.parse(
    fs.readFileSync(
      path.join(skillRoot, "assets", "example.config.json"),
      "utf8",
    ),
  );
  assert.deepEqual(validationErrors(example), []);
});

test("host-aware folding and separators stay platform-exact", () => {
  const templateConfig = templates(["bug_report"], false);
  const folds = process.platform === "win32" || process.platform === "darwin";
  const separators = process.platform === "win32";
  const aliases = [
    [".github/ISSUE_TEMPLATE/BUG_REPORT.yml", folds],
    [".github\\ISSUE_TEMPLATE\\bug_report.yml", separators],
  ];
  for (const [alias, collides] of aliases)
    assert.deepEqual(
      collisionPaths(alias, templateConfig),
      collides ? [`$.files.${alias}`] : [],
      `${alias} on ${process.platform}`,
    );
});
