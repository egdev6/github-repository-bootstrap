import assert from "node:assert/strict";
import test from "node:test";
import * as rendererModule from "../scripts/project-sync-renderer.mjs";
import { renderProjectIssueSyncWorkflow } from "../scripts/project-sync-renderer.mjs";

// Read-only behavioral contract for the pure project-sync renderer (U4b).
//
// It performs no file, environment, network, process, or secret-value I/O, never
// mutates its inputs, and materializes only the three known slots in a single
// pass over the original text. It does NOT parse YAML, execute an Actions
// workflow, or promise a sandbox. The templates below are owned by this test (a
// mini env block) and are deliberately NOT the future packaged asset.

const EOLS = ["\n", "\r\n"];
const template = (eol) =>
  [
    "env:",
    "  GH_TOKEN: ${{ secrets.__SECRET_NAME__ }}",
    "  PROJECT_OWNER: __PROJECT_OWNER__",
    "  PROJECT_TITLE_BASE64: __PROJECT_TITLE_BASE64__",
    "",
  ].join(eol);
const params = (overrides = {}) => ({
  owner: "acme-org",
  title: "Release board",
  secretName: "MY_PROJECT_TOKEN",
  ...overrides,
});
const decodeTitle = (rendered, eol) => {
  const line = rendered.split(eol).find((entry) => entry.includes("PROJECT_TITLE_BASE64:"));
  return Buffer.from(JSON.parse(line.slice(line.indexOf(":") + 1).trim()), "base64").toString("utf8");
};
const expressions = (rendered) => [...rendered.matchAll(/\$\{\{[^}]*\}\}/g)].map((match) => match[0]);

test("materializes owner, title, and secret as quoted, base64, and raw references", () => {
  for (const eol of EOLS) {
    const rendered = renderProjectIssueSyncWorkflow(template(eol), params());
    assert.equal(rendered.includes("__"), false);
    assert.match(rendered, /GH_TOKEN: \$\{\{ secrets\.MY_PROJECT_TOKEN \}\}/);
    assert.match(rendered, /PROJECT_OWNER: "acme-org"/);
    assert.deepEqual(expressions(rendered), ["${{ secrets.MY_PROJECT_TOKEN }}"]);
    assert.equal(decodeTitle(rendered, eol), "Release board");
  }
});

test("never turns a hostile title into a raw YAML value or Actions expression", () => {
  const title = '${{ secrets.GH_PROJECT_TOKEN }}\n"quoted" \\ slash';
  const rendered = renderProjectIssueSyncWorkflow(template("\n"), params({ title }));
  assert.equal(rendered.includes(title), false);
  assert.equal(rendered.includes("GH_PROJECT_TOKEN"), false);
  assert.deepEqual(expressions(rendered), ["${{ secrets.MY_PROJECT_TOKEN }}"]);
  assert.equal(decodeTitle(rendered, "\n"), title);
});

test("round-trips Unicode, whitespace, quotes, and line terminators without normalization", () => {
  for (const title of [
    "  padded  ",
    "\nleading\ntrailing\n",
    "emoji 🚀 and 😀",
    "e\u0301 composed vs \u00e9 precomposed",
    "line\u2028break",
    'quote " and \\ backslash',
    "tab\tand U+2029\u2029",
  ]) {
    assert.equal(decodeTitle(renderProjectIssueSyncWorkflow(template("\n"), params({ title })), "\n"), title, title);
  }
});

test("preserves template bytes, EOL style, and legitimate github context expressions", () => {
  for (const eol of EOLS) {
    const source = ["prefix", ...template(eol).split(eol), "echo ${{ github.repository }} ${{ github.actor }}", "suffix", ""].join(eol);
    const rendered = renderProjectIssueSyncWorkflow(source, params());
    assert.equal(rendered.startsWith(`prefix${eol}`), true);
    assert.equal(rendered.endsWith(`suffix${eol}`), true);
    assert.equal(rendered.includes("echo ${{ github.repository }} ${{ github.actor }}"), true);
    if (eol === "\r\n") assert.equal(/[^\r]\n/.test(rendered), false);
    else assert.equal(rendered.includes("\r"), false);
  }
});

test("does not mutate frozen parameters or the template and is stateless across calls", () => {
  const source = template("\n");
  const frozen = Object.freeze(params());
  const before = { ...frozen };
  assert.equal(renderProjectIssueSyncWorkflow(source, frozen), renderProjectIssueSyncWorkflow(source, frozen));
  assert.deepEqual(frozen, before);
  assert.equal(source, template("\n"));
});

test("replaces adjacent known slots exactly once each", () => {
  const source =
    "  GH_TOKEN: ${{ secrets.__SECRET_NAME__ }}\n  PROJECT_OWNER: __PROJECT_OWNER____PROJECT_TITLE_BASE64__\n";
  const rendered = renderProjectIssueSyncWorkflow(source, params());
  assert.equal(rendered.includes("__"), false);
  assert.match(rendered, /PROJECT_OWNER: "acme-org""[A-Za-z0-9+/=]+"/);
});

test("keeps a marker-looking secret name literal instead of re-substituting it", () => {
  for (const secretName of ["__SECRET_NAME__", "__PROJECT_OWNER__", "__PROJECT_TITLE_BASE64__"]) {
    const rendered = renderProjectIssueSyncWorkflow(template("\n"), params({ secretName }));
    assert.equal(rendered.includes(`GH_TOKEN: \${{ secrets.${secretName} }}`), true, secretName);
    assert.equal(decodeTitle(rendered, "\n"), "Release board");
  }
});

test("rejects a non-string template without string coercion", () => {
  for (const value of [undefined, null, 42, true, {}, ["x"], Buffer.from("x")]) {
    assert.throws(() => renderProjectIssueSyncWorkflow(value, params()), /template/);
  }
});

test("validates parameter shape, required own keys, and hidden known fields", () => {
  class Foreign {}
  Object.assign(Foreign.prototype, params());
  for (const value of [undefined, null, 42, "x", true, [], ["a"]]) {
    assert.throws(() => renderProjectIssueSyncWorkflow(template("\n"), value), /parameter/);
  }
  const hidden = [params(), Object.assign(Object.create(null), params())];
  for (const value of hidden) for (const key of ["owner", "title", "secretName"]) Object.defineProperty(value, key, { enumerable: false });
  for (const value of hidden) assert.equal(decodeTitle(renderProjectIssueSyncWorkflow(template("\n"), value), "\n"), "Release board");
  for (const [value, pattern] of [
    [{}, /missing.*own keys/],
    [{ title: "t" }, /missing.*own keys/],
    [{ owner: "acme" }, /missing.*own keys/],
    [{ owner: "acme", title: "t" }, /missing.*own keys/],
    [Object.create(params()), /parameter/],
    [Object.assign(new Date(), params()), /parameter/],
    [new Foreign(), /parameter/],
    [Object.defineProperty(params(), "token", { value: "ghp_fake" }), /unsupported/],
    [{ ...params(), [Symbol("token")]: "ghp_fake" }, /unsupported/],
  ]) {
    assert.throws(() => renderProjectIssueSyncWorkflow(template("\n"), value), pattern);
  }
});

test("rejects unknown or credential-shaped parameter keys", () => {
  for (const key of ["token", "secret", "secretValue"]) {
    assert.throws(() => renderProjectIssueSyncWorkflow(template("\n"), params({ [key]: "ghp_fake" })), /unsupported/);
  }
});

test("rejects a missing or duplicated required slot", () => {
  assert.throws(() => renderProjectIssueSyncWorkflow("GH_TOKEN: ${{ secrets.__SECRET_NAME__ }}\n", params()), /slot/);
  const duplicated = template("\n").replace("PROJECT_OWNER:", "PROJECT_OWNER: __PROJECT_OWNER__");
  assert.throws(() => renderProjectIssueSyncWorkflow(duplicated, params()), /slot/);
});

test("rejects an unknown uppercase slot marker before any replacement", () => {
  assert.throws(
    () => renderProjectIssueSyncWorkflow(`${template("\n")}  EXTRA: __UNKNOWN_SLOT__\n`, params()),
    /slot/,
  );
});

test("rejects invalid owner logins including injection and newline padding", () => {
  for (const owner of [
    "",
    " ",
    "bad owner",
    "acme.org",
    "acme/org",
    "${{ github.actor }}",
    "acme\n",
    "acme\r\nnext",
    "acme\u2028",
    "\u00e9acme",
    "a".repeat(40),
  ]) {
    assert.throws(() => renderProjectIssueSyncWorkflow(template("\n"), params({ owner })), /owner/, owner);
  }
  const longest = renderProjectIssueSyncWorkflow(template("\n"), params({ owner: "a".repeat(39) }));
  assert.equal(decodeTitle(longest, "\n"), "Release board");
});

test("rejects wrong-type, empty, oversized, or ill-formed-UTF16 titles", () => {
  const invalid = [42, true, {}, [], null, undefined, "", "x".repeat(256), "\ud800", "\udc00", "a\ud800b", "\ud83d", "x\udfff"];
  for (const title of invalid) {
    assert.throws(() => renderProjectIssueSyncWorkflow(template("\n"), params({ title })), /title/);
  }
  const boundary = renderProjectIssueSyncWorkflow(template("\n"), params({ title: "x".repeat(255) }));
  assert.equal(decodeTitle(boundary, "\n"), "x".repeat(255));
  assert.equal(decodeTitle(renderProjectIssueSyncWorkflow(template("\n"), params({ title: "😀" })), "\n"), "😀");
});

test("rejects invalid or reserved secret names, including terminal line terminators", () => {
  const invalid = [
    "",
    "1BAD",
    "has-dash",
    "has space",
    "GITHUB_TOKEN",
    "github_token",
    "GITHUB_PROJECT_TOKEN",
    "GITHUB_",
    "MY_TOKEN\n",
    "MY_TOKEN\r",
    "MY_TOKEN\u2028",
    "MY_TOKEN\u2029",
    "MY\u0000TOKEN",
    "MY\tTOKEN",
  ];
  for (const secretName of invalid) {
    assert.throws(
      () => renderProjectIssueSyncWorkflow(template("\n"), params({ secretName })),
      /secret name/,
      JSON.stringify(secretName),
    );
  }
  for (const secretName of ["MY_PROJECT_TOKEN_2", "_LEADING", "lower_case", "CONSTRUCTOR", "_1"]) {
    const rendered = renderProjectIssueSyncWorkflow(template("\n"), params({ secretName }));
    assert.equal(rendered.includes(`secrets.${secretName} }}`), true, secretName);
  }
});

test("exports exactly one pure renderer function", () => {
  assert.deepEqual(Object.keys(rendererModule).sort(), ["renderProjectIssueSyncWorkflow"]);
  assert.equal(typeof renderProjectIssueSyncWorkflow, "function");
  assert.equal(typeof renderProjectIssueSyncWorkflow(template("\n"), params()), "string");
});

test("keeps raw invalid parameter values out of error messages", () => {
  const sentinel = "SENTINEL_ONLY_VALUE_42";
  for (const overrides of [
    { owner: `bad ${sentinel}` },
    { title: `x${"\ud800"}${sentinel}` },
    { secretName: `${sentinel} bad` },
  ]) {
    let threw = false;
    try {
      renderProjectIssueSyncWorkflow(template("\n"), params(overrides));
    } catch (error) {
      threw = true;
      assert.equal(error.message.includes(sentinel), false);
    }
    assert.equal(threw, true, "expected a validation error");
  }
});
