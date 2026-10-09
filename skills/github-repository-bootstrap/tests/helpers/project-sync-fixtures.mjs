// Shared fixtures for the portable project-sync runtime tests (U4c).
//
// Read-only test data only: the packaged asset is read from disk and every `gh`
// answer is a fake built in memory. This module never spawns, reads the host
// environment or credentials, writes the filesystem, or touches the network.
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { extractNodeHeredoc, runWorkflowScript } from "./workflow-vm.mjs";

export const PROJECT_SYNC_ASSET = readFileSync(new URL("../../assets/templates/project-issue-sync.yml", import.meta.url), "utf8");
export const RELEASE_BOARD_BASE64 = Buffer.from("Release board", "utf8").toString("base64");
const OPEN_ISSUE = { state: "open", node_id: "I_5" };
export const LINKED_PROJECT = { id: "PVT_1", number: 7, title: "Release board", owner: { login: "acme" }, viewerCanUpdate: true };
const MARKERS = { projects: "projectsV2(first:100", items: "items(first:100", mutation: "addProjectV2ItemById" };
const LIVE_ISSUE = /^repos\/[^/]+\/[^/]+\/issues\/\d+$/;
const argument = (args, prefix) => args.find((value) => value.startsWith(prefix))?.slice(prefix.length);

// Derived in memory for the requested EOL only; `\r?\n` keeps a CRLF checkout
// from doubling carriage returns and the on-disk asset is never rewritten.
const projectSyncScript = (eol = "\n") => extractNodeHeredoc(PROJECT_SYNC_ASSET.replace(/\r?\n/g, eol));
const page = (nodes, pageInfo) => ({ nodes, pageInfo: pageInfo ?? { hasNextPage: false } });
// A page map is either an array indexed by numeric cursor ("0" first request)
// or an object keyed by the literal cursor string; a missing page fails closed.
const pageAt = (pages, cursor) => (Array.isArray(pages) ? pages[Number(cursor ?? 0)] : pages?.[cursor ?? "0"]);
// `failAt` selects a route (string, array, or predicate) and `error` is the
// parent-realm Error to throw, mirroring `execFileSync` failing on that call.
const routeFailure = (fixture, route) => {
  const failAt = fixture.failAt;
  const matched = typeof failAt === "function" ? failAt(route) : failAt === route || (Array.isArray(failAt) && failAt.includes(route));
  if (!matched) return undefined;
  if (!Object.hasOwn(fixture, "error")) throw new Error("project-sync fixture failAt requires an error");
  return fixture.error;
};

// One handler for the reviewed API route/query categories, recording args
// rather than validating the full CLI/flag/query grammar; unknown throws.
export function projectSyncGh(fixture = {}) {
  const issue = Object.hasOwn(fixture, "issue") ? fixture.issue : OPEN_ISSUE;
  const projects = Object.hasOwn(fixture, "projects") ? fixture.projects : [LINKED_PROJECT];
  const items = Object.hasOwn(fixture, "items") ? fixture.items : [];
  const backend = { added: [] };
  const handler = ({ args }) => {
    const query = argument(args, "query=");
    const graphql = args[0] === "api" && args[1] === "graphql";
    const route =
      args[0] === "api" && args.length === 2 && LIVE_ISSUE.test(args[1]) ? "live"
        : graphql && query?.includes(MARKERS.projects) ? "projects"
          : graphql && query?.includes(MARKERS.items) ? "items"
            : graphql && query?.includes(MARKERS.mutation) ? "mutation" : null;
    if (route === null) throw new Error(`unexpected project-sync gh fixture call: ${args.join(" ")}`);
    const failure = routeFailure(fixture, route);
    if (failure) throw failure;
    if (route === "live") return fixture.rawLiveIssue ?? JSON.stringify(issue);
    if (fixture.rawGraphqlResponse !== undefined) return JSON.stringify(fixture.rawGraphqlResponse);
    if (fixture.graphqlErrors) return JSON.stringify({ errors: fixture.graphqlErrors });
    if (route === "projects") {
      const connection = Object.hasOwn(fixture, "projectsPages") ? pageAt(fixture.projectsPages, argument(args, "cursor=")) : page(projects, fixture.projectsPage);
      return fixture.rawProjects ?? JSON.stringify({ data: { repository: { projectsV2: connection } } });
    }
    if (route === "items") {
      const connection = Object.hasOwn(fixture, "itemsPages") ? pageAt(fixture.itemsPages, argument(args, "cursor=")) : page(items, fixture.itemsPage);
      return JSON.stringify({ data: { node: { items: connection } } });
    }
    const item = fixture.addItem ?? fixture.addResponse ?? { id: "ITEM_1", content: { id: argument(args, "contentId=") } };
    if (!Object.hasOwn(fixture, "addItem") && !Object.hasOwn(fixture, "addResponse")) backend.added.push(argument(args, "contentId="));
    return JSON.stringify({ data: { addProjectV2ItemById: { item } } });
  };
  handler.backend = backend;
  return handler;
}

// Mutation content ids come from the recorded arguments, so a wrong contentId is
// never reported as the expected identity. `handler.backend.added` is the fake
// backend's local state: it records only a successful default mutation response,
// never remote confirmation that a real board changed.
const mutationContentIds = (calls) =>
  calls.filter((call) => argument(call.args, "query=")?.includes(MARKERS.mutation)).map((call) => argument(call.args, "contentId="));

export function runProjectSync(fixture = {}, options = {}) {
  const gh = projectSyncGh(fixture);
  const context = runWorkflowScript(projectSyncScript(options.eol), {
    profile: "project-sync",
    event: Object.hasOwn(options, "event") ? options.event : { action: "opened", issue: { number: 5 } },
    gh,
    repository: options.repository ?? "acme/widgets",
    projectOwner: options.projectOwner ?? "acme",
    projectTitleBase64: options.projectTitleBase64 ?? RELEASE_BOARD_BASE64,
    eventName: options.eventName ?? "issues",
    tokenPresent: options.tokenPresent ?? true,
    summaryEnabled: options.summaryEnabled ?? true,
    summaryFailure: options.summaryFailure ?? false,
  });
  return { ...context, added: mutationContentIds(context.calls), fakeAdded: gh.backend.added };
}
