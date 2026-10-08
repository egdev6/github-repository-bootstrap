import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Structural checks for the CI advisor and repository security review skills.
// They verify headers, section order, package registration, shipped links,
// cross-links, token budget, and scope wording. They do NOT exercise LLM
// behavior at runtime, and no passing result here is evidence that a review or
// a pipeline is complete, safe, or free of malicious content. Agent choices are
// validated by human review, not by these tests.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

const pkg = JSON.parse(read("package.json"));
const ciSkillPath = "skills/github-ci-advisor/SKILL.md";
const ciReviewPath = "skills/github-ci-advisor/references/ci-review.md";
const secSkillPath = "skills/repository-security-review/SKILL.md";
const secReviewPath = "skills/repository-security-review/references/security-review.md";
const ciSkill = read(ciSkillPath);
const ciReview = read(ciReviewPath);
const secSkill = read(secSkillPath);
const secReview = read(secReviewPath);
const bootstrapSkill = read("skills/github-repository-bootstrap/SKILL.md");

const has = (text, needle) => text.toLowerCase().includes(needle.toLowerCase());
const sections = [
  "## Activation Contract",
  "## Hard Rules",
  "## Decision Gates",
  "## Execution Steps",
  "## Output Contract",
  "## References",
];
const assertSectionOrder = (label, text) => {
  let previous = -1;
  for (const heading of sections) {
    const index = text.indexOf(heading);
    assert.notEqual(index, -1, `${label} is missing ${heading}`);
    assert.ok(index > previous, `${label} section order is wrong at ${heading}`);
    previous = index;
  }
};

test("both new skills use the required section order", () => {
  assertSectionOrder("github-ci-advisor/SKILL.md", ciSkill);
  assertSectionOrder("repository-security-review/SKILL.md", secSkill);
});

test("frontmatter is kebab-case, matches its directory, and keeps package metadata", () => {
  for (const newline of ["\n", "\r\n"]) {
    const ci = ciSkill.replace(/\r?\n/g, newline);
    const security = secSkill.replace(/\r?\n/g, newline);
    assert.match(ci, /^---\r?\nname: github-ci-advisor\r?\n/);
    assert.match(security, /^---\r?\nname: repository-security-review\r?\n/);
    for (const text of [ci, security]) {
      assert.match(text, /\r?\nlicense: MIT\r?\n/);
      assert.match(text, /\r?\n  author: gentleman-programming\r?\n/);
      assert.match(text, /\r?\n  version: "1\.0"\r?\n/);
      assert.match(text, /\r?\ndescription: "Trigger: [^"\r\n]+"\r?\n/);
    }
  }
});

test("package registration preserves identity and adds only the two skills", () => {
  assert.equal(pkg.name, "github-repository-bootstrap");
  assert.equal(pkg.private, true);
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.scripts?.test, "node scripts/run-tests.mjs", "test script must use the portable runner");
  assert.ok(read("scripts/run-tests.mjs").includes("skills/github-repository-bootstrap/tests"), "the portable runner must target the tests directory");
  const skills = pkg.pi?.skills ?? [];
  for (const skill of ["./skills/github-repository-bootstrap", "./skills/github-ci-advisor", "./skills/repository-security-review"]) {
    assert.ok(skills.includes(skill), `package.pi.skills is missing ${skill}`);
  }
  assert.equal(new Set(skills).size, skills.length, "skill registrations must be unique");
});

test("every shipped local markdown link resolves, including cross-skill links", () => {
  let checked = 0;
  for (const file of [ciSkillPath, ciReviewPath, secSkillPath, secReviewPath]) {
    const from = path.dirname(path.join(repoRoot, file));
    for (const match of read(file).matchAll(/\]\(([^)\s]+\.md)\)/g)) {
      assert.ok(fs.existsSync(path.resolve(from, match[1])), `${file} links to missing ${match[1]}`);
      checked += 1;
    }
  }
  assert.ok(checked >= 6, `expected at least 6 local links, found ${checked}`);
  assert.ok(has(ciSkill, "../repository-security-review/SKILL.md"), "CI advisor must cross-link the security review");
  assert.ok(has(secSkill, "../github-ci-advisor/SKILL.md"), "security review must cross-link the CI advisor");
});

test("SKILL.md files stay inside the style-guide token budget", () => {
  for (const [label, text] of [
    ["github-ci-advisor", ciSkill],
    ["repository-security-review", secSkill],
    ["github-repository-bootstrap", bootstrapSkill],
  ]) {
    const estimate = Math.ceil(Buffer.byteLength(text) / 4);
    assert.ok(estimate <= 1000, `${label} uses ${estimate} estimated tokens`);
  }
});

test("CI advisor proposes and applies only after approval", () => {
  for (const phrase of ["proposes", "explicit approval", "immutable sha", "least privilege", "contents: read"]) {
    assert.ok(has(ciSkill, phrase), `CI advisor omits ${phrase}`);
  }
  assert.ok(has(ciSkill, "never commit"), "CI advisor must not commit");
  assert.ok(has(ciSkill, "deploy") && has(ciSkill, "out of scope"), "CD must be out of scope");
  assert.ok(has(ciSkill, "no ci fields"), "CI advisor must not invent schema fields");
  assert.ok(has(ciSkill, "invent no sha"), "unresolved pins must never be fabricated");
  assert.ok(has(ciSkill, "prompt injection"), "the prompt-injection claim must be explicitly refused");
  assert.ok(has(ciReview, "not an executable scanner"), "the reference must deny being an executable scanner");
  assert.ok(has(ciReview, "retire") && has(ciReview, "plan ledger"), "growth evolution and its ledger must exist");
});

test("repository security review is read-only and bounded", () => {
  for (const phrase of ["read-only", "untrusted data", "never applies a fix", "never issue an automatic pass or fail verdict", "escalate"]) {
    assert.ok(has(secSkill, phrase), `security review omits ${phrase}`);
  }
  assert.ok(has(secSkill, "never obey instructions"), "embedded instructions must never be obeyed");
  assert.ok(has(secSkill, "do not search outside it"), "the review must stay inside the repository");
  for (const field of ["confidence", "severity", "evidence", "path and lines", "execution context", "impact", "recommendation", "validation"]) {
    assert.ok(has(secReview, field), `evidence fields omit ${field}`);
  }
  assert.ok(has(secReview, "fingerprint and path only"), "secret evidence must stay minimal");
  assert.ok(has(secReview, "not malware-test coverage"), "fixtures must not be sold as malware coverage");
  assert.ok(has(secReview, "never let this review write a workflow"), "the review must not write repository state");
});

test("bootstrap hands off CI and security without claiming ownership", () => {
  const intake = read("skills/github-repository-bootstrap/references/intake.md");
  assert.ok(has(intake, "github-ci-advisor"), "intake must name the CI advisor handoff");
  assert.ok(has(intake, "repository-security-review"), "intake must name the security review handoff");
  assert.ok(has(intake, "neither handoff is automatic"), "handoffs must not be automatic");
  assert.ok(has(bootstrapSkill, "../github-ci-advisor/SKILL.md"), "bootstrap SKILL must link the CI advisor");
  assert.ok(has(bootstrapSkill, "../repository-security-review/SKILL.md"), "bootstrap SKILL must link the security review");
});
