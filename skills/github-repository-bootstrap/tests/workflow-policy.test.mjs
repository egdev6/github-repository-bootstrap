import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Structural policy guard for .github/workflows/release.yml: `uses:` values are
// bound to their owning step, so a wrong-step `with:` or a renamed step cannot
// satisfy a checkout rule. Fixed-layout 2/4/6/8-space extractor, not a YAML parser.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const WORKFLOW = path.join(repoRoot, ".github/workflows/release.yml");

const CHECKOUT_SHA = "11d5960a326750d5838078e36cf38b85af677262";
const SETUP_NODE_SHA = "49933ea5288caeca8642d1e84afbd3f7d6820020";
const CHECKOUT_REF = `actions/checkout@${CHECKOUT_SHA}`;
const SETUP_NODE_REF = `actions/setup-node@${SETUP_NODE_SHA}`;

// Vendor pins. On update, re-verify the new tag/SHA on the official action
// release page; do not only edit this map.
const PINS = {
  "actions/checkout": { sha: CHECKOUT_SHA, tag: "v4.4.0" },
  "actions/setup-node": { sha: SETUP_NODE_SHA, tag: "v4.4.0" },
};

const indent = (line) => /^( *)/.exec(line)[1].length;

function blockEnd(lines, start) {
  const base = indent(lines[start]);
  let i = start + 1;
  for (; i < lines.length; i += 1) {
    if (lines[i].trim() === "") continue;
    if (indent(lines[i]) <= base) break;
  }
  return i;
}

function allJobs(text) {
  const lines = text.split(/\r?\n/);
  const jobsAt = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  assert.ok(jobsAt >= 0, "workflow must declare jobs at column 0");
  const jobs = [];
  for (let i = jobsAt + 1; i < lines.length; ) {
    if (lines[i].trim() === "") {
      i += 1;
      continue;
    }
    const end = blockEnd(lines, i);
    const match = /^  ([A-Za-z0-9_-]+):\s*$/.exec(lines[i]);
    if (match) jobs.push({ id: match[1], lines: lines.slice(i, end) });
    i = end;
  }
  return jobs;
}

function job(text, id) {
  const found = allJobs(text).find((entry) => entry.id === id);
  assert.ok(found, `job ${id} must exist`);
  return found.lines;
}

function stepsOf(jobLines) {
  const stepsAt = jobLines.findIndex((line) => /^\s*steps:\s*$/.test(line));
  if (stepsAt < 0) return [];
  const stepsIndent = indent(jobLines[stepsAt]);
  const itemIndent = stepsIndent + 2;
  const steps = [];
  for (let i = stepsAt + 1; i < jobLines.length; ) {
    const line = jobLines[i];
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    if (indent(line) === itemIndent && /^\s*-\s/.test(line)) {
      const end = blockEnd(jobLines, i);
      steps.push(jobLines.slice(i, end));
      i = end;
    } else if (indent(line) <= stepsIndent) {
      break;
    } else {
      i += 1;
    }
  }
  return steps;
}

function stepField(step, key) {
  const keyIndent = indent(step[0]) + 2;
  const pattern = new RegExp(`^ {${keyIndent}}${key}:\\s*(.*)$`);
  for (const line of step) {
    const match = pattern.exec(line);
    if (match) return match[1].trim();
  }
  return undefined;
}

function withEntries(step) {
  const keyIndent = indent(step[0]) + 2;
  const withAt = step.findIndex((line) => new RegExp(`^ {${keyIndent}}with:\\s*$`).test(line));
  if (withAt < 0) return {};
  const entries = {};
  for (let i = withAt + 1; i < step.length; i += 1) {
    const line = step[i];
    if (line.trim() === "") continue;
    if (indent(line) <= keyIndent) break;
    const match = new RegExp(`^ {${keyIndent + 2}}([A-Za-z0-9_-]+):\\s*(.*)$`).exec(line);
    if (match) entries[match[1]] = match[2].trim();
  }
  return entries;
}

function parseUses(step) {
  const uses = stepField(step, "uses");
  if (uses === undefined) return undefined;
  const [refPart, ...commentParts] = uses.split("#");
  return { ref: refPart.trim(), comment: commentParts.join("#").trim() };
}

function stepsForAction(text, jobId, action) {
  return stepsOf(job(text, jobId)).filter((step) => {
    const parsed = parseUses(step);
    return parsed !== undefined && parsed.ref.split("@")[0] === action;
  });
}

// Both required actions must exist exactly once per job, and every `uses:` must
// be a known vendor pinned to the expected commit with a provenance comment.
function pinProblems(text) {
  const problems = [];
  for (const jobId of ["test", "release"]) {
    for (const action of ["actions/checkout", "actions/setup-node"]) {
      const found = stepsForAction(text, jobId, action).length;
      if (found !== 1) problems.push(`${jobId}: expected exactly one ${action} step, found ${found}`);
    }
  }
  for (const entry of allJobs(text)) {
    for (const step of stepsOf(entry.lines)) {
      const parsed = parseUses(step);
      if (parsed === undefined) continue;
      const match = /^([^@\s]+)@([0-9a-f]{40})$/.exec(parsed.ref);
      if (!match) {
        problems.push(`${entry.id}: unpinned or malformed action ref "${parsed.ref}"`);
        continue;
      }
      const expected = PINS[match[1]];
      if (!expected) {
        problems.push(`${entry.id}: unknown action ${match[1]}`);
        continue;
      }
      if (expected.sha !== match[2]) {
        problems.push(`${entry.id}: ${match[1]} pinned to an unexpected commit`);
        continue;
      }
      if (!parsed.comment.includes(expected.tag)) problems.push(`${entry.id}: ${match[1]} lacks a ${expected.tag} provenance comment`);
    }
  }
  return problems;
}

// The test job selects the real actions/checkout vendor exactly once and must
// disable credential persistence on that step.
function testCheckoutProblems(text) {
  const steps = stepsForAction(text, "test", "actions/checkout");
  if (steps.length !== 1) return [`test job must contain exactly one actions/checkout step, found ${steps.length}`];
  const credentials = withEntries(steps[0])["persist-credentials"];
  return credentials === "false" ? [] : [`test checkout persist-credentials is "${credentials ?? "unset"}"`];
}

// The release job keeps credential persistence (the existing push job needs
// tags) and a full-history checkout.
function releaseCheckoutProblems(text) {
  const steps = stepsForAction(text, "release", "actions/checkout");
  if (steps.length !== 1) return [`release job must contain exactly one actions/checkout step, found ${steps.length}`];
  const entries = withEntries(steps[0]);
  const problems = [];
  if (entries["persist-credentials"] === "false") problems.push("release checkout must keep credential persistence");
  if (entries["fetch-depth"] !== "0") problems.push("release checkout must fetch full history");
  return problems;
}

// Both jobs select the real actions/setup-node vendor exactly once and use Node 20.
function nodeProblems(text) {
  const problems = [];
  for (const jobId of ["test", "release"]) {
    const steps = stepsForAction(text, jobId, "actions/setup-node");
    if (steps.length !== 1) {
      problems.push(`${jobId} job must contain exactly one actions/setup-node step, found ${steps.length}`);
      continue;
    }
    if (withEntries(steps[0])["node-version"] !== "20") problems.push(`${jobId} setup-node must use Node 20`);
  }
  return problems;
}

function shapeProblems(text) {
  const problems = [];
  const testJob = job(text, "test");
  const testJobIndent = indent(testJob[0]);
  if (testJob.some((line) => line.trim().startsWith("permissions:") && indent(line) === testJobIndent + 2)) {
    problems.push("test job must not override permissions");
  }
  const matrix = testJob.find((line) => /^\s*os:\s*\[/.test(line));
  const os = matrix ? matrix.match(/\[(.*)\]/)[1].split(",").map((value) => value.trim()) : [];
  if (JSON.stringify(os) !== JSON.stringify(["ubuntu-latest", "macos-latest", "windows-latest"])) problems.push(`unexpected os matrix ${os}`);
  const gate = job(text, "test-gate");
  if (!gate.some((line) => /^\s*name:\s*test\s*$/.test(line))) problems.push("test-gate name must stay test");
  if (!gate.some((line) => /^\s*needs:\s*test\s*$/.test(line))) problems.push("test-gate must keep needs: test");
  const release = job(text, "release");
  if (!release.some((line) => /^\s*if:\s*github\.event_name == 'push'\s*$/.test(line))) problems.push("release must stay push-only");
  if (!release.some((line) => /^\s*contents:\s*write\s*$/.test(line))) problems.push("release job must grant contents: write");
  if (!/^permissions:\r?\n  contents: read\s*$/m.test(text)) problems.push("top-level contents permission must stay read");
  if (!/^  workflow_dispatch:\s*$/m.test(text)) problems.push("workflow_dispatch trigger must stay");
  if ((text.match(/branches: \[main\]/g) ?? []).length < 2) problems.push("push and pull_request must target main");
  const releaseText = release.join("\n");
  for (const command of ["git ls-remote --exit-code --tags", "git push origin", "gh release view", "--generate-notes"]) {
    if (!releaseText.includes(command)) problems.push(`release command lost: ${command}`);
  }
  return problems;
}

const workflow = fs.readFileSync(WORKFLOW, "utf8");

test("every workflow action is pinned and each job keeps one checkout and one setup-node", () => {
  assert.deepEqual(pinProblems(workflow), []);
});

test("the test job checkout disables credential persistence", () => {
  assert.deepEqual(testCheckoutProblems(workflow), []);
});

test("release checkout, Node 20, matrix, gate, permissions and release commands stay intact", () => {
  assert.deepEqual(releaseCheckoutProblems(workflow), []);
  assert.deepEqual(nodeProblems(workflow), []);
  assert.deepEqual(shapeProblems(workflow), []);
});

// Swapping the vendor while keeping the step name must fail: validators select
// by action, not by name, and both swaps keep valid pins.
test("a step named like a checkout but running another action cannot satisfy the checkout rule", () => {
  const checkoutAsSetup = workflow.replace(/uses: actions\/checkout@[^\s]+/, `uses: ${SETUP_NODE_REF}`);
  assert.ok(checkoutAsSetup.includes("name: Check out source"), "the mutation must keep the checkout step name");
  assert.notDeepEqual(testCheckoutProblems(checkoutAsSetup), [], "a checkout step using another action must fail");
  const setupAsCheckout = workflow.replace(/uses: actions\/setup-node@[^\s]+/, `uses: ${CHECKOUT_REF}`);
  assert.ok(setupAsCheckout.includes("name: Set up Node.js"), "the mutation must keep the setup-node step name");
  assert.notDeepEqual(nodeProblems(setupAsCheckout), [], "a setup-node step using another action must fail");
});

test("dropping all uses fields and overriding test permissions are rejected", () => {
  const withoutUses = workflow.replace(/^ *uses: .*$/gm, "");
  assert.ok(pinProblems(withoutUses).length > 0, "a workflow without uses fields must not pass the pin check");
  const withWriteAll = workflow.replace("    steps:", "    permissions: write-all\n    steps:");
  assert.ok(shapeProblems(withWriteAll).length > 0, "a test job permissions override must be rejected");
});

test("a credential flag on setup-node or a comment cannot satisfy the checkout rule", () => {
  const onSetupNode = workflow
    .replace("          persist-credentials: false\n", "")
    .replace("          node-version: 20", "          node-version: 20\n          persist-credentials: false");
  assert.notDeepEqual(testCheckoutProblems(onSetupNode), [], "persist-credentials on setup-node must not count for the checkout");
  const commented = workflow.replace("          persist-credentials: false", "          # persist-credentials: false");
  assert.notDeepEqual(testCheckoutProblems(commented), [], "a commented directive must not count as present");
});

test("floating and malformed action refs are rejected", () => {
  assert.ok(pinProblems(workflow.replace(CHECKOUT_REF, "actions/checkout@v4")).length > 0, "a floating tag must fail the pin check");
  assert.ok(pinProblems(workflow.replace(CHECKOUT_SHA, CHECKOUT_SHA.slice(0, 39))).length > 0, "a truncated ref must fail the pin check");
});
