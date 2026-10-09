import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { extractNodeHeredoc, runWorkflowScript } from "./helpers/workflow-vm.mjs";

// U3b binding test for the inert packaged issue-lifecycle template.
//
// The asset is reviewed, project-owned source. It is NOT installed or activated
// by the bootstrap skill: `templates.issueWorkflow` is still rejected by the
// current validator, install is reviewed future Runtime work (U5), and
// deploying the workflow is a separate human step. The fixture runner only
// executes this reviewed script; `node:vm` is not a security boundary. Every
// `gh` call is captured as an exact, parent-realm snapshot with no ambient data.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ASSET = path.join(repoRoot, "skills/github-repository-bootstrap/assets/templates/issue-lifecycle.yml");
const SOURCE = fs.readFileSync(ASSET, "utf8");
const OPTIONS = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
const EOLS = ["\n", "\r\n"];
// CRLF fixtures are derived from the source text for the run; the on-disk asset
// is never rewritten, so the physical raw budget is preserved. Deriving from
// `\r?\n` keeps a CRLF checkout (Windows) from producing doubled carriage returns.
const scriptFor = (eol) => extractNodeHeredoc(SOURCE.replace(/\r?\n/g, eol));
const run = (eol, event, gh) => runWorkflowScript(scriptFor(eol), { event, gh });
const call = (...args) => ({ command: "gh", args, options: OPTIONS });
const live = (state, labels = []) => JSON.stringify({ state, labels: labels.map((name) => ({ name })) });

const HUMAN = ["status:approved", "status:in-progress", "status:blocked", "status:needs-info", "status:needs-design"];

test("the asset header is truthful and never claims an auto-install", () => {
  assert.match(SOURCE, /^name: Issue lifecycle\r?$/m, "the asset must keep its workflow name");
  assert.match(SOURCE, /NOT installed or activated by the bootstrap skill/);
  assert.match(SOURCE, /templates\.issueWorkflow" is still rejected by the current validator/);
  assert.match(SOURCE, /future Runtime work \(U5\)/);
  assert.match(SOURCE, /deployment stays a human step/);
  assert.doesNotMatch(SOURCE, /installed by\b/i, "the old auto-install claim must be gone");
  assert.doesNotMatch(SOURCE, /issueWorkflow":\s*false/, "the unsupported opt-out field must be gone");
  assert.doesNotMatch(SOURCE, /opt out with/i);
});

test("the asset stays least-privilege, checkout-free, and fork-safe (U3b 3386-3403)", () => {
  assert.match(SOURCE, /permissions:\r?\n  contents: read\r?\n  issues: write\r?\n  pull-requests: read\r?\n/, "least-privilege permissions");
  assert.doesNotMatch(SOURCE, /^\s*uses:/m, "no third-party action may be vendored");
  assert.doesNotMatch(SOURCE, /actions\/checkout|contents:\s*write|write-all/);
  assert.ok(SOURCE.includes("GH_TOKEN: ${{ github.token }}"));
  assert.ok(SOURCE.includes("group: issue-lifecycle-${{ github.repository }}-${{ github.event_name }}-${{ github.event.issue.number || github.event.pull_request.number }}"));
  assert.ok(SOURCE.includes("cancel-in-progress: false"), "distinct entities must never cancel each other");
  assert.ok(SOURCE.includes("types: [opened, reopened, closed]"));
  assert.ok(SOURCE.includes("types: [opened, reopened, edited, synchronize, ready_for_review]"));
  for (const guard of ["pr.draft", "if (!head || head !== event.repository.full_name)", "skipping pull request from a fork", "skipping draft pull request"]) {
    assert.ok(SOURCE.includes(guard), `the fork/draft guard must include: ${guard}`);
  }
});

test("opened adds review only when the live issue has no human state (U3b 3121-3157)", () => {
  for (const eol of EOLS) {
    // The live payload carries an unrelated label; review is still added and the
    // unrelated label is left alone. The event carries a human label, but the
    // live payload wins.
    const added = run(eol, { action: "opened", issue: { number: 12, labels: [{ name: "status:approved" }] } }, [live("open", ["bug"]), ""]);
    assert.deepEqual(added.calls, [
      call("api", "repos/fixture/repo/issues/12"),
      call("api", "--method", "POST", "repos/fixture/repo/issues/12/labels", "-f", "labels[]=status:needs-review"),
    ], `${eol} opened must read live state then add review`);
    assert.deepEqual(added.logs, ["added status:needs-review to #12"]);
    for (const preservedLabel of ["status:needs-review", ...HUMAN]) {
      const skipped = run(eol, { action: "opened", issue: { number: 13 } }, [live("open", [preservedLabel])]);
      assert.deepEqual(skipped.calls, [call("api", "repos/fixture/repo/issues/13")], `${eol} ${preservedLabel} must skip the add`);
    }
  }
});

test("reopened and closed touch only the review states (U3b 3159-3221)", () => {
  for (const eol of EOLS) {
    const reopened = run(eol, { action: "reopened", issue: { number: 20 } }, [live("open", ["status:approved", "status:in-progress", "bug", "status:blocked"]), "", "", ""]);
    assert.deepEqual(reopened.calls, [
      call("api", "repos/fixture/repo/issues/20"),
      call("api", "--method", "DELETE", "repos/fixture/repo/issues/20/labels/status%3Aapproved"),
      call("api", "--method", "DELETE", "repos/fixture/repo/issues/20/labels/status%3Ain-progress"),
      call("api", "--method", "POST", "repos/fixture/repo/issues/20/labels", "-f", "labels[]=status:needs-review"),
    ], `${eol} reopened must swap only review states`);
    const unchanged = run(eol, { action: "reopened", issue: { number: 22 } }, [live("open", ["status:needs-review", "status:blocked"])]);
    assert.deepEqual(unchanged.calls, [call("api", "repos/fixture/repo/issues/22")], `${eol} reopened already at review must be a no-op`);
    const closed = run(eol, { action: "closed", issue: { number: 21 } }, [live("closed", ["status:needs-review", "status:approved", "status:in-progress", "bug", ...HUMAN]), "", "", ""]);
    assert.deepEqual(closed.calls, [
      call("api", "repos/fixture/repo/issues/21"),
      call("api", "--method", "DELETE", "repos/fixture/repo/issues/21/labels/status%3Aneeds-review"),
      call("api", "--method", "DELETE", "repos/fixture/repo/issues/21/labels/status%3Aapproved"),
      call("api", "--method", "DELETE", "repos/fixture/repo/issues/21/labels/status%3Ain-progress"),
    ], `${eol} closed must clear only review states`);
    assert.equal(closed.calls.some((entry) => /blocked|needs-info|needs-design/.test(entry.args.join(" "))), false, `${eol} human states must stay untouched`);
  }
});

test("stale events defer to the live issue state (U3b 3310-3343)", () => {
  const stale = [
    { action: "opened", number: 30, state: "closed" },
    { action: "reopened", number: 31, state: "closed" },
    { action: "closed", number: 32, state: "open" },
  ];
  for (const eol of EOLS) {
    for (const { action, number, state } of stale) {
      const result = run(eol, { action, issue: { number } }, [live(state)]);
      assert.deepEqual(result.calls, [call("api", `repos/fixture/repo/issues/${number}`)], `${eol} ${action} must only read live state`);
      assert.match(result.logs[0], /leaving labels unchanged/, `${eol} ${action} must explain the skip`);
    }
  }
});
