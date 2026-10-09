import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { extractNodeHeredoc, runWorkflowScript } from "./helpers/workflow-vm.mjs";

// U3c binding test for the inert packaged issue-lifecycle template.
//
// The asset is reviewed, project-owned source. It is NOT installed, activated,
// or published by the bootstrap skill: `templates.issueWorkflow` is still
// rejected by the current validator, install is reviewed future Runtime work
// (U5), and deployment stays a human step. The fixture runner only executes
// this reviewed script; `node:vm` is not a security boundary. Every `gh` call
// is captured as an exact, parent-realm snapshot with no ambient data. The
// promised live reads are ISSUES only; no live PR polling is claimed.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ASSET = path.join(repoRoot, "skills/github-repository-bootstrap/assets/templates/issue-lifecycle.yml");
const SOURCE = fs.readFileSync(ASSET, "utf8");
const EOLS = ["\n", "\r\n"];
// CRLF fixtures are derived from the source text for the run; the on-disk asset
// is never rewritten, so the physical raw budget is preserved. Deriving from
// `\r?\n` keeps a CRLF checkout from producing doubled carriage returns.
const scriptFor = (eol) => extractNodeHeredoc(SOURCE.replace(/\r?\n/g, eol));
const REPO = { full_name: "acme/widgets", owner: { login: "acme" }, name: "widgets" };
const node = (number, state, repository = REPO) => ({ number, state, repository });
const prEvent = ({ number = 42, draft = false, head = REPO.full_name, action = "opened" } = {}) => ({
  action,
  repository: REPO,
  pull_request: { number, draft, head: { repo: { full_name: head } } },
});

const REST_ISSUE = /^repos\/([^/]+)\/([^/]+)\/issues\/(\d+)$/;
const REST_LABELS = /^repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/labels$/;
const REST_LABEL = /^repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/labels\/(.+)$/;

// A strict `gh` handler: unknown or malformed calls fail loudly instead of an
// exhausted queue being mistaken for a script fault. It mutates only its own
// fixture state and returns a live-issue payload that reflects prior writes.
function fixture({ pages = [], issues = [], deleteError = () => null, cycle = false, graphqlError = null }) {
  const live = new Map(issues.map((issue) => [String(issue.number), { state: issue.state, labels: new Set(issue.labels) }]));
  const seen = [];
  let page = 0;
  const gh = ({ args }) => {
    seen.push(args.slice());
    if (args[0] !== "api") throw new Error(`unexpected gh command: ${args.join(" ")}`);
    if (args[1] === "graphql") {
      if (graphqlError) throw graphqlError;
      const current = pages[cycle ? page++ % pages.length : page++];
      if (current === undefined) throw new Error("unexpected extra GraphQL call");
      if (typeof current === "string") return current;
      if (current.raw !== undefined) return current.raw;
      return JSON.stringify({
        data: { repository: { pullRequest: { closingIssuesReferences: { nodes: current.nodes, pageInfo: current.pageInfo } } } },
      });
    }
    const method = args[1] === "--method" ? args[2] : "GET";
    const offset = args[1] === "--method" ? 3 : 1;
    const resource = args[offset];
    const params = args.slice(offset + 1);
    const read = REST_ISSUE.exec(resource);
    if (method === "GET" && read) {
      const entry = live.get(read[3]);
      if (!entry) throw new Error(`unexpected live read of #${read[3]}`);
      return JSON.stringify({ state: entry.state, labels: [...entry.labels].map((name) => ({ name })) });
    }
    const post = REST_LABELS.exec(resource);
    if (method === "POST" && post) {
      if (params.length !== 2 || params[0] !== "-f" || !params[1].startsWith("labels[]=")) {
        throw new Error(`unexpected POST params: ${params.join(" ")}`);
      }
      const entry = live.get(post[3]);
      if (!entry) throw new Error(`unexpected POST to #${post[3]}`);
      entry.labels.add(params[1].slice("labels[]=".length));
      return "";
    }
    const remove = REST_LABEL.exec(resource);
    if (method === "DELETE" && remove) {
      const label = decodeURIComponent(remove[4]);
      if (encodeURIComponent(label) !== remove[4]) throw new Error(`DELETE label must be URI-encoded: ${remove[4]}`);
      const failure = deleteError(remove[3], label);
      if (failure) {
        const error = new Error(failure.message);
        error.stderr = failure.stderr;
        throw error;
      }
      const entry = live.get(remove[3]);
      if (!entry) throw new Error(`unexpected DELETE on #${remove[3]}`);
      entry.labels.delete(label);
      return "";
    }
    throw new Error(`unexpected gh call: ${args.join(" ")}`);
  };
  return { gh, live, seen };
}

const run = (event, gh, { eventName = "pull_request", repository = "acme/widgets", eol = "\n", timeout } = {}) =>
  runWorkflowScript(scriptFor(eol), { eventName, event, repository, gh, timeout });
const inert = () => {
  throw new Error("no gh call expected");
};
const reads = (number) => `repos/acme/widgets/issues/${number}`;
const mutated = (seen) => seen.some((args) => args.includes("POST") || args.includes("DELETE"));

test("pull requests progress approved same-repo references across pages and retain approval (U3c 3223-3260)", () => {
  for (const eol of EOLS) {
    const fixtureState = fixture({
      issues: [
        { number: 7, state: "open", labels: ["status:approved", "status:needs-review", "type:bug"] },
        { number: 8, state: "open", labels: ["status:needs-review"] },
        { number: 9, state: "closed", labels: ["status:approved"] },
      ],
      pages: [
        { pageInfo: { hasNextPage: true, endCursor: "1" }, nodes: [node(7, "OPEN"), node(8, "OPEN"), node(9, "OPEN")] },
        { pageInfo: { hasNextPage: false, endCursor: "2" }, nodes: [node(10, "OPEN", { owner: { login: "other" }, name: "widgets" }), node(11, "CLOSED")] },
      ],
    });
    const result = run(prEvent(), fixtureState.gh, { eol });
    assert.deepEqual(result.calls.slice(0, 2).map((entry) => entry.args[1]), ["graphql", "graphql"], `${eol} both pages must be consumed`);
    assert.match(result.calls[0].args.join(" "), /closingIssuesReferences\(first:100, after:\$cursor\)/, `${eol} the query must request the first 100 references`);
    assert.equal(result.calls[0].args.includes("cursor=1"), false, `${eol} page one must omit the cursor`);
    assert.equal(result.calls[1].args.includes("cursor=1"), true, `${eol} page two must pass the end cursor`);
    assert.deepEqual(result.calls.slice(2).map((entry) => entry.args), [
      ["api", reads(7)],
      ["api", "--method", "DELETE", `${reads(7)}/labels/status%3Aneeds-review`],
      ["api", "--method", "POST", `${reads(7)}/labels`, "-f", "labels[]=status:in-progress"],
      ["api", reads(8)],
      ["api", reads(9)],
    ], `${eol} only #7 may be read and mutated`);
    assert.deepEqual([...fixtureState.live.get("7").labels].sort(), ["status:approved", "status:in-progress", "type:bug"]);
    assert.deepEqual([...fixtureState.live.get("8").labels], ["status:needs-review"]);
    assert.equal(fixtureState.live.get("9").state, "closed");
  }
});

test("pull requests skip forks, drafts, blocked or unapproved issues, and fail loudly on API errors (U3c 3262-3308)", () => {
  for (const event of [prEvent({ head: "fork/widgets" }), prEvent({ head: "acme/other" }), prEvent({ draft: true })]) {
    assert.deepEqual(run(event, inert).calls, [], "a fork, foreign head, or draft must perform no reads or writes");
  }
  const noHead = prEvent();
  delete noHead.pull_request.head;
  assert.deepEqual(run(noHead, inert).calls, [], "a missing head repository must perform no reads or writes");

  const page = { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [node(7, "OPEN")] };
  for (const labels of [["status:approved", "status:blocked"], ["status:needs-review"]]) {
    const fixtureState = fixture({ issues: [{ number: 7, state: "open", labels }], pages: [page] });
    const result = run(prEvent(), fixtureState.gh);
    assert.equal(result.calls.length, 2, `${labels.join(",")} must only read the reference`);
    assert.deepEqual(result.calls[1].args, ["api", reads(7)]);
    assert.equal(mutated(result.calls.map((entry) => entry.args)), false, `${labels.join(",")} must not mutate`);
  }

  const errors = fixture({ pages: [{ raw: JSON.stringify({ errors: [{ message: "boom" }] }) }] });
  assert.throws(() => run(prEvent(), errors.gh), /GraphQL failed: boom/);
  assert.equal(mutated(errors.seen), false, "a GraphQL error must fail before mutating");

  const transport = fixture({ graphqlError: Object.assign(new Error("transport down"), { stderr: "transport down" }) });
  assert.throws(() => run(prEvent(), transport.gh), (error) => {
    assert.equal(error.stderr, "transport down");
    return true;
  });
  assert.equal(mutated(transport.seen), false, "a transport error must propagate with its stderr before mutating");
});

test("closed issues tolerate only an explicit 404 label-missing response (U3c 3345-3369)", () => {
  const event = { action: "closed", issue: { number: 5 } };
  const tolerated = fixture({
    issues: [{ number: 5, state: "closed", labels: ["status:needs-review"] }],
    deleteError: (_number, label) => label === "status:needs-review"
      ? { message: "gh: Not Found (HTTP 404)", stderr: "gh: Not Found (HTTP 404) Label does not exist" }
      : null,
  });
  const result = run(event, tolerated.gh, { eventName: "issues" });
  assert.deepEqual(result.calls.map((entry) => entry.args), [
    ["api", reads(5)],
    ["api", "--method", "DELETE", `${reads(5)}/labels/status%3Aneeds-review`],
  ]);
  assert.match(result.logs.join("\n"), /skipped already-removed/);

  const forbidden = fixture({
    issues: [{ number: 5, state: "closed", labels: ["status:needs-review"] }],
    deleteError: () => ({ message: "gh: Forbidden (HTTP 403)", stderr: "gh: Forbidden (HTTP 403)" }),
  });
  assert.throws(() => run(event, forbidden.gh, { eventName: "issues" }), /Forbidden/);
  assert.equal(forbidden.seen.some((args) => args.includes("POST")), false, "a 403 must fail before adding a label");
});

test("label deletion does not swallow non-label-404 failures (U3c 3371-3384)", () => {
  const event = { action: "closed", issue: { number: 5 } };
  for (const stderr of ["gh: Server Error (HTTP 500)", "gh: Not Found (HTTP 404)", "gh: label status:needs-review is absent"]) {
    const fixtureState = fixture({
      issues: [{ number: 5, state: "closed", labels: ["status:needs-review"] }],
      deleteError: () => ({ message: stderr, stderr }),
    });
    assert.throws(() => run(event, fixtureState.gh, { eventName: "issues" }), new RegExp(stderr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), stderr);
    assert.equal(fixtureState.seen.some((args) => args.includes("POST")), false, `${stderr} must fail before adding a label`);
  }
});

test("malformed closing-issue pagination fails loudly on every shape (U3c 3405-3434)", () => {
  const issues = [{ number: 7, state: "open", labels: ["status:approved"] }];
  const shapes = [
    ["missing pageInfo", { nodes: [node(7, "OPEN")] }, /malformed/],
    ["missing nodes", { pageInfo: { hasNextPage: false } }, /nodes/],
    ["nonboolean hasNextPage", { nodes: [], pageInfo: { hasNextPage: "true", endCursor: "x" } }, /malformed/],
    ["empty endCursor", { nodes: [], pageInfo: { hasNextPage: true, endCursor: "" } }, /pagination did not advance/],
    ["missing connection", { raw: JSON.stringify({ data: { repository: { pullRequest: {} } } }) }, /missing closingIssuesReferences/],
  ];
  for (const [label, page, pattern] of shapes) {
    const fixtureState = fixture({ pages: [page], issues });
    assert.throws(() => run(prEvent(), fixtureState.gh), pattern, label);
    assert.equal(mutated(fixtureState.seen), false, `${label} must fail before mutating`);
  }
});

test("a repeating GraphQL cursor fails instead of looping (U3c guard)", () => {
  const pages = [
    { nodes: [node(7, "OPEN")], pageInfo: { hasNextPage: true, endCursor: "a" } },
    { nodes: [node(7, "OPEN")], pageInfo: { hasNextPage: true, endCursor: "b" } },
  ];
  const fixtureState = fixture({ pages, cycle: true, issues: [{ number: 7, state: "open", labels: ["status:approved"] }] });
  assert.throws(() => run(prEvent(), fixtureState.gh, { timeout: 100 }), /pagination did not advance/);
});

test("duplicate closing references are read once and mutate once (U3c guard)", () => {
  const duplicate = fixture({
    issues: [{ number: 7, state: "open", labels: ["status:approved", "status:needs-review", "type:bug"] }],
    pages: [
      { nodes: [node(7, "OPEN")], pageInfo: { hasNextPage: true, endCursor: "1" } },
      { nodes: [node(7, "OPEN")], pageInfo: { hasNextPage: false, endCursor: "2" } },
    ],
  });
  const result = run(prEvent(), duplicate.gh);
  assert.equal(result.calls.filter((entry) => entry.args[1] === reads(7)).length, 1, "the duplicate OPEN reference must be read once");
  assert.equal(result.calls.filter((entry) => entry.args.includes("POST")).length, 1, "the duplicate OPEN reference must mutate once");
  assert.deepEqual([...duplicate.live.get("7").labels].sort(), ["status:approved", "status:in-progress", "type:bug"]);

  const closedFirst = fixture({
    issues: [{ number: 7, state: "open", labels: ["status:approved", "status:needs-review"] }],
    pages: [
      { nodes: [node(7, "CLOSED")], pageInfo: { hasNextPage: true, endCursor: "1" } },
      { nodes: [node(7, "OPEN")], pageInfo: { hasNextPage: false, endCursor: "2" } },
    ],
  });
  const late = run(prEvent(), closedFirst.gh);
  assert.equal(late.calls.filter((entry) => entry.args[1] === reads(7)).length, 1, "a CLOSED duplicate must not hide the later OPEN reference");
  assert.equal(late.calls.some((entry) => entry.args.includes("POST")), true);
});

test("unsupported pull request actions read and write nothing (U3c guard)", () => {
  for (const action of ["closed", "labeled"]) {
    assert.deepEqual(run(prEvent({ action }), inert).calls, [], `${action} must stay inert`);
  }
  const noAction = prEvent();
  delete noAction.action;
  assert.deepEqual(run(noAction, inert).calls, [], "a missing action must stay inert");

  const allowed = fixture({
    issues: [{ number: 7, state: "open", labels: ["status:approved", "status:needs-review"] }],
    pages: [{ nodes: [node(7, "OPEN")], pageInfo: { hasNextPage: false, endCursor: null } }],
  });
  const result = run(prEvent({ action: "synchronize" }), allowed.gh);
  assert.equal(result.calls.some((entry) => entry.args.includes("graphql")), true, "an allowed action must read");
  assert.equal(result.calls.some((entry) => entry.args.includes("POST")), true, "an allowed action must mutate");
});

test("unsupported events and payloads stay inert and a malformed repository fails early (U3c guard)", () => {
  const unsupported = run({ action: "opened" }, inert, { eventName: "workflow_dispatch" });
  assert.deepEqual(unsupported.calls, []);
  assert.match(unsupported.logs.join("\n"), /unsupported event/);
  assert.deepEqual(run({ action: "opened", repository: REPO }, inert).calls, [], "no gh call without a pull request");
  assert.deepEqual(run({ action: "opened" }, inert, { eventName: "issues" }).calls, [], "a missing issue payload must stay inert");
  assert.deepEqual(run({ action: "opened", issue: { number: 1, pull_request: {} } }, inert, { eventName: "issues" }).calls, [], "a pull-request-shaped issue payload must stay inert");
  assert.throws(() => run({ action: "opened", issue: { number: 1 } }, inert, { eventName: "issues", repository: "//repo" }), /GITHUB_REPOSITORY must be owner\/name/);
});
