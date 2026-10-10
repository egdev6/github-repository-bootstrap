import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fixedTemplatePaths } from "../scripts/fixed-template-paths.mjs";
import { validationErrors } from "../scripts/lib.mjs";
import { preflightTemplateDestinations } from "../scripts/bootstrap.mjs";

const CONFIG = ".github/ISSUE_TEMPLATE/config.yml";
const BUG = ".github/ISSUE_TEMPLATE/bug_report.yml";
const FEATURE = ".github/ISSUE_TEMPLATE/feature_request.yml";
const PR = ".github/pull_request_template.md";
const ALL = [CONFIG, BUG, FEATURE, PR];
const base = { account: "acme-org", repository: "acme-org/widgets" };
const forms = [
  [],
  ["bug_report"],
  ["feature_request"],
  ["bug_report", "feature_request"],
  ["feature_request", "bug_report"],
];
const templates = (issueForms, pullRequest, mode = "ensure") => ({
  issueForms: [...issueForms],
  issueFormLabels: Object.fromEntries(issueForms.map((name) => [name, []])),
  pullRequest,
  mode,
});
const files = (destination) => ({
  [destination]: { source: "governance/source.txt", mode: "replace" },
});
const collisions = (config) => validationErrors(config)
  .filter((entry) => entry.path.startsWith("$.files.") &&
    /ownership collision/.test(entry.message))
  .map((entry) => entry.path);

test("fixed paths retain selection, order and fresh-array isolation", () => {
  for (const selected of forms) {
    for (const pullRequest of [false, true]) {
      const before = [...selected];
      const expected = [
        CONFIG,
        ...selected.map((name) => name === "bug_report" ? BUG : FEATURE),
        ...(pullRequest ? [PR] : []),
      ];
      const destinations = expected.slice(1, pullRequest ? -1 : undefined);
      const original = [...destinations];
      const result = fixedTemplatePaths(destinations, pullRequest);
      assert.deepEqual(result, expected);
      assert.deepEqual(selected, before);
      assert.deepEqual(destinations, original);
      result.push("unrelated");
      assert.deepEqual(fixedTemplatePaths(destinations, pullRequest), expected);
    }
  }
});

test("the shared paths agree with validator reservations in both modes", () => {
  for (const selected of forms) {
    for (const pullRequest of [false, true]) {
      for (const mode of ["ensure", "replace"]) {
        const config = { ...base, templates: templates(selected, pullRequest, mode) };
        assert.deepEqual(validationErrors(config), []);
        const destinations = selected.map((name) => name === "bug_report" ? BUG : FEATURE);
        const reserved = fixedTemplatePaths(destinations, pullRequest);
        for (const destination of ALL) {
          assert.deepEqual(
            collisions({ ...config, files: files(destination) }),
            reserved.includes(destination) ? [`$.files.${destination}`] : [],
          );
        }
        for (const destination of reserved) {
          for (const conflict of [destination.slice(0, destination.lastIndexOf("/")),
            `${destination}/child.txt`]) {
            assert.deepEqual(
              collisions({ ...config, files: files(conflict) }),
              [`$.files.${conflict}`],
            );
          }
        }
      }
    }
  }
});

test("omitted and malformed containers retain tolerant reservation behavior", () => {
  for (const value of [undefined, null, false, [], "invalid", 1]) {
    assert.deepEqual(collisions({ ...base, templates: value, files: files(CONFIG) }), []);
  }
  const malformed = { issueForms: ["unknown"], pullRequest: "yes" };
  for (const destination of [BUG, FEATURE, PR]) {
    assert.deepEqual(collisions({ ...base, templates: malformed, files: files(destination) }), []);
  }
  assert.deepEqual(
    collisions({ ...base, templates: malformed, files: files(CONFIG) }),
    [`$.files.${CONFIG}`],
  );
});

test("native preflight retains callbacks and unchecked-input failures", () => {
  // Read-only root: this test creates, changes and removes no fixture files.
  const root = fileURLToPath(new URL(".", import.meta.url));
  for (const selected of forms) {
    for (const pullRequest of [false, true]) {
      let calls = 0;
      assert.equal(preflightTemplateDestinations(
        { templates: templates(selected, pullRequest) }, root, () => ++calls,
      ), 1);
      assert.equal(calls, 1);
    }
  }
  for (const value of [undefined, null, false]) {
    let calls = 0;
    assert.equal(preflightTemplateDestinations(
      { templates: value }, root, () => ++calls,
    ), 1);
    assert.equal(calls, 1);
  }
  for (const value of [{}, [], { issueForms: null }, { issueForms: "invalid" }]) {
    let calls = 0;
    assert.throws(() => preflightTemplateDestinations(
      { templates: value }, root, () => ++calls,
    ), TypeError);
    assert.equal(calls, 0);
  }
  assert.deepEqual(fixedTemplatePaths([], "yes"), [CONFIG, PR]);
  assert.deepEqual(fixedTemplatePaths([BUG], false), [CONFIG, BUG]);
  assert.throws(() => fixedTemplatePaths(null, false), TypeError);
});
