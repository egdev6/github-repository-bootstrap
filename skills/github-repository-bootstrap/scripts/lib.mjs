import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const TYPES = new Set(["TEXT", "NUMBER", "DATE", "SINGLE_SELECT"]);
const LAYOUTS = new Set(["BOARD", "TABLE"]);
const TEMPLATE_NAMES = new Set(["bug_report", "feature_request"]);

export const LIMITS = Object.freeze({
  accountLength: 39,
  repositoryLength: 200,
  requiredScopes: 10,
  scopeLength: 100,
  labels: 50,
  labelNameLength: 50,
  labelDescriptionLength: 100,
  milestones: 50,
  milestoneTitleLength: 255,
  milestoneDescriptionLength: 1000,
  files: 100,
  filePathLength: 1024,
  issueFormLabels: 10,
  projectTitleLength: 255,
  fields: 20,
  fieldNameLength: 100,
  options: 50,
  optionLength: 100,
  views: 20,
  viewNameLength: 100,
  viewSettings: 20,
});

function hasLength(value, maximum) {
  return typeof value === "string" && value.length <= maximum;
}

function isIsoDateTime(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) &&
    !Number.isNaN(Date.parse(value))
  );
}

export function validationErrors(config) {
  const errors = [];
  const add = (location, message) => errors.push({ path: location, message });
  const object = (value, location) => {
    if (!value || Array.isArray(value) || typeof value !== "object")
      add(location, "must be an object");
    return value && !Array.isArray(value) && typeof value === "object";
  };
  const known = (value, location, keys) => {
    for (const key of Object.keys(value)) {
      if (!keys.includes(key))
        add(`${location}.${key}`, "is not an allowed property");
    }
  };
  const array = (value, location, maximum) => {
    if (!Array.isArray(value)) {
      add(location, "must be an array");
      return false;
    }
    if (value.length > maximum)
      add(location, `must contain at most ${maximum} items`);
    return true;
  };
  const resourceMap = (value, location, maximum) => {
    if (!value || Array.isArray(value) || typeof value !== "object") {
      add(
        location,
        Array.isArray(value)
          ? "legacy arrays are unsupported; use an object map keyed by the managed identity"
          : "must be an object map keyed by the managed identity",
      );
      return false;
    }
    if (Object.keys(value).length > maximum)
      add(location, `must contain at most ${maximum} entries`);
    return true;
  };
  const mapKey = (key, location, maximum, identity) => {
    if (!hasLength(key, maximum) || !key)
      add(
        `${location}.${key}`,
        `must be a non-empty ${identity} of at most ${maximum} characters`,
      );
  };
  const unique = (
    items,
    location,
    selector,
    message = "must not duplicate a configured name or title",
  ) => {
    if (!Array.isArray(items)) return;
    const seen = new Set();
    items.forEach((item, index) => {
      const value = selector(item);
      if (typeof value === "string" && seen.has(value))
        add(`${location}[${index}]`, message);
      if (typeof value === "string") seen.add(value);
    });
  };

  if (!object(config, "$")) return errors;
  known(config, "$", [
    "account",
    "repository",
    "requiredScopes",
    "labels",
    "milestones",
    "files",
    "templates",
    "project",
  ]);
  for (const key of ["account", "repository"]) {
    if (!(key in config)) add(`$.${key}`, "is required");
  }
  if (
    typeof config.account !== "string" ||
    !/^[A-Za-z0-9-]+$/.test(config.account) ||
    !hasLength(config.account, LIMITS.accountLength)
  )
    add(
      "$.account",
      `must be a GitHub user or organization login of at most ${LIMITS.accountLength} characters`,
    );
  if (
    typeof config.repository !== "string" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.repository) ||
    !hasLength(config.repository, LIMITS.repositoryLength)
  )
    add(
      "$.repository",
      `must be owner/repository of at most ${LIMITS.repositoryLength} characters`,
    );
  if (config.requiredScopes !== undefined) {
    if (
      array(config.requiredScopes, "$.requiredScopes", LIMITS.requiredScopes)
    ) {
      unique(
        config.requiredScopes,
        "$.requiredScopes",
        (scope) => scope,
        "must not duplicate a scope",
      );
      config.requiredScopes.forEach((scope, index) => {
        if (!hasLength(scope, LIMITS.scopeLength) || !scope)
          add(
            `$.requiredScopes[${index}]`,
            `must be a non-empty scope name of at most ${LIMITS.scopeLength} characters`,
          );
      });
    }
    if (
      !config.project &&
      Array.isArray(config.requiredScopes) &&
      config.requiredScopes.some((scope) =>
        ["project", "read:project"].includes(scope),
      )
    )
      add("$.requiredScopes", "project scope requires a configured project");
  }

  if (
    config.labels !== undefined &&
    resourceMap(config.labels, "$.labels", LIMITS.labels)
  ) {
    for (const [name, label] of Object.entries(config.labels)) {
      mapKey(name, "$.labels", LIMITS.labelNameLength, "label name");
      if (!object(label, `$.labels.${name}`)) continue;
      known(label, `$.labels.${name}`, ["color", "description", "managed"]);
      if (
        typeof label.color !== "string" ||
        !/^[0-9a-f]{6}$/i.test(label.color)
      )
        add(
          `$.labels.${name}.color`,
          "must be a six-digit hexadecimal color without #",
        );
      if (
        "description" in label &&
        !hasLength(label.description, LIMITS.labelDescriptionLength)
      )
        add(
          `$.labels.${name}.description`,
          `must be a string of at most ${LIMITS.labelDescriptionLength} characters`,
        );
      if ("managed" in label && typeof label.managed !== "boolean")
        add(`$.labels.${name}.managed`, "must be boolean");
    }
  }

  if (
    config.milestones !== undefined &&
    resourceMap(config.milestones, "$.milestones", LIMITS.milestones)
  ) {
    for (const [title, milestone] of Object.entries(config.milestones)) {
      mapKey(
        title,
        "$.milestones",
        LIMITS.milestoneTitleLength,
        "milestone title",
      );
      if (!object(milestone, `$.milestones.${title}`)) continue;
      known(milestone, `$.milestones.${title}`, [
        "description",
        "dueOn",
        "managed",
      ]);
      if (
        "description" in milestone &&
        !hasLength(milestone.description, LIMITS.milestoneDescriptionLength)
      )
        add(
          `$.milestones.${title}.description`,
          `must be a string of at most ${LIMITS.milestoneDescriptionLength} characters`,
        );
      if ("dueOn" in milestone && !isIsoDateTime(milestone.dueOn))
        add(
          `$.milestones.${title}.dueOn`,
          "must be an ISO date-time with a timezone",
        );
      if ("managed" in milestone && typeof milestone.managed !== "boolean")
        add(`$.milestones.${title}.managed`, "must be boolean");
    }
  }

  if (
    config.files !== undefined &&
    resourceMap(config.files, "$.files", LIMITS.files)
  ) {
    for (const [destination, file] of Object.entries(config.files)) {
      if (!isRepositoryRelativePath(destination))
        add(
          `$.files.${destination}`,
          "must be a repository-relative path without traversal",
        );
      if (!object(file, `$.files.${destination}`)) continue;
      known(file, `$.files.${destination}`, ["source", "mode"]);
      if (!isRepositoryRelativePath(file.source))
        add(
          `$.files.${destination}.source`,
          "must be a repository-relative path without traversal",
        );
      if (!["ensure", "replace"].includes(file.mode))
        add(`$.files.${destination}.mode`, "must be ensure or replace");
    }
  }

  if (
    config.templates !== undefined &&
    object(config.templates, "$.templates")
  ) {
    known(config.templates, "$.templates", [
      "issueForms",
      "issueFormLabels",
      "pullRequest",
      "mode",
    ]);
    if (
      array(
        config.templates.issueForms,
        "$.templates.issueForms",
        TEMPLATE_NAMES.size,
      )
    ) {
      unique(
        config.templates.issueForms,
        "$.templates.issueForms",
        (value) => value,
        "must not duplicate an issue form",
      );
      config.templates.issueForms.forEach((name, index) => {
        if (!TEMPLATE_NAMES.has(name))
          add(
            `$.templates.issueForms[${index}]`,
            "must be bug_report or feature_request",
          );
      });
    }
    if (
      object(config.templates.issueFormLabels, "$.templates.issueFormLabels")
    ) {
      known(config.templates.issueFormLabels, "$.templates.issueFormLabels", [
        "bug_report",
        "feature_request",
      ]);
      const declaredLabels = new Set(
        config.labels &&
          !Array.isArray(config.labels) &&
          typeof config.labels === "object"
          ? Object.keys(config.labels)
          : [],
      );
      for (const name of config.templates.issueForms ?? []) {
        const labels = config.templates.issueFormLabels[name];
        if (
          !array(
            labels,
            `$.templates.issueFormLabels.${name}`,
            LIMITS.issueFormLabels,
          )
        )
          continue;
        unique(
          labels,
          `$.templates.issueFormLabels.${name}`,
          (label) => label,
          "must not duplicate a label",
        );
        labels.forEach((label, index) => {
          if (
            !hasLength(label, LIMITS.labelNameLength) ||
            !declaredLabels.has(label)
          )
            add(
              `$.templates.issueFormLabels.${name}[${index}]`,
              "must reference a configured label",
            );
        });
      }
    }
    if (typeof config.templates.pullRequest !== "boolean")
      add("$.templates.pullRequest", "must be boolean");
    if (!["ensure", "replace"].includes(config.templates.mode))
      add("$.templates.mode", "must be ensure or replace");
  }

  if (config.project !== undefined && object(config.project, "$.project")) {
    known(config.project, "$.project", ["title", "fields", "views"]);
    if (
      !hasLength(config.project.title, LIMITS.projectTitleLength) ||
      !config.project.title
    )
      add(
        "$.project.title",
        `is required and must be at most ${LIMITS.projectTitleLength} characters`,
      );
    if (resourceMap(config.project.fields, "$.project.fields", LIMITS.fields)) {
      for (const [name, field] of Object.entries(config.project.fields)) {
        mapKey(name, "$.project.fields", LIMITS.fieldNameLength, "field name");
        if (!object(field, `$.project.fields.${name}`)) continue;
        known(field, `$.project.fields.${name}`, ["dataType", "options"]);
        if (!TYPES.has(field.dataType))
          add(
            `$.project.fields.${name}.dataType`,
            "must be TEXT, NUMBER, DATE, or SINGLE_SELECT",
          );
        if (field.dataType === "SINGLE_SELECT") {
          if (
            !array(
              field.options,
              `$.project.fields.${name}.options`,
              LIMITS.options,
            ) ||
            field.options.length === 0
          )
            add(
              `$.project.fields.${name}.options`,
              "is required for SINGLE_SELECT",
            );
          unique(
            field.options,
            `$.project.fields.${name}.options`,
            (option) => option,
            "must not duplicate an option",
          );
          field.options?.forEach((option, optionIndex) => {
            if (
              !hasLength(option, LIMITS.optionLength) ||
              !option ||
              option.includes(",")
            )
              add(
                `$.project.fields.${name}.options[${optionIndex}]`,
                `must be a non-empty comma-free option of at most ${LIMITS.optionLength} characters`,
              );
          });
        } else if ("options" in field) {
          add(
            `$.project.fields.${name}.options`,
            "is only supported for SINGLE_SELECT",
          );
        }
      }
    }
    if (resourceMap(config.project.views, "$.project.views", LIMITS.views)) {
      for (const [name, view] of Object.entries(config.project.views)) {
        mapKey(name, "$.project.views", LIMITS.viewNameLength, "view name");
        if (!object(view, `$.project.views.${name}`)) continue;
        known(view, `$.project.views.${name}`, ["layout", "settings"]);
        if (!LAYOUTS.has(view.layout))
          add(`$.project.views.${name}.layout`, "must be BOARD or TABLE");
        if (
          "settings" in view &&
          object(view.settings, `$.project.views.${name}.settings`)
        ) {
          known(view.settings, `$.project.views.${name}.settings`, [
            "visibleFieldIds",
          ]);
          if ("visibleFieldIds" in view.settings) {
            if (
              array(
                view.settings.visibleFieldIds,
                `$.project.views.${name}.settings.visibleFieldIds`,
                LIMITS.viewSettings,
              )
            ) {
              unique(
                view.settings.visibleFieldIds,
                `$.project.views.${name}.settings.visibleFieldIds`,
                (fieldId) => fieldId,
                "must not duplicate a field ID",
              );
              view.settings.visibleFieldIds.forEach((fieldId, index) => {
                if (!hasLength(fieldId, 255) || !fieldId)
                  add(
                    `$.project.views.${name}.settings.visibleFieldIds[${index}]`,
                    "must be a non-empty GitHub node ID of at most 255 characters",
                  );
              });
            }
          }
        }
      }
    }
  }
  return errors;
}

function normalizeResourceMap(
  resources,
  identity,
  normalize = (value) => value,
) {
  return Object.keys(resources)
    .sort()
    .map((key) => ({ [identity]: key, ...normalize(resources[key]) }));
}

export function normalizeConfig(config) {
  return {
    ...config,
    requiredScopes: config.requiredScopes ?? (config.project ? ["repo", "project"] : ["repo"]),
    labels: normalizeResourceMap(config.labels ?? {}, "name", (label) => ({
      ...label,
      color: label.color.toUpperCase(),
      managed: label.managed === true,
    })),
    milestones: normalizeResourceMap(
      config.milestones ?? {},
      "title",
      (milestone) => ({ ...milestone, managed: milestone.managed === true }),
    ),
    files: normalizeResourceMap(config.files ?? {}, "destination"),
    templates: config.templates ? { ...config.templates } : null,
    project: config.project
      ? {
          ...config.project,
          fields: normalizeResourceMap(config.project.fields, "name"),
          views: normalizeResourceMap(config.project.views, "name"),
        }
      : null,
  };
}

export function normalizeRepositoryName(repository) {
  return typeof repository === "string" &&
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
    ? repository.toLowerCase()
    : null;
}

export function normalizeGitHubOrigin(origin) {
  const remote = typeof origin === "string" ? origin.trim() : "";
  const pathPattern = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i;
  const normalizeParts = (owner, repository) =>
    /\.git\./i.test(repository) ? null : `${owner}/${repository}`.toLowerCase();
  const sshMatch =
    /^(?:git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(
      remote,
    );
  if (sshMatch) return normalizeParts(sshMatch[1], sshMatch[2]);
  try {
    const url = new URL(remote);
    const authority = /^https:\/\/([^/?#]*)/i.exec(remote)?.[1] ?? "";
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== "github.com" ||
      url.port ||
      authority.includes("@") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    const httpsMatch = pathPattern.exec(url.pathname);
    return httpsMatch ? normalizeParts(httpsMatch[1], httpsMatch[2]) : null;
  } catch {
    return null;
  }
}

export function repositoryBindingMatches(repository, origin) {
  const configured = normalizeRepositoryName(repository);
  return configured !== null && configured === normalizeGitHubOrigin(origin);
}

export function resolveProjectByTitle(projects, title) {
  const matches = (projects ?? []).filter(
    (project) => project?.title === title,
  );
  if (matches.length > 1)
    throw new Error(
      `Duplicate GitHub Projects v2 title ${JSON.stringify(title)}; resolve titles before bootstrap`,
    );
  return matches[0] ?? null;
}

export function resolveProjectViewByName(views, name) {
  const matches = (views ?? []).filter((view) => view?.name === name);
  if (matches.length > 1)
    throw new Error(
      `Duplicate GitHub Projects v2 view name ${JSON.stringify(name)}; resolve duplicate configured views before bootstrap`,
    );
  return matches[0] ?? null;
}

export function mapProjectV2ViewLayout(layout) {
  const layouts = { BOARD: "BOARD_LAYOUT", TABLE: "TABLE_LAYOUT" };
  if (!Object.hasOwn(layouts, layout))
    throw new Error(
      `Unsupported configured GitHub Projects v2 view layout ${JSON.stringify(layout)}`,
    );
  return layouts[layout];
}

export function projectV2ViewConfiguration(view) {
  if (!view.settings || !Object.hasOwn(view.settings, "visibleFieldIds"))
    return undefined;
  return { visibleFieldIds: view.settings.visibleFieldIds };
}

export const CREATE_PROJECT_V2_VIEW_MUTATION =
  "mutation($input:CreateProjectV2ViewInput!) { createProjectV2View(input:$input) { projectV2View { id name layout } } }";

export function createProjectV2ViewArgs(projectId, view) {
  const args = [
    "api",
    "graphql",
    "-f",
    `query=${CREATE_PROJECT_V2_VIEW_MUTATION}`,
    "-F",
    `input[projectId]=${projectId}`,
    "-F",
    `input[name]=${view.name}`,
    "-F",
    `input[layout]=${mapProjectV2ViewLayout(view.layout)}`,
  ];
  const configuration = projectV2ViewConfiguration(view);
  for (const fieldId of configuration?.visibleFieldIds ?? []) {
    args.push("-F", `input[configuration][visibleFieldIds][]=${fieldId}`);
  }
  return args;
}

export function projectIdentity(project) {
  if (
    !project ||
    typeof project.id !== "string" ||
    !project.id ||
    !Number.isInteger(project.number) ||
    project.number < 1
  ) {
    throw new Error(
      "GitHub Projects v2 discovery did not return an exact project node and number identity",
    );
  }
  return { id: project.id, number: project.number, title: project.title };
}

function observedProjectFieldDataType(field) {
  return (
    field?.dataType ??
    (field?.type === "ProjectV2SingleSelectField" ? "SINGLE_SELECT" : null)
  );
}

export function projectFieldMatches(existing, configured) {
  if (observedProjectFieldDataType(existing) !== configured.dataType)
    return false;
  if (configured.dataType !== "SINGLE_SELECT") return true;
  if (
    !Array.isArray(existing.options) ||
    existing.options.length !== configured.options.length
  )
    return false;
  return configured.options.every((option, index) => {
    const current = existing.options[index];
    return (typeof current === "string" ? current : current?.name) === option;
  });
}

function isRepositoryRelativePath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= LIMITS.filePathLength &&
    !path.isAbsolute(value) &&
    !path.win32.isAbsolute(value) &&
    value.split(/[\\/]/).every((part) => part && part !== "." && part !== "..")
  );
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function lstatIfPresent(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

const approvedRoots = new Map();

function approvedRoot(repoDir) {
  const key = path.resolve(repoDir);
  if (!approvedRoots.has(key)) {
    const repoRoot = fs.realpathSync(repoDir);
    approvedRoots.set(key, { repoRoot, identity: fs.statSync(repoRoot) });
  }
  return approvedRoots.get(key);
}


function managedPath(repoDir, relativePath, role) {
  if (!isRepositoryRelativePath(relativePath))
    throw new Error(
      `${role} must be a repository-relative path without traversal: ${relativePath}`,
    );
  const repoRoot = fs.realpathSync(repoDir);
  const target = path.resolve(repoRoot, relativePath);
  if (!isWithin(repoRoot, target) || target === repoRoot)
    throw new Error(`${role} escapes repository root: ${relativePath}`);
  const components = path.relative(repoRoot, target).split(path.sep);
  let current = repoRoot;
  for (const [index, component] of components.entries()) {
    current = path.join(current, component);
    const entry = lstatIfPresent(current);
    if (entry?.isSymbolicLink())
      throw new Error(`${role} contains a symbolic link: ${relativePath}`);
    if (entry && index < components.length - 1 && !entry.isDirectory())
      throw new Error(`${role} parent is not a directory: ${relativePath}`);
    if (index === components.length - 1 && entry && !entry.isFile())
      throw new Error(`${role} is not a regular file: ${relativePath}`);
  }
  return { repoRoot, target, exists: lstatIfPresent(target) !== null };
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function configuredFiles(config) {
  const files = Array.isArray(config.files)
    ? config.files
    : Object.entries(config.files ?? {}).map(([destination, file]) => ({
        destination,
        ...file,
      }));
  return [...files].sort((left, right) =>
    left.destination.localeCompare(right.destination),
  );
}

function rejectConflictingDestinations(files, repoRoot) {
  for (const [index, file] of files.entries()) {
    const ancestor = path.resolve(repoRoot, file.destination);
    for (const descendantFile of files.slice(index + 1)) {
      const descendant = path.resolve(repoRoot, descendantFile.destination);
      if (isWithin(ancestor, descendant))
        throw new Error(
          `Managed file destination ${JSON.stringify(file.destination)} is an ancestor of ${JSON.stringify(descendantFile.destination)}`,
        );
    }
  }
}

export function preflightManagedFiles(config, repoDir, mutate = () => {}) {
  const root = approvedRoot(repoDir);
  const repoRoot = root.repoRoot;
  const configured = configuredFiles(config);
  rejectConflictingDestinations(configured, repoRoot);
  const files = configured.map((file) => {
    const source = managedPath(repoDir, file.source, "Managed file source");
    if (!source.exists)
      throw new Error(`Managed file source is missing: ${file.source}`);
    const destination = managedPath(
      repoDir,
      file.destination,
      "Managed file destination",
    );
    const sourceContent = fs.readFileSync(source.target);
    const destinationContent = destination.exists
      ? fs.readFileSync(destination.target)
      : null;
    return {
      ...file,
      sourceHash: sha256(sourceContent),
      destinationHash:
        destinationContent === null ? null : sha256(destinationContent),
      sourceContent,
      repoRoot,
      rootIdentity: root.identity,
      destinationTarget: destination.target,
    };
  });
  mutate();
  return files;
}

export function managedFileStates(config, repoDir) {
  return preflightManagedFiles(config, repoDir).map((file) => ({
    destination: file.destination,
    source: file.source,
    mode: file.mode,
    sourceHash: file.sourceHash,
    destinationHash: file.destinationHash,
  }));
}

function descriptorPath(descriptor, name = ".") {
  return `/proc/self/fd/${descriptor}/${name}`;
}

function requireDescriptorRelativeSupport() {
  const flags =
    fs.constants.O_RDONLY |
    fs.constants.O_DIRECTORY |
    fs.constants.O_NOFOLLOW;
  if (
    process.platform !== "linux" ||
    !fs.constants.O_DIRECTORY ||
    !fs.constants.O_NOFOLLOW
  )
    throw new Error(
      "Safe managed writes require Linux descriptor-relative filesystem support",
    );
  let descriptor;
  try {
    descriptor = fs.openSync("/proc/self/fd", flags);
    const probe = fs.openSync(descriptorPath(descriptor), flags);
    try {
      if (!sameFile(fs.fstatSync(descriptor), fs.fstatSync(probe)))
        throw new Error(
          "Safe managed writes cannot verify /proc descriptor traversal",
        );
    } finally {
      fs.closeSync(probe);
    }
  } catch (error) {
    throw new Error(
      "Safe managed writes require verified /proc descriptor traversal",
      { cause: error },
    );
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function openWriteDescriptor(repoRoot, rootIdentity, relativePath, exclusive) {
  requireDescriptorRelativeSupport();
  const flags =
    fs.constants.O_RDONLY |
    fs.constants.O_DIRECTORY |
    fs.constants.O_NOFOLLOW;
  let parent = fs.openSync(repoRoot, flags);
  let descriptor;
  try {
    if (!sameFile(rootIdentity, fs.fstatSync(parent)))
      throw new Error(
        "Managed repository root changed while opening its descriptor",
      );
    const components = relativePath.split(path.sep);
    for (const component of components.slice(0, -1)) {
      let next;
      try {
        next = fs.openSync(descriptorPath(parent, component), flags);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        try {
          fs.mkdirSync(descriptorPath(parent, component));
        } catch (mkdirError) {
          if (mkdirError.code !== "EEXIST") throw mkdirError;
        }
        next = fs.openSync(descriptorPath(parent, component), flags);
      }
      fs.closeSync(parent);
      parent = next;
    }
    const target = descriptorPath(parent, components.at(-1));
    const writeFlags = fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW;
    try {
      descriptor = fs.openSync(
        target,
        writeFlags |
          (exclusive ? fs.constants.O_CREAT | fs.constants.O_EXCL : 0),
        0o666,
      );
    } catch (error) {
      if (exclusive || error.code !== "ENOENT") throw error;
      descriptor = fs.openSync(
        target,
        writeFlags | fs.constants.O_CREAT | fs.constants.O_EXCL,
        0o666,
      );
    }
    if (!fs.fstatSync(descriptor).isFile())
      throw new Error(
        `Managed destination is not a regular file: ${relativePath}`,
      );
    return descriptor;
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    throw error;
  } finally {
    fs.closeSync(parent);
  }
}

function safeWriteFileNonLinux(
  repoRoot,
  rootIdentity,
  relativePath,
  content,
  exclusive,
) {
  // Step 1 — root-swap detection
  if (!sameFile(fs.statSync(repoRoot), rootIdentity))
    throw new Error(
      "Managed repository root changed while opening its descriptor",
    );

  const realRepoRoot = fs.realpathSync(repoRoot);
  const normalizedRelative = path.normalize(relativePath);
  const resolvedTarget = path.resolve(realRepoRoot, normalizedRelative);

  if (!isWithin(realRepoRoot, resolvedTarget) || resolvedTarget === realRepoRoot)
    throw new Error(`Managed file destination escapes repository root: ${relativePath}`);

  // Step 2 — walk ancestor components, reject symlinks, create missing parent dirs
  const relativeComponents = path.relative(realRepoRoot, resolvedTarget).split(path.sep);
  let cursor = realRepoRoot;
  for (const component of relativeComponents.slice(0, -1)) {
    cursor = path.join(cursor, component);
    let entry = lstatIfPresent(cursor);
    if (entry === null) {
      fs.mkdirSync(cursor, { recursive: false });
      entry = lstatIfPresent(cursor);
    }
    if (entry?.isSymbolicLink())
      throw new Error(
        `Managed file destination contains a symbolic link: ${relativePath}`,
      );
    if (!entry || !entry.isDirectory())
      throw new Error(
        `Managed file destination parent is not a directory: ${relativePath}`,
      );
    // Double check realpath containment for parent directory
    const realCursor = fs.realpathSync(cursor);
    if (!isWithin(realRepoRoot, realCursor))
      throw new Error(
        `Managed file destination parent escapes repository root: ${relativePath}`,
      );
  }

  // Step 3 — check the final component for symlinks
  const destination = resolvedTarget;
  const finalEntry = lstatIfPresent(destination);
  if (finalEntry?.isSymbolicLink())
    throw Object.assign(
      new Error(
        `Managed file destination contains a symbolic link: ${relativePath}`,
      ),
      { code: "ELOOP" },
    );

  // Step 4 — exclusive guard (atomic no-clobber check)
  if (exclusive && finalEntry !== null)
    throw Object.assign(
      new Error(`Managed file destination already exists: ${relativePath}`),
      { code: "EEXIST" },
    );

  // Step 5 — Atomic write via sibling temp file in validated parent directory, with permission preservation
  const tmp = destination + "." + Math.random().toString(36).slice(2) + ".tmp";
  let fd;
  try {
    fd = fs.openSync(
      tmp,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL,
      0o666,
    );
    fs.writeFileSync(fd, content);
    fs.closeSync(fd);
    fd = undefined;

    // Preserve existing file permissions if destination exists
    if (finalEntry !== null) {
      const existingMode = fs.statSync(destination).mode & 0o777;
      fs.chmodSync(tmp, existingMode);
    }

    fs.renameSync(tmp, destination);
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
    if (fs.existsSync(tmp)) {
      try {
        fs.unlinkSync(tmp);
      } catch {}
    }
  }
}

function safeWriteFile(
  repoRoot,
  rootIdentity,
  relativePath,
  content,
  exclusive,
) {
  if (process.platform === "linux") {
    const descriptor = openWriteDescriptor(
      repoRoot,
      rootIdentity,
      relativePath,
      exclusive,
    );
    try {
      fs.ftruncateSync(descriptor, 0);
      fs.writeFileSync(descriptor, content);
    } finally {
      fs.closeSync(descriptor);
    }
  } else {
    safeWriteFileNonLinux(
      repoRoot,
      rootIdentity,
      relativePath,
      content,
      exclusive,
    );
  }
}

export function writeManagedFile(file) {
  safeWriteFile(
    file.repoRoot,
    file.rootIdentity,
    file.destination,
    file.sourceContent,
    file.mode === "ensure" && file.destinationHash === null,
  );
}

export function templateDestination(repoDir, relativePath) {
  const { repoRoot, identity: rootIdentity } = approvedRoot(repoDir);
  const target = path.resolve(repoRoot, relativePath);
  if (!isWithin(repoRoot, target) || target === repoRoot)
    throw new Error(
      `Template destination escapes repository root: ${relativePath}`,
    );
  let current = repoRoot;
  for (const component of path.relative(repoRoot, target).split(path.sep)) {
    current = path.join(current, component);
    const entry = lstatIfPresent(current);
    if (entry?.isSymbolicLink())
      throw new Error(
        `Template destination contains a symbolic link: ${relativePath}`,
      );
  }
  return { repoRoot, rootIdentity, target, exists: lstatIfPresent(target) !== null };
}

export function writeTemplateFile(repoDir, relativePath, content) {
  const destination = templateDestination(repoDir, relativePath);
  safeWriteFile(
    destination.repoRoot,
    destination.rootIdentity,
    path.relative(destination.repoRoot, destination.target),
    content,
    false,
  );
  return destination.exists;
}

export function canonicalJson(value) {
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function authorizationValue({ config, target, observed, plan }) {
  const digest = createHash("sha256")
    .update(canonicalJson({ config, target, observed, plan }))
    .digest("hex");
  return `APPLY_GITHUB_PROJECT_BOOTSTRAP:${digest}`;
}

export function emptyReport(mode = "unknown") {
  return {
    schemaVersion: "github-project-bootstrap-report/v1",
    mode,
    authorization: {
      required: false,
      value: null,
      provided: null,
      authorized: false,
    },
    validation: {},
    discovered: {
      labels: 0,
      milestones: 0,
      templates: 0,
      files: 0,
      project: null,
      viewsSupported: null,
    },
    plan: [],
    completed: [],
    skipped: [],
    failures: [],
    success: false,
  };
}

function differs(actual, desired, keys) {
  return keys.some((key) => (actual[key] ?? null) !== (desired[key] ?? null));
}

function action(resource, target, actionName, reason, details = {}) {
  return { resource, target, action: actionName, reason, ...details };
}

function sortedByIdentity(resources, identity) {
  return [...resources].sort((left, right) => {
    if (left[identity] < right[identity]) return -1;
    if (left[identity] > right[identity]) return 1;
    return 0;
  });
}

export function buildPlan(config, observed = {}) {
  const plan = [];
  const labels = new Map(
    (observed.labels ?? []).map((label) => [label.name, label]),
  );
  for (const label of sortedByIdentity(config.labels, "name")) {
    const actual = labels.get(label.name);
    if (!actual) plan.push(action("label", label.name, "create", "missing"));
    else if (label.managed && differs(actual, label, ["color", "description"]))
      plan.push(
        action("label", label.name, "update", "explicitly managed and differs"),
      );
    else
      plan.push(
        action(
          "label",
          label.name,
          "skip",
          label.managed ? "already matches" : "existing resource is unmanaged",
        ),
      );
  }
  const milestones = new Map(
    (observed.milestones ?? []).map((milestone) => [
      milestone.title,
      milestone,
    ]),
  );
  for (const milestone of sortedByIdentity(config.milestones, "title")) {
    const actual = milestones.get(milestone.title);
    if (!actual)
      plan.push(action("milestone", milestone.title, "create", "missing"));
    else if (
      milestone.managed &&
      differs(actual, milestone, ["description", "dueOn"])
    )
      plan.push(
        action(
          "milestone",
          milestone.title,
          "update",
          "explicitly managed and differs",
        ),
      );
    else
      plan.push(
        action(
          "milestone",
          milestone.title,
          "skip",
          milestone.managed
            ? "already matches"
            : "existing resource is unmanaged",
        ),
      );
  }
  const files = new Map(
    (observed.files ?? []).map((file) => [file.destination, file]),
  );
  for (const file of sortedByIdentity(config.files, "destination")) {
    const actual = files.get(file.destination);
    const missing = !actual || actual.destinationHash === null;
    const differs = !missing && actual.destinationHash !== actual.sourceHash;
    let fileAction = "skip";
    let reason = "already matches source";
    if (missing) {
      fileAction = "create";
      reason = "missing";
    } else if (file.mode === "ensure") {
      reason = "existing file is unmanaged in ensure mode";
    } else if (differs) {
      fileAction = "update";
      reason = "managed replacement differs";
    }
    plan.push(action("file", file.destination, fileAction, reason));
  }
  const desiredTemplates = [];
  if (config.templates) {
    desiredTemplates.push(
      ".github/ISSUE_TEMPLATE/config.yml",
      ...config.templates.issueForms.map((name) =>
        path.posix.join(".github/ISSUE_TEMPLATE", `${name}.yml`),
      ),
    );
    if (config.templates.pullRequest)
      desiredTemplates.push(".github/pull_request_template.md");
  }
  const presentTemplates = new Set(observed.templates ?? []);
  for (const file of desiredTemplates) {
    const exists = presentTemplates.has(file);
    let templateAction = "create";
    if (exists) {
      if (config.templates.mode === "replace") templateAction = "update";
      else templateAction = "skip";
    }
    plan.push(
      action(
        "template",
        file,
        templateAction,
        exists ? `template mode is ${config.templates.mode}` : "missing",
      ),
    );
  }
  if (!config.project) return plan;
  const project = observed.project;
  if (project)
    plan.push(
      action(
        "project",
        config.project.title,
        "skip",
        "existing project identity is preserved",
        { projectId: project.id, projectNumber: project.number },
      ),
    );
  else plan.push(action("project", config.project.title, "create", "missing"));
  if (project?.linked)
    plan.push(
      action(
        "project-link",
        config.repository,
        "skip",
        "exact project is already linked",
        { projectId: project.id },
      ),
    );
  else
    plan.push(
      action(
        "project-link",
        config.repository,
        "link",
        project
          ? "exact project is not linked"
          : "created project must be linked",
      ),
    );
  const fields = new Map(
    (observed.fields ?? []).map((field) => [field.name, field]),
  );
  for (const field of sortedByIdentity(config.project.fields, "name")) {
    const existing = fields.get(field.name);
    if (existing && !projectFieldMatches(existing, field))
      throw new Error(
        `Existing project field ${JSON.stringify(field.name)} differs from managed configuration; reconcile it manually before bootstrap`,
      );
    plan.push(
      action(
        "project-field",
        field.name,
        existing ? "skip" : "create",
        existing ? "existing field matches managed configuration" : "missing",
      ),
    );
  }
  if (observed.viewsSupported === false) {
    for (const view of sortedByIdentity(config.project.views, "name"))
      plan.push(
        action(
          "project-view",
          view.name,
          "unsupported",
          "GitHub Projects v2 GraphQL view capability is unavailable",
        ),
      );
  } else {
    for (const view of sortedByIdentity(config.project.views, "name")) {
      const existing = resolveProjectViewByName(observed.views, view.name);
      plan.push(
        action(
          "project-view",
          view.name,
          existing ? "skip" : "create",
          existing ? "existing views are not updated" : "missing",
        ),
      );
    }
  }
  return plan;
}

export function parseOAuthScopes(headers) {
  const match = /\nx-oauth-scopes:\s*([^\r\n]*)/i.exec(`\n${headers}`);
  return match
    ? match[1]
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean)
    : [];
}
