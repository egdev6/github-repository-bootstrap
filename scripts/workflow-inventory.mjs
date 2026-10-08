// Read-only inventory of GitHub workflow and skill YAML for future linting.
//
// This module only discovers and classifies YAML paths. It never parses YAML
// beyond a fixed issue-template signature check, never executes YAML, and never
// follows symbolic links or Windows junctions: an inventory that silently
// skipped or escaped its roots would hide workflows from the linter it feeds.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LIVE_WORKFLOWS = [".github", "workflows"];
const TEMPLATE_SUFFIX = ["assets", "templates"];
const NO_WORKFLOWS = "no YAML workflows found under .github/workflows";

// The only issue-template files carved out of the lint set. The carve-out is
// exact-path only: the same basenames anywhere else, including
// .github/workflows, stay in scope.
const EXEMPT_FORMS = [
  "skills/github-repository-bootstrap/assets/templates/bug_report.yml",
  "skills/github-repository-bootstrap/assets/templates/feature_request.yml",
];
const EXEMPT_CONFIG = "skills/github-repository-bootstrap/assets/templates/config.yml";

export class WorkflowInventoryError extends Error {}

const toPosix = (root, absolute) => path.relative(root, absolute).split(path.sep).join("/");
const isYaml = (name) => name.endsWith(".yml") || name.endsWith(".yaml");

// Walk from `root` along `segments` without following links. Returns the final
// path and lstat, or null when an ancestor is missing. A link anywhere on the
// path is a hard failure: following it could read outside the repository.
function resolveUnlinked(root, segments) {
  let current = root;
  let stat = null;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new WorkflowInventoryError(`refusing to follow symbolic link: ${toPosix(root, current)}`);
    }
  }
  return { absolute: current, stat };
}

// Collect every YAML file below `directory`. Directory entries are lstat'd so a
// link is never traversed; unrelated non-YAML files are skipped by design.
function collectYaml(root, directory, result) {
  for (const entry of fs.readdirSync(directory)) {
    const absolute = path.join(directory, entry);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      throw new WorkflowInventoryError(`refusing to follow symbolic link: ${toPosix(root, absolute)}`);
    }
    if (stat.isDirectory()) collectYaml(root, absolute, result);
    else if (stat.isFile() && isYaml(entry)) result.push(toPosix(root, absolute));
  }
}

// Conservative fixed-signature checks, not a general YAML parser. Only plain,
// unquoted root keys count as the known shape, and any root-level `on`/`jobs`
// key (quoted or not) makes the file workflow-shaped and therefore in scope.
const plainRootKey = (key) => new RegExp(`^${key}\\s*:`, "m");
const WORKFLOW_ROOT_KEY = /^(?:"|')?(?:on|jobs)(?:"|')?\s*:/m;
const isExemptIssueForm = (text) =>
  plainRootKey("name").test(text) &&
  plainRootKey("description").test(text) &&
  plainRootKey("body").test(text) &&
  !WORKFLOW_ROOT_KEY.test(text);
const isExemptIssueConfig = (text) =>
  plainRootKey("blank_issues_enabled").test(text) && !WORKFLOW_ROOT_KEY.test(text);

function isExempt(root, relative) {
  const absolute = path.join(root, ...relative.split("/"));
  if (relative === EXEMPT_CONFIG) return isExemptIssueConfig(fs.readFileSync(absolute, "utf8"));
  if (EXEMPT_FORMS.includes(relative)) return isExemptIssueForm(fs.readFileSync(absolute, "utf8"));
  return false;
}

export function discoverWorkflows(root) {
  const live = resolveUnlinked(root, LIVE_WORKFLOWS);
  if (!live || !live.stat.isDirectory()) throw new WorkflowInventoryError(NO_WORKFLOWS);
  const liveFiles = [];
  collectYaml(root, live.absolute, liveFiles);
  if (liveFiles.length === 0) throw new WorkflowInventoryError(NO_WORKFLOWS);

  const templateFiles = [];
  const skills = resolveUnlinked(root, ["skills"]);
  if (skills && skills.stat.isDirectory()) {
    for (const entry of fs.readdirSync(skills.absolute)) {
      const entryPath = path.join(skills.absolute, entry);
      const entryStat = fs.lstatSync(entryPath);
      if (entryStat.isSymbolicLink()) {
        throw new WorkflowInventoryError(`refusing to follow symbolic link: ${toPosix(root, entryPath)}`);
      }
      // Only directories can hold `assets/templates`. Ordinary files such as a
      // skill index README are legitimate; lstat first so a link is refused
      // rather than silently skipped by a naive `existsSync`/`isDirectory`.
      if (!entryStat.isDirectory()) continue;
      const templates = resolveUnlinked(root, ["skills", entry, ...TEMPLATE_SUFFIX]);
      if (!templates) continue;
      if (!templates.stat.isDirectory()) {
        throw new WorkflowInventoryError(`template namespace is not a directory: ${toPosix(root, templates.absolute)}`);
      }
      collectYaml(root, templates.absolute, templateFiles);
    }
  }

  const discovered = [...liveFiles, ...templateFiles].filter((relative) => !isExempt(root, relative));
  return [...new Set(discovered)].sort();
}

// A CLI is the entry point when Node resolved the module URL to the same file
// `process.argv[1]` names. Comparing canonical filesystem identities keeps the
// import inert and still runs through directory aliases and `node -e` shapes.
function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

export function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  try {
    process.stdout.write(`${JSON.stringify(discoverWorkflows(root))}\n`);
    return 0;
  } catch (error) {
    // Classified, path-relative messages only: never echo YAML source or an
    // absolute (possibly private) repository path.
    const message = error instanceof WorkflowInventoryError ? error.message : "workflow inventory failed";
    process.stderr.write(`workflow-inventory: ${message}\n`);
    process.exitCode = 1;
    return 1;
  }
}

if (isEntryPoint()) {
  main();
}
