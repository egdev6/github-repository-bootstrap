import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validationErrors } from "../scripts/lib.mjs";

// Structural checks for the guided-reconciliation documentation. They verify
// that the skill files stay readable, ordered, linked, and safety-scoped. They
// do NOT exercise LLM prompt behavior; prose quality and runtime agent choices
// are validated by review, not by these tests.
//
// Current-contract tests read only what the shipped schema and validator
// support. Planned-module tests are section-bound to the explicit
// "Planned Modules (Not Available In This Release)" marker and cross-check that
// the current schema and validationErrors still reject those fields, so a text
// assertion can never imply a backend capability.
const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(skillRoot, relative), "utf8");

const skill = read("SKILL.md");
const intake = read("references/intake.md");
const safety = read("references/execution-safety.md");

const has = (text, needle) => text.toLowerCase().includes(needle.toLowerCase());
const PLANNED_MARKER = "## Planned Modules (Not Available In This Release)";
const plannedIndex = (text) => text.indexOf(PLANNED_MARKER);
const currentPart = (text) => text.slice(0, plannedIndex(text));
const plannedPart = (text) => text.slice(plannedIndex(text));

test("[current] SKILL.md keeps the required section order", () => {
  const sections = [
    "## Activation Contract",
    "## Hard Rules",
    "## Decision Gates",
    "## Execution Steps",
    "## Output Contract",
    "## References",
  ].map((heading) => {
    const index = skill.indexOf(heading);
    assert.notEqual(index, -1, `missing section ${heading}`);
    return index;
  });
  for (let i = 1; i < sections.length; i += 1) {
    assert.ok(sections[i] > sections[i - 1], "sections are out of order");
  }
});

test("[current] SKILL.md links to shipped references that exist", () => {
  const links = [...skill.matchAll(/\]\((references\/[^)]+\.md)\)/g)].map((match) => match[1]);
  assert.ok(links.includes("references/intake.md"), "intake reference is not linked");
  assert.ok(links.includes("references/execution-safety.md"), "execution safety is not linked");
  for (const link of new Set(links)) {
    assert.ok(fs.existsSync(path.join(skillRoot, link)), `linked reference ${link} does not exist`);
  }
});

test("[current] SKILL.md stays under the style-guide hard token budget", () => {
  // The guide hard-caps SKILL.md at 1000 tokens. A bytes/4 estimate is a
  // deliberately conservative proxy for tokens, not a real tokenizer. The raw
  // bytes are measured unnormalized so a CRLF file cannot hide extra bytes.
  assert.ok(
    Math.ceil(Buffer.byteLength(skill) / 4) <= 1000,
    "SKILL.md exceeds 1000 estimated tokens",
  );
});

test("[current] SKILL.md preserves identity and reconciliation trigger words", () => {
  // Anchor metadata on \r?\n so both LF and CRLF frontmatter stay valid.
  assert.match(skill, /^---\r?\nname: github-repository-bootstrap\r?\n/);
  assert.match(skill, /\r?\nlicense: MIT\r?\n/);
  assert.match(skill, /\r?\ndescription: "Trigger: GitHub repository bootstrap/);
  for (const word of ["reconcil", "read-only", "Decision Gates", "execution-safety"]) {
    assert.ok(has(skill, word), `SKILL.md omits ${word}`);
  }
});

test("[current] intake inventories activated modules and classifications", () => {
  const current = currentPart(intake);
  for (const module of ["labels", "milestones", "files", "templates", "projects v2"]) {
    assert.ok(has(current, module), `intake omits activated module ${module}`);
  }
  for (const state of ["matching", "missing", "different", "partially applied", "unknown"]) {
    assert.ok(has(current, state), `intake omits classification ${state}`);
  }
  assert.ok(has(current, "disabled modules trigger no module-specific api calls"), "disabled modules must skip module-specific discovery");
  // The future modules are named only under the planned boundary.
  const planned = plannedPart(intake);
  assert.notEqual(plannedIndex(intake), -1, "intake must mark its planned-module boundary");
  for (const module of ["issue lifecycle", "branch protection", "project issue sync"]) {
    assert.ok(has(planned, module), `planned boundary omits ${module}`);
  }
});

test("[current] intake keeps the closed per-module choices and the decision ledger", () => {
  for (const choice of ["`apply`", "`adapt`", "`leave`"]) {
    assert.ok(intake.includes(choice), `intake omits choice ${choice}`);
  }
  for (const field of ["module", "state", "source", "proposed diff", "user decision", "revised manifest"]) {
    assert.ok(has(intake, field), `ledger omits ${field}`);
  }
  assert.ok(has(intake, "without new schema fields") || has(intake, "not as new config fields"), "ledger must stay out of the schema");
  assert.ok(has(intake, "regenerate the final plan"), "decisions must regenerate the plan");
  assert.ok(has(intake, "not permission"), "a plan value must not be treated as permission");
  assert.ok(has(intake, "managed: false") && has(intake, "does not disable"), "managed: false must not disable a module");
});

test("[current] execution safety scopes the no-recolor rule and keeps hard prohibitions", () => {
  // Regression guard: the old blanket "never recolor" contradicted an approved
  // managed apply. Recolor is forbidden outside an explicit managed apply.
  assert.equal(has(safety, "never delete, relabel, recolor, or rename"), false, "blanket recolor prohibition must be gone");
  assert.ok(has(safety, "read-only reconciliation, `adapt`, and `leave` never recolor"), "no-recolor must be scoped to read-only/adapt/leave");
  assert.ok(has(safety, "managed: true") && has(safety, "color or description"), "approved managed apply may update label color/description");
  assert.ok(has(safety, "renames and assignment migration stay forbidden"), "renames and assignment migration remain forbidden");
});

test("[planned] execution safety allows only an approved branch-protection weakening diff", () => {
  // Section-bound: the policy lives under the planned marker, and the current
  // guide never claims the capability.
  const planned = plannedPart(safety);
  assert.notEqual(plannedIndex(safety), -1, "execution safety must mark its planned-module boundary");
  assert.ok(has(planned, "under `adapt` or `leave`, preserve stronger"), "adapt/leave preserve stronger protection");
  assert.ok(has(planned, "only the two managed branch-protection fields may change"), "apply is limited to the two managed fields");
  assert.ok(has(planned, "requiredApprovingReviewCount") && has(planned, "weakening"), "the weakening diff must be shown");
  assert.ok(has(planned, "explicitly approved"), "weakening needs explicit approval");
  assert.ok(has(planned, "no other protection flag may change"), "no other protection flag may change");
  assert.ok(has(planned, "every administrator can bypass"), "admin bypass is never claimed as a single owner");
  assert.equal(has(currentPart(safety), "requiredApprovingReviewCount"), false, "branch protection must not be claimed as current");
});

test("[planned] execution safety separates local capability checks from the runtime secret", () => {
  const planned = plannedPart(safety);
  assert.ok(has(planned, "operator's `gh` token"), "local checks use the operator token");
  assert.ok(has(planned, "verified only at runtime"), "the stored credential is verified only at runtime");
  assert.ok(has(planned, "no command reads a secret value"), "no command reads a real secret value");
  assert.equal(has(currentPart(safety), "verified only at runtime"), false, "the runtime-secret split is not a current module");
});

test("[current] execution safety keeps the reconciliation boundaries and schema stance", () => {
  assert.ok(has(currentPart(safety), "unknown permissions stop"), "unknown permissions stop that module");
  assert.ok(has(currentPart(safety), "duplicate linked projects fail"), "duplicate projects fail for manual resolution");
  assert.ok(has(safety, "schema fields, selection flags, or approval flags"), "safety must not invent schema or approval flags");
});

test("[current] intake covers the label dependency chain and the planned branch-protection leave", () => {
  assert.ok(has(intake, "templates.issueFormLabels"), "label dependencies include issue-form label mappings");
  assert.ok(has(intake, "retained and preserved"), "existing labels are retained, not created");
  assert.ok(has(intake, "never add a missing label"), "missing labels are never added to satisfy validation");
  assert.ok(has(intake, "relabel existing issues"), "existing issues are never relabeled");
  assert.ok(has(intake, "disable or remove the dependents") && has(intake, "stop the run"), "leave offers reviewed disable/stop options");
  assert.ok(has(intake, "silent opt-out"), "dependencies are recorded; no silent opt-out");
  // branch protection leave is planned-only, never a current selector.
  assert.ok(has(plannedPart(intake), "branchProtection"), "planned leave must name branchProtection");
  assert.equal(has(currentPart(intake), "branchProtection"), false, "branch protection is not a current module");
});

test("[current] future module fields stay rejected by the schema and validator", () => {
  const schema = read("assets/config.schema.json");
  const minimal = { account: "fixture", repository: "fixture/repo" };
  assert.deepEqual(validationErrors(minimal), [], "the minimal current fixture must validate");
  // Triangulate the positive path: a realistic current manifest still validates.
  assert.deepEqual(
    validationErrors({
      ...minimal,
      labels: { "status:needs-review": { color: "ededed", managed: false } },
      files: { ".github/notes.md": { source: "docs/notes.md", mode: "ensure" } },
    }),
    [],
    "a current labels+files manifest must validate",
  );
  const rejects = (config, expectedPath) => {
    const errors = validationErrors(config);
    assert.ok(
      errors.some((error) => error.path === expectedPath),
      `expected rejection at ${expectedPath}, got ${JSON.stringify(errors)}`,
    );
  };
  rejects({ ...minimal, branchProtection: {} }, "$.branchProtection");
  rejects({ ...minimal, templates: { issueWorkflow: true } }, "$.templates.issueWorkflow");
  rejects({ ...minimal, project: { title: "fixture", issueSync: {} } }, "$.project.issueSync");
  for (const field of ["branchProtection", "issueWorkflow", "issueSync"]) {
    assert.equal(schema.includes(field), false, `schema must not declare ${field}`);
  }
  // The guide names each planned field under the boundary, keeping doc and code aligned.
  for (const field of ["branchProtection", "templates.issueWorkflow", "project.issueSync"]) {
    assert.ok(has(plannedPart(safety), field), `planned section omits ${field}`);
  }
});
