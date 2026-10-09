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
const LINKED_PROJECT = { id: "PVT_1", number: 7, title: "Release board", owner: { login: "acme" }, viewerCanUpdate: true };
const MARKERS = { projects: "projectsV2(first:100", items: "items(first:100", mutation: "addProjectV2ItemById" };
const LIVE_ISSUE = /^repos\/[^/]+\/[^/]+\/issues\/\d+$/;
const argument = (args, prefix) => args.find((value) => value.startsWith(prefix))?.slice(prefix.length);

// Derived in memory for the requested EOL only; `\r?\n` keeps a CRLF checkout
// from doubling carriage returns and the on-disk asset is never rewritten.
const projectSyncScript = (eol = "\n") => extractNodeHeredoc(PROJECT_SYNC_ASSET.replace(/\r?\n/g, eol));
const page = (nodes, pageInfo) => ({ nodes, pageInfo: pageInfo ?? { hasNextPage: false } });

// One handler for the reviewed API route/query categories, recording args
// rather than validating the full CLI/flag/query grammar; unknown throws.
export function projectSyncGh(fixture = {}) {
  const issue = fixture.issue ?? OPEN_ISSUE;
  const projects = fixture.projects ?? [LINKED_PROJECT];
  const items = fixture.items ?? [];
  return ({ args }) => {
    const query = argument(args, "query=");
    if (args[0] === "api" && args.length === 2 && LIVE_ISSUE.test(args[1])) return fixture.rawLiveIssue ?? JSON.stringify(issue);
    if (args[0] !== "api" || args[1] !== "graphql") throw new Error(`unexpected project-sync gh fixture call: ${args.join(" ")}`);
    if (query?.includes(MARKERS.projects)) return fixture.rawProjects ?? JSON.stringify({ data: { repository: { projectsV2: page(projects, fixture.projectsPage) } } });
    if (query?.includes(MARKERS.items)) return JSON.stringify({ data: { node: { items: page(items, fixture.itemsPage) } } });
    if (query?.includes(MARKERS.mutation)) {
      const contentId = argument(args, "contentId=");
      const item = fixture.addItem ?? { id: "ITEM_1", content: { id: contentId } };
      return JSON.stringify({ data: { addProjectV2ItemById: { item } } });
    }
    throw new Error(`unexpected project-sync gh fixture call: ${args.join(" ")}`);
  };
}

// Mutation content ids come from the recorded arguments, so a wrong contentId is
// never reported as the expected identity.
const mutationContentIds = (calls) =>
  calls.filter((call) => argument(call.args, "query=")?.includes(MARKERS.mutation)).map((call) => argument(call.args, "contentId="));

export function runProjectSync(fixture = {}, options = {}) {
  const context = runWorkflowScript(projectSyncScript(options.eol), {
    profile: "project-sync",
    event: options.event ?? { action: "opened", issue: { number: 5 } },
    gh: projectSyncGh(fixture),
    repository: "acme/widgets",
    projectOwner: "acme",
    projectTitleBase64: RELEASE_BOARD_BASE64,
  });
  return { ...context, added: mutationContentIds(context.calls) };
}
