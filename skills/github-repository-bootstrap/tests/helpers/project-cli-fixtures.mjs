// Independent native-CLI argv oracle, not a production API or live capability probe.
// Existing installGhFixture consumes these exact keys and fails closed on unknown calls.
export const PROJECT_CLI_CALLS = Object.freeze({
  list: "project list --owner acme-org --limit 1000 --format json",
  linkage: "api graphql -f query=query($owner:String!, $name:String!) { repository(owner:$owner, name:$name) { projectsV2(first:100) { nodes { id number title } } } } -F owner=acme-org -F name=widgets",
  fields: "api graphql -f query=query($projectId:ID!) { node(id:$projectId) { ... on ProjectV2 { id number fields(first:100) { nodes { __typename ... on ProjectV2Field { id name dataType } ... on ProjectV2SingleSelectField { id name options { name } } } pageInfo { hasNextPage } } } } } -F projectId=P_1",
  views: "api graphql -f query=query($projectId:ID!) { node(id:$projectId) { ... on ProjectV2 { id number views(first:100) { nodes { id name layout } pageInfo { hasNextPage } } } } } -F projectId=P_1",
  refreshedFields: "api graphql -f query=query($projectId:ID!) { node(id:$projectId) { ... on ProjectV2 { id number fields(first:100) { nodes { __typename ... on ProjectV2Field { id name dataType } ... on ProjectV2SingleSelectField { id name options { name } } } pageInfo { hasNextPage } } } } } -F projectId=P_OTHER",
  refreshedViews: "api graphql -f query=query($projectId:ID!) { node(id:$projectId) { ... on ProjectV2 { id number views(first:100) { nodes { id name layout } pageInfo { hasNextPage } } } } } -F projectId=P_OTHER",
  create: "project create --owner acme-org --title Roadmap --format json",
  link: "api graphql -f query=mutation($projectId:ID!, $repositoryId:ID!) { linkProjectV2ToRepository(input:{projectId:$projectId, repositoryId:$repositoryId}) { repository { id } } } -F projectId=P_1 -F repositoryId=R_1",
  field: "project field-create 1 --owner acme-org --name Description --data-type TEXT",
  view: "api graphql -f query=mutation($input:CreateProjectV2ViewInput!) { createProjectV2View(input:$input) { projectV2View { id name layout } } } -F input[projectId]=P_1 -F input[name]=Board -F input[layout]=BOARD_LAYOUT",
});

/** Fixed fixture target: acme-org/widgets, Project P_1/1, Description and Board. */
export function projectCliReplies(baseReplies, fixturesPath, scenario) {
  const calls = PROJECT_CLI_CALLS;
  const project = { id: "P_1", number: 1, title: "Roadmap" };
  const json = JSON.stringify;
  const fieldRows = scenario.fieldRows ?? [];
  const viewRows = scenario.viewRows ?? [];
  const ready = {
    ...baseReplies,
    "api -i user": "HTTP/2 200\nx-oauth-scopes: " + (scenario.scopes ?? "repo, project") + "\n",
    [calls.list]: json({ projects: scenario.duplicateTitle ?
      [project, { ...project, id: "P_2", number: 2 }] :
      [scenario.refreshIdentity ? { ...project, id: "P_OTHER", number: 2 } : project] }),
    [calls.linkage]: json({ data: { repository: { projectsV2: { nodes: [project] } } } }),
    [calls.fields]: scenario.fieldJson ?? json({ data: { node: {
      ...project, number: scenario.fieldIdentity ? 2 : 1,
      fields: { nodes: fieldRows, pageInfo: { hasNextPage: Boolean(scenario.fieldPagination) } },
    } } }),
    [calls.views]: scenario.viewJson ?? json({ data: { node: {
      ...project, id: scenario.viewIdentity ? "P_OTHER" : "P_1",
      views: { nodes: viewRows, pageInfo: { hasNextPage: Boolean(scenario.viewPagination) } },
    } } }),
    [calls.create]: scenario.createJson ?? json(project),
    [calls.field]: '{"id":"F_1"}',
  };
  const viewCall = calls.view + (scenario.visibleField ?
    " -F input[configuration][visibleFieldIds][]=F_VISIBLE" : "");
  ready[viewCall] = scenario.viewMutation ?? '{"data":{"createProjectV2View":{"projectV2View":{"id":"V_1","name":"Board","layout":"BOARD_LAYOUT"}}}}';
  if (scenario.noFieldRead) delete ready[calls.fields];
  if (scenario.fieldFailure) delete ready[calls.field];
  if (scenario.viewFailure) delete ready[viewCall];
  if (scenario.refreshIdentity) {
    const refreshed = { id: "P_OTHER", number: 2, title: "Roadmap" };
    ready[calls.linkage] = json({ data: { repository: { projectsV2: { nodes: [refreshed] } } } });
    ready[calls.refreshedFields] = json({ data: { node: { ...refreshed,
      fields: { nodes: [], pageInfo: { hasNextPage: false } } } } });
    ready[calls.refreshedViews] = json({ data: { node: { ...refreshed,
      views: { nodes: [], pageInfo: { hasNextPage: false } } } } });
  }
  const initial = { ...ready };
  if (scenario.missing || scenario.unlinked) {
    if (scenario.missing) initial[calls.list] = '{"projects":[]}';
    initial[calls.linkage] = '{"data":{"repository":{"projectsV2":{"nodes":[]}}}}';
    if (!scenario.linkFailure) {
      initial[calls.link] = scenario.badLinkIdentity ?
        '{"data":{"linkProjectV2ToRepository":{"repository":{"id":"R_OTHER"}}}}' :
        { stdout: '{"data":{"linkProjectV2ToRepository":{"repository":{"id":"R_1"}}}}',
          write: { file: fixturesPath, base64: Buffer.from(json(ready)).toString("base64") } };
    }
  }
  return initial;
}
