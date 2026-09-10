#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  authorizationValue,
  buildPlan,
  canonicalJson,
  createProjectV2ViewArgs,
  emptyReport,
  normalizeConfig,
  normalizeGitHubOrigin,
  managedFileStates,
  parseOAuthScopes,
  projectFieldMatches,
  projectIdentity,
  repositoryBindingMatches,
  resolveProjectByTitle,
  resolveProjectViewByName,
  preflightManagedFiles,
  templateDestination,
  validationErrors,
  writeManagedFile,
  writeTemplateFile,
} from "./lib.mjs";

const skillRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function parseArgs(argv) {
  const result = { mode: "plan", repoDir: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--config") result.config = argv[++index];
    else if (token === "--mode") result.mode = argv[++index];
    else if (token === "--repo-dir") result.repoDir = argv[++index];
    else if (token === "--authorize") result.authorize = argv[++index];
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!result.config) throw new Error("--config <path> is required");
  if (!["plan", "apply"].includes(result.mode))
    throw new Error("--mode must be plan or apply");
  if (result.mode === "apply" && !result.authorize)
    throw new Error(
      "apply requires the exact authorization value emitted by plan",
    );
  return result;
}

function rejectBatchScript(candidate) {
  if (/\.(cmd|bat)$/i.test(candidate)) {
    throw new Error(
      `Unsupported batch script wrapper: ${candidate}. Executing .cmd or .bat files crosses a command shell boundary; provide a direct executable binary (such as gh.exe) instead.`,
    );
  }
}

export function resolveCommand(command) {
  if (path.isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    if (fs.existsSync(command)) {
      rejectBatchScript(command);
      return { cmd: command, args: [] };
    }
    if (fs.existsSync(command + ".exe")) {
      return { cmd: command + ".exe", args: [] };
    }
    for (const ext of [".cmd", ".bat"]) {
      if (fs.existsSync(command + ext)) rejectBatchScript(command + ext);
    }
    return { cmd: command, args: [] };
  }

  if (process.platform === "win32") {
    const pathDirs = (process.env.PATH || "").split(path.delimiter);
    const extensions = (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM")
      .split(";")
      .map((ext) => ext.toLowerCase());

    let batchMatch = null;
    for (const dir of pathDirs) {
      if (!dir) continue;
      for (const ext of ["", ...extensions]) {
        const candidate = path.join(dir, command + ext);
        try {
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            if (/\.(cmd|bat)$/i.test(candidate)) {
              if (!batchMatch) batchMatch = candidate;
              continue;
            }
            return { cmd: candidate, args: [] };
          }
        } catch {
          // Ignore unreadable PATH entries and keep searching.
        }
      }
    }
    if (batchMatch) rejectBatchScript(batchMatch);
  }

  return { cmd: command, args: [] };
}

export function run(command, args, options = {}) {
  const resolved = resolveCommand(command);
  const commandArgs = resolved.args ? [...resolved.args, ...args] : args;
  try {
    return execFileSync(resolved.cmd, commandArgs, {
      encoding: "utf8",
      input: options.input,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
  } catch (error) {
    const detail = String(error.stderr || error.message)
      .trim()
      .split("\n")
      .slice(-2)
      .join(" ");
    throw new Error(`${command} failed: ${detail || "no diagnostic returned"}`);
  }
}

function parseJson(output, source) {
  if (!output.trim()) return null;
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`${source} returned invalid JSON: ${error.message}`);
  }
}

function ghJson(args, options) {
  return parseJson(run("gh", args, options), "gh");
}

function ghTry(args, options) {
  try {
    return { ok: true, output: run("gh", args, options) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function requireGh() {
  run("gh", ["--version"]);
}

function loadConfig(configPath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read JSON configuration: ${error.message}`);
  }
  const errors = validationErrors(parsed);
  if (errors.length)
    throw new Error(
      `Configuration is invalid: ${errors.map((entry) => `${entry.path}: ${entry.message}`).join("; ")}`,
    );
  return normalizeConfig(parsed);
}

function sourceTemplate(relativePath) {
  return path.join(skillRoot, "assets", "templates", relativePath);
}

function validateLocalTarget(config, repoDir) {
  try {
    if (!fs.statSync(repoDir).isDirectory()) throw new Error("not a directory");
    if (
      run("git", [
        "-C",
        repoDir,
        "rev-parse",
        "--is-inside-work-tree",
      ]).trim() !== "true"
    )
      throw new Error("not a Git working tree");
    const origin = run("git", [
      "-C",
      repoDir,
      "remote",
      "get-url",
      "origin",
    ]).trim();
    if (!repositoryBindingMatches(config.repository, origin)) {
      throw new Error(
        `origin ${JSON.stringify(origin)} does not resolve to configured repository ${config.repository}`,
      );
    }
    const repositoryRoot = fs.realpathSync(
      run("git", ["-C", repoDir, "rev-parse", "--show-toplevel"]).trim(),
    );
    fs.accessSync(repositoryRoot, fs.constants.W_OK);
    managedFileStates(config, repositoryRoot);
    if (config.templates) {
          for (const name of config.templates.issueForms)
            fs.accessSync(sourceTemplate(`${name}.yml`), fs.constants.R_OK);
          fs.accessSync(sourceTemplate("config.yml"), fs.constants.R_OK);
          if (config.templates.pullRequest)
            fs.accessSync(
              sourceTemplate("pull_request_template.md"),
              fs.constants.R_OK,
            );
        }
    return {
      repoDir: repositoryRoot,
      origin,
      normalizedOrigin: normalizeGitHubOrigin(origin),
      repository: config.repository,
    };
  } catch (error) {
    throw new Error(`Local repository target is not ready: ${error.message}`);
  }
}

function configuredTemplateDestinations(config) {
  if (!config.templates) return [];
  return [
    ".github/ISSUE_TEMPLATE/config.yml",
    ...config.templates.issueForms.map((name) =>
      path.posix.join(".github/ISSUE_TEMPLATE", `${name}.yml`),
    ),
    ...(config.templates.pullRequest
      ? [".github/pull_request_template.md"]
      : []),
  ];
}

function localTemplatePaths(config, repoDir) {
  return configuredTemplateDestinations(config).filter((file) =>
    fs.existsSync(path.join(repoDir, file)),
  );
}

export function preflightTemplateDestinations(config, repoDir, mutate) {
  for (const relativePath of configuredTemplateDestinations(config)) {
    const destination = templateDestination(repoDir, relativePath);
    if (destination.exists && !fs.lstatSync(destination.target).isFile())
      throw new Error(`Template destination is not a regular file: ${relativePath}`);
    for (
      let parent = path.dirname(destination.target);
      parent !== destination.repoRoot;
      parent = path.dirname(parent)
    ) {
      if (fs.existsSync(parent) && !fs.lstatSync(parent).isDirectory())
        throw new Error(`Template parent is not a directory: ${relativePath}`);
    }
  }
  return mutate();
}

function listProjects(account) {
  const response = ghJson([
    "project",
    "list",
    "--owner",
    account,
    "--limit",
    "1000",
    "--format",
    "json",
  ]);
  return Array.isArray(response) ? response : (response.projects ?? []);
}

const PROJECT_V2_VIEWS_QUERY =
  "query($projectId:ID!) { node(id:$projectId) { ... on ProjectV2 { id number views(first:100) { nodes { id name layout } pageInfo { hasNextPage } } } } }";
const PROJECT_V2_FIELDS_QUERY =
  "query($projectId:ID!) { node(id:$projectId) { ... on ProjectV2 { id number fields(first:100) { nodes { __typename ... on ProjectV2Field { id name dataType } ... on ProjectV2SingleSelectField { id name options { name } } } pageInfo { hasNextPage } } } } }";

function isViewGraphQLCapabilityError(error) {
  return /Cannot query field|Could not resolve to a field|Unknown type ['"]?(?:ProjectV2View|CreateProjectV2ViewInput)|(?:Field|Type) ['"]?(?:views|createProjectV2View|ProjectV2View|CreateProjectV2ViewInput)['"]? (?:does not exist|is not defined)/i.test(
    error,
  );
}

function discoverViews(project) {
  const response = ghTry([
    "api",
    "graphql",
    "-f",
    `query=${PROJECT_V2_VIEWS_QUERY}`,
    "-F",
    `projectId=${project.id}`,
  ]);
  if (!response.ok) {
    if (isViewGraphQLCapabilityError(response.error))
      return { supported: false, views: [] };
    throw new Error(
      `Unable to discover GitHub Projects v2 views through GraphQL: ${response.error}`,
    );
  }
  const payload = parseJson(
    response.output,
    "GitHub Projects v2 views GraphQL query",
  );
  const graphQLErrors = payload?.errors
    ?.map((entry) => entry?.message)
    .filter(Boolean)
    .join("; ");
  if (graphQLErrors) {
    if (isViewGraphQLCapabilityError(graphQLErrors))
      return { supported: false, views: [] };
    throw new Error(
      `GitHub Projects v2 views GraphQL query failed: ${graphQLErrors}`,
    );
  }
  const discovered = payload?.data?.node;
  if (
    !discovered ||
    discovered.id !== project.id ||
    discovered.number !== project.number
  ) {
    throw new Error(
      "GitHub Projects v2 view discovery did not return the exact configured project ID and number",
    );
  }
  const connection = discovered.views;
  if (
    !connection ||
    !Array.isArray(connection.nodes) ||
    connection.pageInfo?.hasNextPage
  ) {
    throw new Error("GitHub Projects v2 view discovery was incomplete");
  }
  return { supported: true, views: connection.nodes };
}

function discoverFields(project) {
  const payload = ghJson([
    "api",
    "graphql",
    "-f",
    `query=${PROJECT_V2_FIELDS_QUERY}`,
    "-F",
    `projectId=${project.id}`,
  ]);
  const node = payload?.data?.node;
  const fields = node?.fields;
  if (
    node?.id !== project.id ||
    node?.number !== project.number ||
    !Array.isArray(fields?.nodes) ||
    fields.pageInfo?.hasNextPage
  )
    throw new Error("GitHub Projects v2 field discovery was incomplete");
  return fields.nodes.map((field) =>
    field.__typename === "ProjectV2SingleSelectField"
      ? { ...field, dataType: "SINGLE_SELECT" }
      : field,
  );
}

function discover(config, repoDir) {
  requireGh();
  const headerResponse = run("gh", ["api", "-i", "user"]);
  const scopes = parseOAuthScopes(headerResponse);
  const missingScopes = config.requiredScopes.filter(
    (scope) => !scopes.includes(scope),
  );
  if (!scopes.length)
    throw new Error(
      "Cannot validate token scopes: GitHub did not return x-oauth-scopes",
    );
  if (missingScopes.length)
    throw new Error(
      `Authenticated token is missing required scopes: ${missingScopes.join(", ")}`,
    );

  const account = ghJson(["api", `users/${config.account}`]);
  if (!account || !["User", "Organization"].includes(account.type))
    throw new Error(
      `Account ${config.account} is not a GitHub user or organization`,
    );
  const repository = ghJson(["api", `repos/${config.repository}`]);
  if (
    !repository ||
    repository.full_name !== config.repository ||
    typeof repository.node_id !== "string" ||
    !repository.node_id
  )
    throw new Error(
      `Repository ${config.repository} is not accessible with an exact node identity`,
    );
  if (repository.owner?.login?.toLowerCase() !== config.account.toLowerCase())
    throw new Error(
      `Repository ${config.repository} is not owned by configured account ${config.account}`,
    );

  const labels = config.labels.length
    ? ghJson([
        "api",
        "--paginate",
        "--slurp",
        `repos/${config.repository}/labels?per_page=100`,
      ]).flat()
    : [];
  const milestones = config.milestones.length
    ? ghJson([
        "api",
        "--paginate",
        "--slurp",
        `repos/${config.repository}/milestones?state=all&per_page=100`,
      ])
        .flat()
        .map((milestone) => ({
          title: milestone.title,
          description: milestone.description ?? null,
          dueOn: milestone.due_on ?? null,
          number: milestone.number,
        }))
    : [];
  if (!config.project)
    return {
      labels,
      milestones,
      templates: localTemplatePaths(config, repoDir),
      files: managedFileStates(config, repoDir),
      project: null,
      fields: [],
      views: [],
      viewsSupported: undefined,
      repositoryId: repository.node_id,
      validation: {
        authenticatedAccount: ghJson(["api", "user"]).login,
        configuredAccountType: account.type,
        repository: repository.full_name,
        repositoryId: repository.node_id,
        grantedScopes: scopes,
      },
    };
  const candidate = resolveProjectByTitle(
    listProjects(config.account),
    config.project.title,
  );
  const project = candidate ? { ...projectIdentity(candidate) } : null;
  const linkedProjects = ghJson([
    "api",
    "graphql",
    "-f",
    "query=query($owner:String!, $name:String!) { repository(owner:$owner, name:$name) { projectsV2(first:100) { nodes { id number title } } } }",
    "-F",
    `owner=${config.account}`,
    "-F",
    `name=${config.repository.split("/")[1]}`,
  ]);
  const linkedNodes = linkedProjects?.data?.repository?.projectsV2?.nodes;
  if (!Array.isArray(linkedNodes))
    throw new Error(
      "GitHub did not return repository Projects v2 linkage data",
    );
  if (project)
    project.linked = linkedNodes.some((item) => item?.id === project.id);

  let fields = [];
  let views = [];
  let viewsSupported;
  if (project) {
    fields = discoverFields(project);
    const viewState = discoverViews(project);
    viewsSupported = viewState.supported;
    views = viewState.views;
  }
  return {
    labels,
    milestones,
    templates: localTemplatePaths(config, repoDir),
    files: managedFileStates(config, repoDir),
    project,
    fields,
    views,
    viewsSupported,
    repositoryId: repository.node_id,
    validation: {
      authenticatedAccount: ghJson(["api", "user"]).login,
      configuredAccountType: account.type,
      repository: repository.full_name,
      repositoryId: repository.node_id,
      grantedScopes: scopes,
    },
  };
}

function installTemplates(config, repoDir, report) {
  if (!config.templates) return;
  const templateFiles = [
    {
      source: sourceTemplate("config.yml"),
      target: path.join(repoDir, ".github", "ISSUE_TEMPLATE", "config.yml"),
    },
    ...config.templates.issueForms.map((name) => ({
      source: sourceTemplate(`${name}.yml`),
      target: path.join(repoDir, ".github", "ISSUE_TEMPLATE", `${name}.yml`),
      labels: name,
    })),
  ];
  if (config.templates.pullRequest)
    templateFiles.push({
      source: sourceTemplate("pull_request_template.md"),
      target: path.join(repoDir, ".github", "pull_request_template.md"),
    });
  for (const template of templateFiles) {
    const relativeTarget = path.relative(
      path.resolve(repoDir),
      template.target,
    );
    const { exists } = templateDestination(repoDir, relativeTarget);
    if (exists && config.templates.mode === "ensure") {
      report.skipped.push({
        resource: "template",
        target: relativeTarget,
        reason: "existing template is unmanaged in ensure mode",
      });
      continue;
    }
    const source = fs.readFileSync(template.source, "utf8");
    const content = template.labels
      ? source.replace(
          "__LABELS__",
          JSON.stringify(
            config.templates.issueFormLabels[template.labels] ?? [],
          ),
        )
      : source;
    writeTemplateFile(repoDir, relativeTarget, content);
    report.completed.push({
      resource: "template",
      target: relativeTarget,
      action: exists ? "update" : "create",
    });
  }
}

function installManagedFiles(config, repoDir, expected, report) {
  const files = preflightManagedFiles(config, repoDir);
  const observed = files.map((file) => ({
    destination: file.destination,
    source: file.source,
    mode: file.mode,
    sourceHash: file.sourceHash,
    destinationHash: file.destinationHash,
  }));
  if (canonicalJson(observed) !== canonicalJson(expected))
    throw new Error("Managed file source or destination changed after authorization");
  for (const file of files) {
    const missing = file.destinationHash === null;
    if (!missing && file.mode === "ensure") {
      report.skipped.push({
        resource: "file",
        target: file.destination,
        reason: "existing file is unmanaged in ensure mode",
      });
      continue;
    }
    if (!missing && file.destinationHash === file.sourceHash) {
      report.skipped.push({
        resource: "file",
        target: file.destination,
        reason: "already matches source",
      });
      continue;
    }
    writeManagedFile(file);
    report.completed.push({
      resource: "file",
      target: file.destination,
      action: missing ? "create" : "update",
    });
  }
}

function applyLabels(config, observed, report) {
  const actual = new Map(observed.labels.map((label) => [label.name, label]));
  for (const label of config.labels) {
    const current = actual.get(label.name);
    if (!current) {
      ghJson([
        "api",
        "--method",
        "POST",
        `repos/${config.repository}/labels`,
        "-f",
        `name=${label.name}`,
        "-f",
        `color=${label.color}`,
        "-f",
        `description=${label.description ?? ""}`,
      ]);
      report.completed.push({
        resource: "label",
        target: label.name,
        action: "create",
      });
    } else if (
      label.managed &&
      (current.color?.toUpperCase() !== label.color ||
        (current.description ?? null) !== (label.description ?? null))
    ) {
      ghJson([
        "api",
        "--method",
        "PATCH",
        `repos/${config.repository}/labels/${encodeURIComponent(label.name)}`,
        "-f",
        `new_name=${label.name}`,
        "-f",
        `color=${label.color}`,
        "-f",
        `description=${label.description ?? ""}`,
      ]);
      report.completed.push({
        resource: "label",
        target: label.name,
        action: "update",
      });
    } else {
      report.skipped.push({
        resource: "label",
        target: label.name,
        reason: current
          ? "existing label is unmanaged or already matches"
          : "not applicable",
      });
    }
  }
}

function milestoneArgs(milestone) {
  const args = [
    "-f",
    `title=${milestone.title}`,
    "-f",
    `description=${milestone.description ?? ""}`,
  ];
  if (milestone.dueOn) args.push("-f", `due_on=${milestone.dueOn}`);
  return args;
}

function applyMilestones(config, observed, report) {
  const actual = new Map(
    observed.milestones.map((milestone) => [milestone.title, milestone]),
  );
  for (const milestone of config.milestones) {
    const current = actual.get(milestone.title);
    if (!current) {
      ghJson([
        "api",
        "--method",
        "POST",
        `repos/${config.repository}/milestones`,
        ...milestoneArgs(milestone),
      ]);
      report.completed.push({
        resource: "milestone",
        target: milestone.title,
        action: "create",
      });
    } else if (
      milestone.managed &&
      ((current.description ?? null) !== (milestone.description ?? null) ||
        (current.dueOn ?? null) !== (milestone.dueOn ?? null))
    ) {
      ghJson([
        "api",
        "--method",
        "PATCH",
        `repos/${config.repository}/milestones/${current.number}`,
        ...milestoneArgs(milestone),
      ]);
      report.completed.push({
        resource: "milestone",
        target: milestone.title,
        action: "update",
      });
    } else {
      report.skipped.push({
        resource: "milestone",
        target: milestone.title,
        reason: current
          ? "existing milestone is unmanaged or already matches"
          : "not applicable",
      });
    }
  }
}

function ensureProject(config, observed, report) {
  if (observed.project) return observed.project;
  const created = projectIdentity(
    ghJson([
      "project",
      "create",
      "--owner",
      config.account,
      "--title",
      config.project.title,
      "--format",
      "json",
    ]),
  );
  report.completed.push({
    resource: "project",
    target: config.project.title,
    action: "create",
    projectId: created.id,
    projectNumber: created.number,
  });
  return created;
}

export function projectLinkResponseMatches(mutation, repositoryId) {
  return (
    mutation?.data?.linkProjectV2ToRepository?.repository?.id === repositoryId
  );
}

function linkProject(config, observed, project, report) {
  if (project.linked) {
    report.skipped.push({
      resource: "project-link",
      target: config.repository,
      reason: "exact project is already linked",
      projectId: project.id,
    });
    return false;
  }
  const mutation = ghJson([
    "api",
    "graphql",
    "-f",
    "query=mutation($projectId:ID!, $repositoryId:ID!) { linkProjectV2ToRepository(input:{projectId:$projectId, repositoryId:$repositoryId}) { repository { id } } }",
    "-F",
    `projectId=${project.id}`,
    "-F",
    `repositoryId=${observed.repositoryId}`,
  ]);
  if (!projectLinkResponseMatches(mutation, observed.repositoryId))
    throw new Error(
      "Project link mutation did not return the configured repository node ID",
    );
  return true;
}

function applyFields(config, observed, project, report) {
  const existing = new Map(observed.fields.map((field) => [field.name, field]));
  for (const field of config.project.fields) {
    const current = existing.get(field.name);
    if (current) {
      if (!projectFieldMatches(current, field))
        throw new Error(
          `Existing project field ${JSON.stringify(field.name)} differs from managed configuration; reconcile it manually before bootstrap`,
        );
      report.skipped.push({
        resource: "project-field",
        target: field.name,
        reason: "existing field matches managed configuration",
        projectId: project.id,
      });
      continue;
    }
    const args = [
      "project",
      "field-create",
      String(project.number),
      "--owner",
      config.account,
      "--name",
      field.name,
      "--data-type",
      field.dataType,
    ];
    if (field.dataType === "SINGLE_SELECT")
      args.push("--single-select-options", field.options.join(","));
    ghJson(args);
    report.completed.push({
      resource: "project-field",
      target: field.name,
      action: "create",
      projectId: project.id,
      projectNumber: project.number,
    });
  }
}

function applyViews(config, observed, project, report) {
  if (observed.viewsSupported === false) {
    for (const view of config.project.views)
      report.skipped.push({
        resource: "project-view",
        target: view.name,
        reason: "GitHub Projects v2 GraphQL view capability is unavailable",
        projectId: project.id,
      });
    return;
  }
  for (const [index, view] of config.project.views.entries()) {
    if (resolveProjectViewByName(observed.views, view.name)) {
      report.skipped.push({
        resource: "project-view",
        target: view.name,
        reason: "existing views are not updated",
        projectId: project.id,
      });
      continue;
    }
    try {
      const mutation = ghJson(createProjectV2ViewArgs(project.id, view));
      const graphQLErrors = mutation?.errors
        ?.map((entry) => entry?.message)
        .filter(Boolean)
        .join("; ");
      if (graphQLErrors) throw new Error(graphQLErrors);
      if (!mutation?.data?.createProjectV2View?.projectV2View?.id) {
        throw new Error(
          "GitHub Projects v2 view mutation did not return a created view identity",
        );
      }
    } catch (error) {
      if (!isViewGraphQLCapabilityError(error.message)) throw error;
      for (const remaining of config.project.views.slice(index)) {
        report.skipped.push({
          resource: "project-view",
          target: remaining.name,
          reason: "GitHub Projects v2 GraphQL view capability is unavailable",
          projectId: project.id,
        });
      }
      return;
    }
    report.completed.push({
      resource: "project-view",
      target: view.name,
      action: "create",
      projectId: project.id,
      projectNumber: project.number,
    });
  }
}

function updateReport(report, args, observed, plan, authorization) {
  report.mode = args.mode;
  report.authorization = {
    required: true,
    value: authorization,
    provided: args.authorize ?? null,
    authorized: args.mode === "plan" ? false : args.authorize === authorization,
  };
  report.validation = observed.validation;
  report.discovered = {
    labels: observed.labels.length,
    milestones: observed.milestones.length,
    templates: observed.templates.length,
    files: observed.files.length,
    project: observed.project
      ? {
          title: observed.project.title,
          id: observed.project.id,
          number: observed.project.number,
          linked: observed.project.linked,
        }
      : null,
    viewsSupported: observed.viewsSupported ?? null,
  };
  report.plan = plan;
}

function printReport(report) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function main() {
  const report = emptyReport();
  try {
    const args = parseArgs(process.argv.slice(2));
    report.mode = args.mode;
    const config = loadConfig(path.resolve(args.config));
    const repoDir = path.resolve(args.repoDir);
    const target = validateLocalTarget(config, repoDir);
    const observed = discover(config, target.repoDir);
    const plan = buildPlan(config, observed);
    const authorization = authorizationValue({
      config,
      target,
      observed,
      plan,
    });
    updateReport(report, args, observed, plan, authorization);
    if (args.mode === "apply" && args.authorize !== authorization)
      throw new Error(
        "apply authorization does not match the exact reviewed canonical plan",
      );
    if (args.mode === "plan") {
      report.success = true;
      printReport(report);
    } else {
      preflightTemplateDestinations(config, target.repoDir, () => {
        installManagedFiles(config, target.repoDir, observed.files, report);
        applyLabels(config, observed, report);
      });
      applyMilestones(config, observed, report);
      installTemplates(config, target.repoDir, report);
      if (!config.project) {
        report.success = true;
        printReport(report);
        return;
      }
      const project = ensureProject(config, observed, report);
      const linked = linkProject(config, observed, project, report);
      const refreshed = discover(config, target.repoDir);
      if (
        !refreshed.project ||
        refreshed.project.id !== project.id ||
        refreshed.project.number !== project.number ||
        refreshed.project.linked !== true
      )
        throw new Error(
          "Project identity changed or was not linked after linkage",
        );
      if (linked)
        report.completed.push({
          resource: "project-link",
          target: config.repository,
          action: "link",
          projectId: project.id,
          projectNumber: project.number,
        });
      applyFields(config, refreshed, refreshed.project, report);
      applyViews(config, refreshed, refreshed.project, report);
      report.success = true;
      printReport(report);
    }
  } catch (error) {
    report.failures.push({ message: error.message });
    printReport(report);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
