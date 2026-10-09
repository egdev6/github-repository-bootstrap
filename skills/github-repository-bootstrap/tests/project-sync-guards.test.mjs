import assert from "node:assert/strict";
import test from "node:test";
import { FIXTURE_TOKEN } from "./helpers/workflow-vm.mjs";
import { LINKED_PROJECT, runProjectSync } from "./helpers/project-sync-fixtures.mjs";

// Offline guards ported from donor S14-S17 (U4d), plus cycle and event hardening.
//
// Every run is the reviewed project-sync asset inside the U4a `project-sync` VM
// profile: fake in-memory `gh`, no spawn, host environment, credential, write, or
// network. `exitCode` is `undefined` on success and `1` after `fatal`, never a
// native process status. `added` is the recorded mutation ARGUMENT (an attempt),
// and `fakeAdded` is the fixture backend's local default-state trace -- neither
// proves a real remote board changed.
const argument = (args, prefix) => args.find((value) => value.startsWith(prefix))?.slice(prefix.length);
const combined = (result) => result.logs.join("") + result.summary;
const graphqlCalls = (result) => result.calls.filter((call) => call.args[0] === "api" && call.args[1] === "graphql");
const queryCalls = (result, marker) => graphqlCalls(result).filter((call) => argument(call.args, "query=")?.includes(marker));
const assertNoMutation = (result, label) => {
  assert.deepEqual(result.added, [], `${label} must not attempt a mutation`);
  assert.deepEqual(result.fakeAdded, [], `${label} must not record a fake mutation`);
};
const ACCESS_CODES = [
  "HTTP 401",
  "HTTP 403",
  "HTTP 404",
  "FORBIDDEN",
  "NOT_FOUND",
  "Could not resolve to a Repository",
  "Could not resolve to a node",
  "Could not resolve to a ProjectV2",
  "Resource not accessible",
  "Bad credentials",
];
const ACCESS_SENTINEL = "RAW_ACCESS_REPLY_SENTINEL";
const ACCESS_TITLE = "PRIVATE_ACCESS_TITLE";
const ACCESS_BODY = `${ACCESS_SENTINEL} ${FIXTURE_TOKEN} ${ACCESS_TITLE} \u001b\u0000`;
const accessError = (code) =>
  Object.assign(new Error("fixture gh access failure"), { stdout: `${code} ${ACCESS_BODY}`, stderr: `${code} ${ACCESS_BODY}` });
const cyclic = (endCursor) => ({ nodes: [], pageInfo: { hasNextPage: true, endCursor } });

test("runtime warns and skips known access failures and unsafe capability (S14)", () => {
  const noToken = runProjectSync({}, { tokenPresent: false });
  assert.equal(noToken.exitCode, undefined);
  assert.match(noToken.logs.join(""), /::warning::/);
  assert.equal(noToken.calls.length, 0);
  assertNoMutation(noToken, "no token");

  const closed = runProjectSync({ issue: { state: "closed", node_id: "I_5" } });
  assert.equal(closed.exitCode, undefined);
  assert.equal(closed.calls.length, 1);
  assert.equal(closed.calls[0].args[1], "repos/acme/widgets/issues/5");
  assert.equal(graphqlCalls(closed).length, 0);
  assertNoMutation(closed, "closed issue");

  const readOnly = runProjectSync({ projects: [{ ...LINKED_PROJECT, viewerCanUpdate: false }] });
  assert.equal(readOnly.exitCode, undefined);
  assert.match(readOnly.summary, /WARNING/);
  assertNoMutation(readOnly, "no capability");

  for (const code of ACCESS_CODES) {
    for (const route of ["live", "projects", "items", "mutation"]) {
      const result = runProjectSync({ failAt: route, error: accessError(code) });
      assert.equal(result.exitCode, undefined, `${code} ${route}`);
      assert.match(result.logs.join(""), /::warning::/, `${code} ${route}`);
      // A failed `gh` call is still a recorded attempt (the mutation route keeps
      // its argument), but the fake backend records no state, so `fakeAdded` is
      // empty. Neither value proves a real board changed.
      assert.deepEqual(result.added, route === "mutation" ? ["I_5"] : [], `${code} ${route} attempts`);
      assert.deepEqual(result.fakeAdded, [], `${code} ${route} fake state`);
      assert.equal(combined(result).includes(ACCESS_SENTINEL), false, `${code} ${route} leaked response`);
      assert.equal(combined(result).includes(FIXTURE_TOKEN), false, `${code} ${route} leaked token`);
      assert.doesNotMatch(combined(result), /PRIVATE_ACCESS_TITLE|\u001b|\u0000/, `${code} ${route} leaked private body`);
    }
    const errorsPayload = runProjectSync({ graphqlErrors: [{ message: `${code} ${ACCESS_BODY}` }] });
    assert.equal(errorsPayload.exitCode, undefined, code);
    assert.match(errorsPayload.logs.join(""), /::warning::/, code);
    assert.doesNotMatch(combined(errorsPayload), /RAW_ACCESS_REPLY_SENTINEL|PRIVATE_ACCESS_TITLE|\u001b|\u0000/, code);
    assert.equal(combined(errorsPayload).includes(FIXTURE_TOKEN), false, code);
    assertNoMutation(errorsPayload, code);
  }
});

test("runtime fails loudly on ambiguity, stale cursors, and unexpected responses (S15)", () => {
  const ambiguous = runProjectSync({ projects: [LINKED_PROJECT, { ...LINKED_PROJECT, id: "PVT_2" }] });
  assert.equal(ambiguous.exitCode, 1);
  assert.match(ambiguous.logs.join(""), /Multiple repository-linked projects/);
  assertNoMutation(ambiguous, "ambiguous");

  const stale = runProjectSync({ items: [], itemsPage: { hasNextPage: true, endCursor: "same" } });
  assert.equal(stale.exitCode, 1);
  assert.match(stale.logs.join(""), /pagination did not advance/);
  assertNoMutation(stale, "stale cursor");

  const malformed = runProjectSync({ projects: null, graphqlErrors: [{ message: "Something exploded" }] });
  assert.equal(malformed.exitCode, 1);
  assert.match(malformed.logs.join(""), /GraphQL failed/);
  assertNoMutation(malformed, "graphql error");
});

test("runtime rejects malformed pagination, nodes, payloads, and mutation identity (S16)", () => {
  for (const itemsPages of [
    [{ nodes: [], pageInfo: { hasNextPage: "yes" } }],
    [{ nodes: [], pageInfo: { hasNextPage: true, endCursor: 5 } }],
    [{ pageInfo: { hasNextPage: false } }],
  ]) {
    const result = runProjectSync({ itemsPages });
    assert.equal(result.exitCode, 1, JSON.stringify(itemsPages));
    assertNoMutation(result, "malformed page");
  }
  for (const rawGraphqlResponse of [{}, { data: "nope" }]) {
    const result = runProjectSync({ rawGraphqlResponse });
    assert.equal(result.exitCode, 1);
    assert.match(result.logs.join(""), /unexpected GraphQL payload/);
    assertNoMutation(result, "payload");
  }
  for (const addResponse of [{ id: "ITEM_1", content: {} }, { id: "ITEM_1", content: { id: "OTHER" } }, {}]) {
    const result = runProjectSync({ items: [], addResponse });
    assert.equal(result.exitCode, 1, JSON.stringify(addResponse));
    const mutation = result.calls.at(-1);
    assert.equal(mutation.args.includes("projectId=PVT_1"), true);
    assert.equal(mutation.args.includes("contentId=I_5"), true);
    assert.deepEqual(result.added, ["I_5"]);
    assert.deepEqual(result.fakeAdded, []);
  }
});

test("runtime walks pages and scopes the repository query to the repository owner (S17)", () => {
  const twoPage = runProjectSync({
    itemsPages: [
      { nodes: [{ id: "OTHER", content: { id: "I_9" } }], pageInfo: { hasNextPage: true, endCursor: "1" } },
      { nodes: [{ id: "ITEM_5", content: { id: "I_5" } }], pageInfo: { hasNextPage: false, endCursor: "2" } },
    ],
  });
  assert.equal(twoPage.exitCode, undefined);
  assertNoMutation(twoPage, "two pages");
  assert.deepEqual(queryCalls(twoPage, "items(first:100").map((call) => argument(call.args, "cursor=") ?? null), [null, "1"]);

  const otherOwner = runProjectSync({ projects: [{ ...LINKED_PROJECT, owner: { login: "other-org" } }] }, { projectOwner: "other-org" });
  assert.equal(otherOwner.exitCode, undefined);
  assert.equal(otherOwner.calls.some((call) => call.args.includes("owner=acme")), true);
  assert.equal(otherOwner.calls.some((call) => call.args.includes("owner=other-org")), false);
  assert.deepEqual(otherOwner.added, ["I_5"]);
  assert.deepEqual(otherOwner.fakeAdded, ["I_5"]);

  const duplicateLater = runProjectSync({
    projectsPages: [
      { nodes: [LINKED_PROJECT], pageInfo: { hasNextPage: true, endCursor: "1" } },
      { nodes: [{ ...LINKED_PROJECT, id: "PVT_2" }], pageInfo: { hasNextPage: false } },
    ],
  });
  assert.equal(duplicateLater.exitCode, 1);
  assert.match(duplicateLater.logs.join(""), /Multiple repository-linked projects/);
  assertNoMutation(duplicateLater, "duplicate later page");

  const matchSecondPage = runProjectSync({
    projectsPages: [
      { nodes: [], pageInfo: { hasNextPage: true, endCursor: "1" } },
      { nodes: [LINKED_PROJECT], pageInfo: { hasNextPage: false } },
    ],
  });
  assert.equal(matchSecondPage.exitCode, undefined);
  assert.deepEqual(matchSecondPage.added, ["I_5"]);

  const absentEveryPage = runProjectSync({
    itemsPages: [
      { nodes: [], pageInfo: { hasNextPage: true, endCursor: "1" } },
      { nodes: [{ id: "OTHER", content: { id: "I_9" } }], pageInfo: { hasNextPage: false } },
    ],
  });
  assert.equal(absentEveryPage.exitCode, undefined);
  assert.deepEqual(absentEveryPage.added, ["I_5"]);
  assert.deepEqual(absentEveryPage.fakeAdded, ["I_5"]);

  const foundEarly = runProjectSync({
    itemsPages: [
      { nodes: [{ id: "ITEM_5", content: { id: "I_5" } }], pageInfo: { hasNextPage: true, endCursor: "1" } },
      { nodes: [], pageInfo: { hasNextPage: false } },
    ],
  });
  assert.equal(foundEarly.exitCode, undefined);
  assertNoMutation(foundEarly, "found early");
  assert.equal(queryCalls(foundEarly, "items(first:100").some((call) => call.args.includes("cursor=1")), false);
});

test("pagination cursor cycles fail bounded instead of hitting the VM deadline", () => {
  const projectCycle = runProjectSync({ projectsPages: { 0: cyclic("A"), A: cyclic("B"), B: cyclic("A") } });
  assert.equal(projectCycle.exitCode, 1);
  assert.match(projectCycle.logs.join(""), /revisited a cursor/);
  assertNoMutation(projectCycle, "project cycle");
  const projectCalls = queryCalls(projectCycle, "projectsV2(first:100");
  assert.equal(projectCalls.length, 3);
  assert.deepEqual(projectCalls.map((call) => argument(call.args, "cursor=") ?? null), [null, "A", "B"]);

  const itemCycle = runProjectSync({ itemsPages: { 0: cyclic("A"), A: cyclic("B"), B: cyclic("A") } });
  assert.equal(itemCycle.exitCode, 1);
  assert.match(itemCycle.logs.join(""), /revisited a cursor/);
  assertNoMutation(itemCycle, "item cycle");
  assert.equal(itemCycle.calls.length, 5);

  const shared = runProjectSync({
    projectsPages: [
      { nodes: [], pageInfo: { hasNextPage: true, endCursor: "1" } },
      { nodes: [LINKED_PROJECT], pageInfo: { hasNextPage: false } },
    ],
    itemsPages: [
      { nodes: [], pageInfo: { hasNextPage: true, endCursor: "1" } },
      { nodes: [{ id: "ITEM_5", content: { id: "I_5" } }], pageInfo: { hasNextPage: false } },
    ],
  });
  assert.equal(shared.exitCode, undefined);
  assertNoMutation(shared, "shared cursor across loops");
});

test("unknown issue actions and events skip without API calls", () => {
  for (const action of ["closed", "edited", "labeled"]) {
    const skipped = runProjectSync({}, { event: { action, issue: { number: 5 } } });
    assert.equal(skipped.exitCode, undefined, action);
    assert.equal(skipped.calls.length, 0, action);
    assertNoMutation(skipped, action);
  }
  const wrongEvent = runProjectSync({}, { eventName: "pull_request" });
  assert.equal(wrongEvent.exitCode, undefined);
  assert.equal(wrongEvent.calls.length, 0);
  assertNoMutation(wrongEvent, "wrong event name");
});

test("malformed event payloads fail closed before any API call", () => {
  for (const event of [
    { issue: { number: 5 } },
    { action: 5, issue: { number: 5 } },
    { action: "opened" },
    { action: "opened", issue: { number: 0 } },
    { action: "opened", issue: { number: -1 } },
    { action: "opened", issue: { number: Number.MAX_SAFE_INTEGER + 1 } },
    null,
    [],
    "nope",
  ]) {
    const result = runProjectSync({}, { event });
    assert.equal(result.exitCode, 1, JSON.stringify(event));
    assertNoMutation(result, JSON.stringify(event));
  }
});

test("title configuration, repository identity, and unexpected read errors fail closed", () => {
  for (const projectTitleBase64 of ["", "PRIVATE_TITLE_SENTINEL"]) {
    const result = runProjectSync({}, { projectTitleBase64 });
    assert.equal(result.exitCode, 1, projectTitleBase64);
    assert.match(result.logs.join(""), /Project title configuration is missing or invalid/);
    assert.equal(combined(result).includes("PRIVATE_TITLE_SENTINEL"), false);
    assertNoMutation(result, "title");
  }

  const noNode = runProjectSync({ issue: { state: "open" } });
  assert.equal(noNode.exitCode, 1);
  assert.match(noNode.logs.join(""), /did not return a node identity/);
  assertNoMutation(noNode, "missing node id");

  const badRepo = runProjectSync({}, { repository: "bad" });
  assert.equal(badRepo.exitCode, 1);
  assert.match(badRepo.logs.join(""), /GITHUB_REPOSITORY must be owner\/name/);
  assert.equal(badRepo.calls.length, 0);

  const unexpected = runProjectSync({ failAt: "live", error: Object.assign(new Error("boom"), { stdout: "RAW_API_REPLY", stderr: "HTTP 500 Internal Server Error" }) });
  assert.equal(unexpected.exitCode, 1);
  assert.match(unexpected.logs.join(""), /Reading the live issue failed unexpectedly/);
  assert.equal(combined(unexpected).includes("RAW_API_REPLY"), false);
  assert.equal(combined(unexpected).includes(FIXTURE_TOKEN), false);
});
