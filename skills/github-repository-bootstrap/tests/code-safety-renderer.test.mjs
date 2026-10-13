import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as rendererModule from "../scripts/code-safety-renderer.mjs";
import { renderCodeSafetyWorkflow, validateCodeSafetyPolicy } from "../scripts/code-safety-renderer.mjs";

// Focused, read-only contract for the pure code-safety workflow renderer and its
// policy model. It reads the packaged asset, writes nothing, reads no environment
// or network, executes no workflow, and makes no claim that a rendered file is a
// functional GitHub Action until a real run proves it.
const TEMPLATE = fs.readFileSync(
  fileURLToPath(new URL("../assets/templates/code-safety.yml", import.meta.url)),
  "utf8",
);
const SLOT = "__REPOSITORY_POLICY_BASE64__";
const UNKNOWN = /__[A-Z0-9_]+__/;
const policy = (overrides = {}) => ({
  schemaVersion: 1,
  maxTextBytes: 1048576,
  allowedSymlinks: [],
  allowedRootLifecycleHooks: [],
  bidiExceptions: [],
  ...overrides,
});
const envValue = (rendered) => {
  const line = rendered.split(/\r?\n/).find((entry) => /^\s*REPOSITORY_POLICY_BASE64:\s/.test(entry));
  return JSON.parse(line.slice(line.indexOf(":") + 1).trim());
};
const decodePolicy = (rendered) =>
  JSON.parse(Buffer.from(envValue(rendered), "base64").toString("utf8"));

test("exports exactly the pure renderer and the policy validator", () => {
  assert.deepEqual(Object.keys(rendererModule).sort(), [
    "renderCodeSafetyWorkflow",
    "validateCodeSafetyPolicy",
  ]);
  assert.equal(typeof renderCodeSafetyWorkflow(TEMPLATE), "string");
  assert.equal(typeof validateCodeSafetyPolicy, "function");
});

test("the packaged asset carries exactly one strict slot and no unknown marker", () => {
  assert.equal(TEMPLATE.split(SLOT).length - 1, 1);
  assert.equal(UNKNOWN.test(TEMPLATE.replace(SLOT, "")), false);
  assert.match(TEMPLATE, /REPOSITORY_POLICY_BASE64: "__REPOSITORY_POLICY_BASE64__"/);
});

test("the default render is scanner-only with an inert, empty policy slot", () => {
  const rendered = renderCodeSafetyWorkflow(TEMPLATE);
  assert.equal(rendered.includes(SLOT), false);
  assert.equal(rendered.includes("__"), false);
  assert.equal(envValue(rendered), "");
  assert.match(rendered, /if: env\.REPOSITORY_POLICY_BASE64 != ''/);
  // No donor image exceptions and no objective policy are baked into the asset.
  assert.equal(rendered.includes("trusted/.github/security/policy.json"), false);
  assert.equal(rendered.includes("src-tauri/icons"), false);
});

test("renders a reviewed policy as base64 that round-trips across LF and CRLF", () => {
  for (const eol of ["\n", "\r\n"]) {
    const source = TEMPLATE.replace(/\r?\n/g, eol);
    const reviewed = policy({ allowedSymlinks: ['"quoted"', "a\u2028b"] });
    const rendered = renderCodeSafetyWorkflow(source, reviewed);
    assert.equal(rendered.includes(SLOT), false);
    assert.deepEqual(decodePolicy(rendered), reviewed);
    assert.match(rendered, /node trusted\/scripts\/security\/check-repository\.mjs/);
    if (eol === "\r\n") assert.equal(/[^\r]\n/.test(rendered), false);
    else assert.equal(rendered.includes("\r"), false);
  }
});

test("rejects non-strings, zero, duplicate, and unknown slots", () => {
  for (const raw of [undefined, null, 42, true, {}, ["x"], Buffer.from("x")]) {
    assert.throws(() => renderCodeSafetyWorkflow(raw), /template/);
  }
  assert.throws(() => renderCodeSafetyWorkflow(TEMPLATE.replace(SLOT, "")), /slot/);
  assert.throws(() => renderCodeSafetyWorkflow(`${TEMPLATE}\n# ${SLOT}\n`), /slot/);
  assert.throws(() => renderCodeSafetyWorkflow(`${TEMPLATE}\n# __OTHER_SLOT__\n`), /slot/);
});

test("validates a complete plain policy and returns it unchanged", () => {
  const valid = policy({
    approvedBinaryImages: [{ path: "assets/logo.png", sha256: "a".repeat(64) }],
  });
  assert.equal(validateCodeSafetyPolicy(valid), valid);
});

test("rejects malformed policies without echoing caller values", () => {
  const sha = "a".repeat(64);
  const cases = [
    undefined,
    null,
    42,
    "x",
    [],
    new Date(),
    Object.create({}),
    policy({ schemaVersion: 2 }),
    policy({ maxTextBytes: -1 }),
    policy({ maxTextBytes: 1.5 }),
    policy({ allowedSymlinks: "x" }),
    policy({ allowedRootLifecycleHooks: [1] }),
    policy({ bidiExceptions: ["\u202e"] }),
    policy({ approvedBinaryImages: {} }),
    policy({ approvedBinaryImages: [{ path: "assets/logo.png" }] }),
    policy({ approvedBinaryImages: [{ path: "/abs.png", sha256: sha }] }),
    policy({ approvedBinaryImages: [{ path: "a\\b.png", sha256: sha }] }),
    policy({ approvedBinaryImages: [{ path: "../logo.png", sha256: sha }] }),
    policy({ approvedBinaryImages: [{ path: "logo.exe", sha256: sha }] }),
    policy({ approvedBinaryImages: [{ path: ".png", sha256: sha }] }),
    policy({ approvedBinaryImages: [{ path: "logo.png", sha256: "ZZ" }] }),
    policy({
      approvedBinaryImages: [
        { path: "logo.png", sha256: sha },
        { path: "logo.png", sha256: sha },
      ],
    }),
    { ...policy(), extra: 1 },
    { ...policy(), SENTINEL: "caller-value" },
  ];
  for (const value of cases) {
    assert.throws(() => validateCodeSafetyPolicy(value), /policy/, String(value));
  }
});

test("rejects accessors, symbol keys, hidden keys, and prototype keys", () => {
  const accessor = { ...policy() };
  Object.defineProperty(accessor, "schemaVersion", { get: () => 1, enumerable: true });
  const symbol = policy();
  symbol[Symbol("token")] = "ghp_fake";
  const hidden = policy();
  Object.defineProperty(hidden, "hidden", { value: 1 });
  const proto = policy();
  Object.defineProperty(proto, "__proto__", { value: 1, enumerable: true });
  for (const value of [accessor, symbol, hidden, proto]) {
    assert.throws(() => validateCodeSafetyPolicy(value), /policy/);
  }
});

test("rejects a non-object policy passed to the renderer", () => {
  assert.throws(() => renderCodeSafetyWorkflow(TEMPLATE, null), /policy/);
  assert.throws(() => renderCodeSafetyWorkflow(TEMPLATE, { schemaVersion: 1 }), /policy/);
});

test("encodes hostile policy text as inert base64 and never emits it raw", () => {
  const hostile = '${{ secrets.GH_TOKEN }}\n"quoted" \\ slash';
  const rendered = renderCodeSafetyWorkflow(TEMPLATE, policy({ allowedSymlinks: [hostile] }));
  assert.equal(rendered.includes("GH_TOKEN"), false);
  assert.equal(rendered.includes(hostile), false);
  assert.deepEqual(decodePolicy(rendered).allowedSymlinks, [hostile]);
});

test("the rendered workflow keeps the reviewed safety invariants", () => {
  for (const eol of ["\n", "\r\n"]) {
    const rendered = renderCodeSafetyWorkflow(TEMPLATE.replace(/\r?\n/g, eol), policy());
    for (const needle of [
      "repository: egdev6/quorb",
      "176ae636fdd80ce60d6fffec188ce558c5f6692b",
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      "actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1",
      "python@sha256:2ed6491b93cd49272ee6de2b5a38440c3448360322c089fc23e370722d74179d",
      "persist-credentials: false",
      "submodules: false",
      "lfs: false",
      "permissions:\n  contents: read",
      "timeout-minutes: 20",
      "runs-on: ubuntu-24.04",
      "if: always()",
      "test \"$(git -C target rev-parse HEAD)\" = \"$TARGET_COMMIT\"",
    ]) {
      assert.equal(rendered.includes(needle.replace(/\n/g, eol)), true, needle);
    }
    for (const forbidden of [
      /secrets\./,
      /pull_request_target/,
      /github\.event\.pull_request/,
      /\bcache:/,
      /\bnpm (ci|install|run)\b/,
      /\bpip install\b/,
    ]) {
      assert.equal(forbidden.test(rendered), false, String(forbidden));
    }
  }
});

test("the renderer module stays pure, inert, and donor-free", () => {
  const source = fs.readFileSync(
    fileURLToPath(new URL("../scripts/code-safety-renderer.mjs", import.meta.url)),
    "utf8",
  );
  assert.equal(/\bfrom\s+["']node:(fs|child_process|http|https|net|os)["']/.test(source), false);
  assert.equal(/\bfetch\s*\(/.test(source), false);
  assert.equal(/process\.env/.test(source), false);
  assert.equal(/quorb/i.test(source), false);
});

test("does not mutate frozen policy data and is stateless across calls", () => {
  const value = Object.freeze(
    policy({
      approvedBinaryImages: Object.freeze([
        Object.freeze({ path: "assets/logo.png", sha256: "a".repeat(64) }),
      ]),
    }),
  );
  const before = JSON.stringify(value);
  assert.equal(validateCodeSafetyPolicy(value), value);
  assert.deepEqual(value, JSON.parse(before));
  assert.equal(
    renderCodeSafetyWorkflow(TEMPLATE, value),
    renderCodeSafetyWorkflow(TEMPLATE, value),
  );
});
