import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { renderProjectIssueSyncWorkflow } from "../scripts/project-sync-renderer.mjs";
import { FIXTURE_TOKEN } from "./helpers/workflow-vm.mjs";
import { PROJECT_SYNC_ASSET, projectSyncGh, runProjectSync } from "./helpers/project-sync-fixtures.mjs";

// Offline contract for the inert packaged project-sync asset (U4c).
//
// The asset is reviewed, project-owned read-only data: nothing installs or
// activates it, and this file never spawns `gh` or touches a host secret. Every
// run goes through the U4a `project-sync` VM profile, whose `exitCode` is a
// catchable simulation (`undefined` on success), not a native process status.
const EOLS = ["\n", "\r\n"];
const HOSTILE_TITLE = '${{ secrets.GH_PROJECT_TOKEN }}\n"quoted" \\ slash Ω😀';
const MUTATION_MARKER = "addProjectV2ItemById";
const SLOTS = ["__SECRET_NAME__", "__PROJECT_OWNER__", "__PROJECT_TITLE_BASE64__"];
const expressions = (text) => [...text.matchAll(/\$\{\{[^}]*\}\}/g)].map((match) => match[0]);
const decodeTitle = (text) => {
  const line = text.split("\n").find((entry) => entry.includes("PROJECT_TITLE_BASE64:"));
  return Buffer.from(JSON.parse(line.slice(line.indexOf(":") + 1).trim()), "base64").toString("utf8");
};
const SKIPPED = [
  { action: "reopened", issue: { state: "closed", node_id: "I_5" } },
  { action: "opened", issue: { state: "open", node_id: "I_5", pull_request: {} } },
];
const SENTINELS = ["LIVE_TITLE_ONLY", "API_REPLY_ONLY", FIXTURE_TOKEN, "\u001b", "\u0000", "fixture-tok", "LIVE_TITLE"];
const malformed = (prefix) => `${prefix} LIVE_TITLE_ONLY API_REPLY_ONLY ${FIXTURE_TOKEN} \u001b\u0000\n${"A".repeat(32)}`;
const assertNoLeak = (result, label) => {
  const output = result.logs.join("");
  for (const sentinel of SENTINELS) {
    assert.equal(output.includes(sentinel), false, `${label} stderr leaks ${JSON.stringify(sentinel)}`);
    assert.equal(result.summary.includes(sentinel), false, `${label} summary leaks ${JSON.stringify(sentinel)}`);
  }
  assert.equal(result.calls.some((call) => call.args.some((arg) => arg.includes(MUTATION_MARKER))), false, `${label} must not mutate`);
};

test("the packaged asset is inert, least-privilege, slot-exact, and renders without a raw title", () => {
  assert.match(PROJECT_SYNC_ASSET, /^name: Project issue sync\r?$/m);
  assert.match(PROJECT_SYNC_ASSET, /installed, activated, or executed by the bootstrap skill/);
  assert.match(PROJECT_SYNC_ASSET, /the current schema and CLI reject project\.issueSync/);
  assert.match(PROJECT_SYNC_ASSET, /templates\.issueWorkflow/);
  assert.match(PROJECT_SYNC_ASSET, /materialize the three template markers/);
  assert.match(PROJECT_SYNC_ASSET, /grant the token access/);
  assert.match(PROJECT_SYNC_ASSET, /no backfill/);
  assert.doesNotMatch(PROJECT_SYNC_ASSET, /Installed by the bootstrap skill|default on for a project|Opt out with/i);
  for (const slot of SLOTS) assert.equal(PROJECT_SYNC_ASSET.split(slot).length - 1, 1, slot);
  assert.throws(() => projectSyncGh()({ args: ["repo", "delete", "query=projectsV2(first:100"] }), /unexpected project-sync gh fixture call/);
  for (const eol of EOLS) {
    const source = PROJECT_SYNC_ASSET.replace(/\r?\n/g, eol);
    assert.match(source, /on:\r?\n  issues:\r?\n    types: \[opened, reopened\]\r?\n/);
    assert.match(source, /permissions:\r?\n  contents: read\r?\n  issues: read\r?\n/);
    assert.match(source, /group: project-issue-sync-\$\{\{ github\.repository \}\}-\$\{\{ github\.event_name \}\}-\$\{\{ github\.event\.issue\.number \}\}/);
    assert.match(source, /cancel-in-progress: false/);
    assert.match(source, /GH_TOKEN: \$\{\{ secrets\.__SECRET_NAME__ \}\}/);
    assert.doesNotMatch(source, /github\.token|actions\/checkout|pull_request_target|contents:\s*write|write-all|PROJECT_TITLE: /);
  }
  const rendered = renderProjectIssueSyncWorkflow(PROJECT_SYNC_ASSET, { owner: "acme-org", title: HOSTILE_TITLE, secretName: "MY_PROJECT_TOKEN" });
  assert.match(rendered, /GH_TOKEN: \$\{\{ secrets\.MY_PROJECT_TOKEN \}\}/);
  assert.match(rendered, /PROJECT_OWNER: "acme-org"/);
  assert.deepEqual(expressions(rendered), ["${{ github.repository }}", "${{ github.event_name }}", "${{ github.event.issue.number }}", "${{ secrets.MY_PROJECT_TOKEN }}"]);
  assert.equal(decodeTitle(rendered), HOSTILE_TITLE);
  assert.doesNotMatch(rendered, /__[A-Z0-9_]+__|github\.token|PROJECT_TITLE: |pull_request_target|actions\/checkout/);
  assert.throws(() => renderProjectIssueSyncWorkflow(PROJECT_SYNC_ASSET, { owner: "acme", title: "x", secretName: "GITHUB_TOKEN" }), /secret name/);
  assert.throws(() => renderProjectIssueSyncWorkflow(PROJECT_SYNC_ASSET, { owner: "bad owner", title: "x", secretName: "S" }), /owner/);
  assert.throws(() => renderProjectIssueSyncWorkflow(PROJECT_SYNC_ASSET, { owner: "acme", title: 42, secretName: "S" }), /title/);
});

test("runtime adds a fresh live issue, deduplicates, and never mutates closed issues or pull requests", () => {
  for (const eol of EOLS) {
    const added = runProjectSync({}, { eol });
    assert.equal(added.exitCode, undefined);
    assert.deepEqual(added.added, ["I_5"]);
    assert.equal(added.calls.length, 4, `${eol} happy run`);
    assert.equal(added.calls[3].args.includes("projectId=PVT_1"), true);
    assert.match(added.logs.join(""), /Added issue #5/);

    const deduped = runProjectSync({ items: [{ id: "ITEM_1", content: { id: "I_5" } }], itemsPage: { hasNextPage: true, endCursor: "1" } }, { eol });
    assert.equal(deduped.exitCode, undefined);
    assert.deepEqual(deduped.added, []);
    assert.equal(deduped.calls.length, 3, `${eol} dedup stops at the found page`);
    assert.match(deduped.logs.join(""), /already tracked/);

    for (const { action, issue } of SKIPPED) {
      const event = { action, issue: { number: 5, node_id: "I_STALE" } };
      const result = runProjectSync({ issue }, { eol, event });
      assert.equal(result.exitCode, undefined);
      assert.deepEqual(result.added, []);
      assert.equal(result.calls.length, 1, `${eol} ${action} reads only the live issue`);
      assert.equal(result.calls[0].args[1], "repos/acme/widgets/issues/5");
      assert.equal(result.logs.join("").includes("I_STALE"), false);
    }

    for (const action of ["opened", "reopened"]) {
      const event = { action, issue: { number: 5, node_id: "I_STALE" } };
      const result = runProjectSync({}, { eol, event });
      assert.equal(result.exitCode, undefined);
      assert.deepEqual(result.added, ["I_5"], `${eol} ${action} uses the fresh live node id`);
      assert.equal(result.logs.join("").includes("I_STALE"), false);
    }
  }
});

test("a malformed project listing is generic and leaks no response, title, or token", () => {
  for (const eol of EOLS) {
    const result = runProjectSync({ rawProjects: malformed(FIXTURE_TOKEN) }, { eol });
    assert.equal(result.exitCode, 1);
    assert.match(result.logs.join(""), /Listing repository-linked projects returned malformed JSON/);
    assertNoLeak(result, eol);
  }
});

test("a malformed live issue is generic and leaks no response, title, or token", () => {
  for (const eol of EOLS) {
    const result = runProjectSync({ rawLiveIssue: malformed("LIVE_TITLE_ONLY") }, { eol });
    assert.equal(result.exitCode, 1);
    assert.match(result.logs.join(""), /Reading live issue #5 returned malformed JSON/);
    assertNoLeak(result, eol);
  }
});
