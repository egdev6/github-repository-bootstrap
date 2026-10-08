// Read-only actionlint runner over the discovered workflow inventory.
//
// It discovers YAML with the published inventory API, runs a caller-supplied
// verified actionlint binary against an owned empty config, and never writes to
// the repository, executes workflow YAML, or echoes workflow source.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { discoverWorkflows } from "./workflow-inventory.mjs";

const TIMEOUT_MS = 30_000;
const MAX_BUFFER = 10 * 1024 * 1024;
// Go template over the error slice: path, position and kind only, never source
// text or the message. actionlint expands the literal `\n` below into a newline.
const FORMAT = "{{range .}}{{.Filepath}}:{{.Line}}:{{.Column}}:{{.Kind}}\\n{{end}}";

export class WorkflowLintError extends Error {}

function assertBinary(binary) {
  if (typeof binary !== "string" || !path.isAbsolute(binary)) {
    throw new WorkflowLintError("ACTIONLINT_BIN must be an absolute path");
  }
  if (!fs.existsSync(binary) || !fs.statSync(binary).isFile()) {
    throw new WorkflowLintError("ACTIONLINT_BIN does not exist");
  }
  return binary;
}

// An owned empty config ('{}') keeps a repository .github/actionlint.yaml ignore
// from hiding findings; the temp file is removed and never touches the repo.
function ownedConfig() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actionlint-config-"));
  const config = path.join(directory, "actionlint.yaml");
  fs.writeFileSync(config, "{}\n");
  return { directory, config };
}

export function lintWorkflows(root, binary) {
  assertBinary(binary);
  const files = discoverWorkflows(root);
  const { directory, config } = ownedConfig();
  try {
    const result = spawnSync(binary, ["-config-file", config, "-format", FORMAT, ...files], {
      cwd: root,
      encoding: "utf8",
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      shell: false,
    });
    if (result.error) throw new WorkflowLintError("actionlint could not start");
    if (result.signal) throw new WorkflowLintError("actionlint was terminated");
    if (result.status === null) throw new WorkflowLintError("actionlint returned no status");
    return { status: result.status, diagnostics: result.stdout };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

// Inert on import: a CLI runs only when Node resolves this module to argv[1].
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
    const { status, diagnostics } = lintWorkflows(root, process.env.ACTIONLINT_BIN);
    if (diagnostics) process.stdout.write(diagnostics);
    process.exitCode = status;
    return status;
  } catch (error) {
    const message = error instanceof WorkflowLintError ? error.message : "workflow lint failed";
    process.stderr.write(`lint-workflows: ${message}\n`);
    process.exitCode = 1;
    return 1;
  }
}

if (isEntryPoint()) {
  main();
}
