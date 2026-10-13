import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { normalizeConfig, validationErrors } from "../scripts/lib.mjs";

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

// Structural intake evidence, not proof of an agent's behavior or live CI.
test("new example manifests select scanner-only Code safety without approval bypass", () => {
  const example = JSON.parse(read("assets/example.config.json"));
  assert.deepEqual(validationErrors(example), []);
  assert.deepEqual(example.codeSafety, { mode: "ensure" });
  assert.equal(normalizeConfig(example).codeSafety.mode, "ensure");
  assert.equal(normalizeConfig(example).codeSafety.policy, undefined);
  const skill = read("SKILL.md");
  assert.match(skill, /New manifests propose `codeSafety:/);
  assert.match(skill, /honor opt-outs and legacy omission/);
  assert.match(skill, /exact SHA-256 authorization/);
});

test("the new default remains a proposal and legacy omission or opt-out stays inactive", () => {
  const example = JSON.parse(read("assets/example.config.json"));
  delete example.codeSafety;
  assert.deepEqual(validationErrors(example), []);
  assert.equal(normalizeConfig(example).codeSafety, null);
  example.codeSafety = false;
  assert.deepEqual(validationErrors(example), []);
  assert.equal(normalizeConfig(example).codeSafety, null);
  const guide = read("references/code-safety.md");
  for (const phrase of ["not a silent runtime default", "exact bootstrap plan", "Omitted or `false`", "does not uninstall"]) {
    assert.ok(guide.includes(phrase), `missing boundary: ${phrase}`);
  }
});

test("execution safety documents hash-bound native workflow ownership and target isolation", () => {
  const safety = read("references/execution-safety.md");
  assert.match(safety, /## Code Safety Workflow/);
  for (const phrase of ["codeSafety", "source", "rendered", "destination", "ensure", "replace", "before any mutation"]) {
    assert.ok(safety.includes(phrase), `missing execution boundary: ${phrase}`);
  }
  const guide = read("references/code-safety.md");
  assert.ok(guide.includes("176ae636fdd80ce60d6fffec188ce558c5f6692b"));
  assert.ok(guide.includes("No target package installs"));
  assert.ok(guide.includes("Findings are advisory"));
  assert.ok(guide.includes("default branch is not `main`"));
});
