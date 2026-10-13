import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as lib from "../scripts/lib.mjs";
import { validateCodeSafetyPolicy } from "../scripts/code-safety-renderer.mjs";

// Focused model/schema/plan contract for the optional Code safety module (T2a).
// The native installer owns rendering and file bytes (T1/T2b); this suite binds
// validation, normalization, collision reservation, plan shape and the exact
// authorization inputs from static repository evidence only.
const skillRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const DESTINATION = ".github/workflows/code-safety.yml";
const SOURCE_HASH = "1".repeat(64);
const RENDERED_HASH = "2".repeat(64);
const DESTINATION_HASH = "3".repeat(64);
const base = { account: "acme-org", repository: "acme-org/widgets" };
const policy = (overrides = {}) => ({
  schemaVersion: 1,
  maxTextBytes: 1048576,
  allowedSymlinks: [],
  allowedRootLifecycleHooks: [],
  bidiExceptions: [],
  ...overrides,
});
const descriptor = (overrides = {}) => ({
  source: "code-safety.yml",
  target: DESTINATION,
  sourceHash: SOURCE_HASH,
  renderedHash: RENDERED_HASH,
  destinationHash: DESTINATION_HASH,
  ...overrides,
});
const paths = (config) =>
  lib.validationErrors(config).map((error) => error.path);
const workflowActions = (config, observed) =>
  lib
    .buildPlan(lib.normalizeConfig(config), observed)
    .filter((entry) => entry.resource === "workflow")
    .map((entry) => [entry.target, entry.action]);

test("exports the lib-owned code safety destination constant", () => {
  assert.equal(lib.CODE_SAFETY_DESTINATION, DESTINATION);
});

test("omitted or false keeps code safety inactive and never observes or plans it", () => {
  for (const config of [base, { ...base, codeSafety: false }]) {
    assert.deepEqual(lib.validationErrors(config), []);
    assert.equal(lib.normalizeConfig(config).codeSafety, null);
    assert.deepEqual(
      workflowActions(config, { codeSafetyState: [descriptor()] }),
      [],
    );
  }
});

test("rejects a malformed active code safety selection", () => {
  assert.equal(
    paths({ ...base, codeSafety: {} }).includes("$.codeSafety.mode"),
    true,
  );
  assert.equal(
    paths({ ...base, codeSafety: { mode: "sync" } }).includes(
      "$.codeSafety.mode",
    ),
    true,
  );
  assert.equal(
    paths({ ...base, codeSafety: { mode: "ensure", extra: 1 } }).includes(
      "$.codeSafety.extra",
    ),
    true,
  );
  for (const value of [true, null, "ensure", 42, []])
    assert.equal(
      paths({ ...base, codeSafety: value }).includes("$.codeSafety"),
      true,
      String(value),
    );
});

test("validates the optional policy through the shared pure validator", () => {
  assert.deepEqual(
    lib.validationErrors({ ...base, codeSafety: { mode: "ensure", policy: policy() } }),
    [],
  );
  assert.deepEqual(
    lib.validationErrors({
      ...base,
      codeSafety: {
        mode: "replace",
        policy: policy({
          approvedBinaryImages: [
            { path: "assets/logo.PNG", sha256: "a".repeat(64) },
          ],
        }),
      },
    }),
    [],
  );
  for (const malformed of [
    policy({ schemaVersion: 2 }),
    policy({ maxTextBytes: -1 }),
    policy({ bidiExceptions: ["x"] }),
    policy({ approvedBinaryImages: [{ path: "/abs.png", sha256: "a".repeat(64) }] }),
  ])
    assert.equal(
      paths({ ...base, codeSafety: { mode: "ensure", policy: malformed } }).includes(
        "$.codeSafety.policy",
      ),
      true,
    );
});

test("active code safety reserves its destination against generic file collisions", () => {
  const collide = (destination, codeSafety) =>
    lib
      .validationErrors({
        ...base,
        codeSafety,
        files: {
          [destination]: { source: "governance/source.txt", mode: "replace" },
        },
      })
      .filter((error) => /ownership collision/.test(error.message))
      .map((error) => error.path);
  const active = { mode: "ensure" };
  for (const destination of [
    DESTINATION,
    ".github/workflows",
    `${DESTINATION}/nested.yml`,
  ])
    assert.deepEqual(collide(destination, active), [`$.files.${destination}`]);
  assert.deepEqual(collide(".github/workflows/ci.yml", active), []);
  assert.deepEqual(collide(DESTINATION, false), []);
  assert.deepEqual(collide(DESTINATION, undefined), []);
});

test("active code safety fails closed on incomplete observed coverage", () => {
  const active = lib.normalizeConfig({
    ...base,
    codeSafety: { mode: "ensure" },
  });
  const invalid = [
    {},
    { codeSafetyState: null },
    { codeSafetyState: [] },
    { codeSafetyState: {} },
    { codeSafetyState: "state" },
    { codeSafetyState: [null] },
    { codeSafetyState: [descriptor({ target: ".github/workflows/other.yml" })] },
    { codeSafetyState: [descriptor({ source: "other.yml" })] },
    { codeSafetyState: [descriptor({ sourceHash: "raw" })] },
    { codeSafetyState: [descriptor({ renderedHash: undefined })] },
    { codeSafetyState: [descriptor({ destinationHash: "not-hex" })] },
    { codeSafetyState: [descriptor({ destinationHash: undefined })] },
    { codeSafetyState: [descriptor(), descriptor()] },
  ];
  for (const observed of invalid)
    assert.throws(
      () => lib.buildPlan(active, observed),
      /code safety/i,
      JSON.stringify(observed),
    );
  assert.deepEqual(
    lib
      .buildPlan(active, { codeSafetyState: [descriptor()] })
      .map((entry) => [entry.resource, entry.target, entry.action]),
    [["workflow", DESTINATION, "skip"]],
  );
});

test("plans exactly one workflow resource for the descriptor state", () => {
  const active = { ...base, codeSafety: { mode: "ensure" } };
  assert.deepEqual(
    workflowActions(active, {
      codeSafetyState: [descriptor({ destinationHash: null })],
    }),
    [[DESTINATION, "create"]],
  );
  // ensure preserves an existing destination even when the bytes differ.
  assert.deepEqual(
    workflowActions(active, { codeSafetyState: [descriptor()] }),
    [[DESTINATION, "skip"]],
  );
  const replace = { ...base, codeSafety: { mode: "replace" } };
  assert.deepEqual(
    workflowActions(replace, {
      codeSafetyState: [descriptor({ destinationHash: RENDERED_HASH })],
    }),
    [[DESTINATION, "skip"]],
  );
  assert.deepEqual(
    workflowActions(replace, { codeSafetyState: [descriptor()] }),
    [[DESTINATION, "update"]],
  );
  assert.equal(
    lib
      .buildPlan(lib.normalizeConfig(replace), {
        codeSafetyState: [descriptor()],
      })
      .some((entry) => entry.action === "delete"),
    false,
  );
});

test("authorization binds the active policy and observed descriptor", () => {
  const target = {
    repoDir: "/work/widgets",
    origin: "git@github.com:acme-org/widgets.git",
    repository: base.repository,
  };
  const config = lib.normalizeConfig({
    ...base,
    codeSafety: { mode: "ensure", policy: policy() },
  });
  const observed = { codeSafetyState: [descriptor()] };
  const plan = lib.buildPlan(config, observed);
  const authorization = lib.authorizationValue({ config, target, observed, plan });
  assert.match(authorization, /^APPLY_GITHUB_PROJECT_BOOTSTRAP:[a-f0-9]{64}$/);
  const changedPolicy = lib.normalizeConfig({
    ...base,
    codeSafety: { mode: "ensure", policy: policy({ maxTextBytes: 1 }) },
  });
  assert.notEqual(
    lib.authorizationValue({ config: changedPolicy, target, observed, plan }),
    authorization,
  );
  assert.notEqual(
    lib.authorizationValue({
      config,
      target,
      observed: {
        codeSafetyState: [descriptor({ destinationHash: "9".repeat(64) })],
      },
      plan,
    }),
    authorization,
  );
  for (const overrides of [
    { sourceHash: "4".repeat(64) },
    { renderedHash: "5".repeat(64) },
  ])
    assert.notEqual(
      lib.authorizationValue({
        config,
        target,
        observed: { codeSafetyState: [descriptor(overrides)] },
        plan,
      }),
      authorization,
    );
});

test("schema image paths agree with the runtime validator", () => {
  const schema = JSON.parse(
    fs.readFileSync(
      path.join(skillRoot, "assets", "config.schema.json"),
      "utf8",
    ),
  );
  const patterns = schema.$defs.approvedBinaryImage.properties.path.allOf.map(
    (entry) => new RegExp(entry.pattern),
  );
  const acceptsInSchema = (value) =>
    patterns.every((pattern) => pattern.test(value));
  const acceptsAtRuntime = (value) => {
    try {
      validateCodeSafetyPolicy(
        policy({
          approvedBinaryImages: [{ path: value, sha256: "a".repeat(64) }],
        }),
      );
      return true;
    } catch {
      return false;
    }
  };
  for (const value of [
    "assets/logo.png",
    "assets/logo.PNG",
    ".config/logo.png",
    ".hidden.png",
    "b..png",
    "..png",
    "dir.with.dots/logo.png",
    ".png",
    "a/.png",
    "logo.exe",
    "/abs.png",
    "a\\b.png",
    "a:b.png",
    "../logo.png",
    "./logo.png",
    "a//b.png",
    "a/./b.png",
    "a/../b.png",
    "a/..",
    "a/.",
  ])
    assert.equal(acceptsInSchema(value), acceptsAtRuntime(value), value);
});

test("schema encodes the static code safety policy contract", () => {
  const schema = JSON.parse(
    fs.readFileSync(
      path.join(skillRoot, "assets", "config.schema.json"),
      "utf8",
    ),
  );
  assert.deepEqual(schema.properties.codeSafety, {
    $ref: "#/$defs/codeSafety",
  });
  assert.equal(schema.$defs.codeSafety.oneOf[0].const, false);
  assert.equal(schema.$defs.codeSafetyConfig.additionalProperties, false);
  assert.equal(schema.$defs.codeSafetyConfig.required.includes("mode"), true);
  const policySchema = schema.$defs.codeSafetyPolicy;
  assert.equal(policySchema.additionalProperties, false);
  assert.deepEqual(policySchema.required.slice().sort(), [
    "allowedRootLifecycleHooks",
    "allowedSymlinks",
    "bidiExceptions",
    "maxTextBytes",
    "schemaVersion",
  ]);
  assert.equal(policySchema.properties.schemaVersion.const, 1);
  assert.equal(policySchema.properties.maxTextBytes.type, "integer");
  assert.equal(policySchema.properties.maxTextBytes.minimum, 0);
  assert.equal(policySchema.properties.bidiExceptions.maxItems, 0);
  assert.equal(
    policySchema.properties.approvedBinaryImages.items.$ref,
    "#/$defs/approvedBinaryImage",
  );
  const image = schema.$defs.approvedBinaryImage;
  assert.equal(image.additionalProperties, false);
  assert.deepEqual(image.required.slice().sort(), ["path", "sha256"]);
  assert.equal(image.properties.sha256.pattern, "^[0-9a-f]{64}$");
  assert.equal(Array.isArray(image.properties.path.allOf), true);
  const example = JSON.parse(
    fs.readFileSync(
      path.join(skillRoot, "assets", "example.config.json"),
      "utf8",
    ),
  );
  assert.deepEqual(lib.validationErrors(example), []);
});
