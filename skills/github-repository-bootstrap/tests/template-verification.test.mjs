import assert from "node:assert/strict";
import test from "node:test";
import { templateState, verifyTemplateRecords } from "../scripts/template-state.mjs";

const MESSAGE = "Fixed template source or destination changed after authorization";

function record(overrides = {}) {
  return {
    source: "workflow.yml",
    target: ".github/workflows/example.yml",
    sourceHash: "raw-source",
    renderedHash: "rendered-source",
    destinationHash: null,
    content: "name: reviewed\n",
    ...overrides,
  };
}

test("equal metadata returns the captured records by identity", () => {
  const records = [record()];
  const expected = templateState(records);
  const before = JSON.stringify({ records, expected });
  assert.equal(verifyTemplateRecords(records, expected, MESSAGE), records);
  assert.equal(records[0].content, "name: reviewed\n");
  assert.equal(JSON.stringify({ records, expected }), before);
});

test("every descriptor and byte-binding field participates in verification", () => {
  const changes = [
    ["source", "other.yml"],
    ["target", ".github/other.yml"],
    ["sourceHash", "different-raw-source"],
    ["renderedHash", "different-rendered-source"],
    ["destinationHash", "existing-destination"],
  ];
  for (const [key, value] of changes) {
    const records = [record()];
    const expected = templateState(records);
    const changed = [record({ [key]: value })];
    const before = JSON.stringify({ changed, expected });
    assert.throws(() => verifyTemplateRecords(changed, expected, MESSAGE),
      (error) => error instanceof Error && error.message === MESSAGE);
    assert.equal(JSON.stringify({ changed, expected }), before);
  }
});

test("destination appearance and disappearance are distinct bound states", () => {
  const absent = [record()];
  const present = [record({ destinationHash: "installed-bytes" })];
  assert.throws(() => verifyTemplateRecords(present, templateState(absent), MESSAGE),
    (error) => error.message === MESSAGE);
  assert.throws(() => verifyTemplateRecords(absent, templateState(present), MESSAGE),
    (error) => error.message === MESSAGE);
  assert.equal(verifyTemplateRecords(present, templateState(present), MESSAGE), present);
});

test("selection order and selection size cannot change after authorization", () => {
  const first = record();
  const second = record({ source: "second.yml", target: ".github/second.yml" });
  const expected = templateState([first, second]);
  for (const changed of [[second, first], [first], [first, second, record()]]) {
    assert.throws(() => verifyTemplateRecords(changed, expected, MESSAGE),
      (error) => error.message === MESSAGE);
  }
  const same = [first, second];
  assert.equal(verifyTemplateRecords(same, expected, MESSAGE), same);
});

test("content remains outside metadata, while renderedHash remains authoritative", () => {
  const records = [record()];
  const expected = templateState(records);
  const textOnly = [record({ content: "different decoded display\n" })];
  assert.equal(verifyTemplateRecords(textOnly, expected, MESSAGE), textOnly);
  const differentHash = [record({ renderedHash: "changed", content: records[0].content })];
  assert.throws(() => verifyTemplateRecords(differentHash, expected, MESSAGE),
    (error) => error.message === MESSAGE);
  assert.equal(Object.hasOwn(expected[0], "content"), false);
});

test("canonical object-key ordering does not change the authorization comparison", () => {
  const records = [record()];
  const expected = templateState(records).map((value) =>
    Object.fromEntries(Object.entries(value).reverse()));
  assert.equal(verifyTemplateRecords(records, expected, MESSAGE), records);
  assert.equal(expected[0].sourceHash, "raw-source");
});

test("additional descriptor metadata is retained rather than ignored", () => {
  const records = [record({ kind: "internal", mode: "ensure" })];
  const expected = templateState(records);
  assert.equal(verifyTemplateRecords(records, expected, MESSAGE), records);
  for (const changed of [
    [record({ kind: "other", mode: "ensure" })],
    [record({ kind: "internal", mode: "replace" })],
    [record({ kind: "internal" })],
  ]) {
    assert.throws(() => verifyTemplateRecords(changed, expected, MESSAGE),
      (error) => error.message === MESSAGE);
  }
});

test("absent legacy metadata still fails with the caller's exact error", () => {
  const records = [record()];
  assert.throws(() => verifyTemplateRecords(records, undefined, MESSAGE),
    (error) => error.message === MESSAGE);
  assert.equal(records[0].source, "workflow.yml");
});

test("empty captured selections require an empty authorized selection", () => {
  const records = [];
  assert.equal(verifyTemplateRecords(records, [], MESSAGE), records);
  assert.throws(() => verifyTemplateRecords(records, undefined, MESSAGE),
    (error) => error.message === MESSAGE);
  assert.throws(() => verifyTemplateRecords(records, templateState([record()]), MESSAGE),
    (error) => error.message === MESSAGE);
});

test("the trusted caller supplies its own error without changing the comparison", () => {
  const message = "Internal caller's authorization boundary changed";
  const records = [record({ sourceHash: "changed" })];
  assert.throws(() => verifyTemplateRecords(records, templateState([record()]), message),
    (error) => error.message === message);
});
