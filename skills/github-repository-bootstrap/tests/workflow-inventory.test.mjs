import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { discoverWorkflows } from "../../../scripts/workflow-inventory.mjs";

// Behavioral contract for the read-only workflow inventory. Every fixture is a
// throwaway repository under the OS temp directory; nothing here touches the
// real repository, Git state, GitHub, or the network. Child processes are
// bounded and run without an inherited NODE_TEST_CONTEXT so the nested CLI is
// never skipped.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const productionModule = path.join(repoRoot, "scripts/workflow-inventory.mjs");
const productionSource = fs.readFileSync(productionModule, "utf8");
const ENTRY_GUARD = "if (isEntryPoint()) {";
const RUN_OPTIONS = { timeout: 10_000, encoding: "utf8", maxBuffer: 1_000_000 };
const runnerEnv = { ...process.env };
delete runnerEnv.NODE_TEST_CONTEXT;

const tempDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const remove = (...directories) => directories.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
const write = (base, relative, content) => {
  const target = path.join(base, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
};

// Fixed known-signature issue templates. They carry only the shape the
// exemption recognizes: plain root name/description/body (labels optional).
const FORM_BUG = ["name: Bug report", "description: Report a problem", "labels: __LABELS__", "body:", "  - type: textarea", "    id: description"].join("\n") + "\n";
const FORM_FEATURE = ["name: Feature request", "description: Propose a change", "body:", "  - type: textarea", "    id: proposal"].join("\n") + "\n";
const FORM_CONFIG = "blank_issues_enabled: false\n";
const EXEMPT_DIR = "skills/github-repository-bootstrap/assets/templates";
const writeKnownForms = (base, eol = "\n") => {
  write(base, `${EXEMPT_DIR}/bug_report.yml`, FORM_BUG.replace(/\n/g, eol));
  write(base, `${EXEMPT_DIR}/feature_request.yml`, FORM_FEATURE.replace(/\n/g, eol));
  write(base, `${EXEMPT_DIR}/config.yml`, FORM_CONFIG.replace(/\n/g, eol));
};

test("the live repository exposes the release workflow without exempt forms", () => {
  const discovered = discoverWorkflows(repoRoot);
  assert.ok(discovered.includes(".github/workflows/release.yml"), "the release workflow must be inventoried");
  for (const exempt of [
    "skills/github-repository-bootstrap/assets/templates/bug_report.yml",
    "skills/github-repository-bootstrap/assets/templates/feature_request.yml",
    "skills/github-repository-bootstrap/assets/templates/config.yml",
  ]) {
    assert.ok(!discovered.includes(exempt), `${exempt} must stay exempt`);
  }
  assert.deepEqual(discovered, [...discovered].sort(), "inventory paths must be sorted");
  for (const relative of discovered) {
    assert.ok(!path.isAbsolute(relative), `${relative} must be repository-relative`);
    assert.ok(!relative.includes("\\"), `${relative} must use forward slashes`);
    assert.match(relative, /\.ya?ml$/, `${relative} must be YAML`);
  }
});

test("known issue templates are exempt while unknown YAML is always included and sorted", () => {
  const base = tempDir("inventory-scope-");
  try {
    write(base, ".github/workflows/ci.yml", "name: CI\n");
    writeKnownForms(base);
    write(base, `${EXEMPT_DIR}/issue-lifecycle.yml`, "just: data\n");
    write(base, "skills/future-advisor/assets/templates/notes.yaml", "not: a workflow\n");
    write(base, "skills/future-advisor/assets/templates/nested/deep/extra.yml", "broken: [unclosed\n");
    assert.deepEqual(discoverWorkflows(base), [
      ".github/workflows/ci.yml",
      "skills/future-advisor/assets/templates/nested/deep/extra.yml",
      "skills/future-advisor/assets/templates/notes.yaml",
      "skills/github-repository-bootstrap/assets/templates/issue-lifecycle.yml",
    ]);
  } finally {
    remove(base);
  }
});

test("a workflow-shaped file at an exempt path is included, never silently exempt", () => {
  for (const eol of ["\n", "\r\n"]) {
    for (const key of ["on", '"on"', "'on'"]) {
      const base = tempDir("inventory-hijack-");
      try {
        write(base, ".github/workflows/ci.yml", "name: CI\n");
        const hijack = ["name: hijack", "description: hijack", "body:", "  - type: textarea", `${key}: push`, "jobs: {}"].join(eol) + eol;
        write(base, `${EXEMPT_DIR}/bug_report.yml`, hijack);
        assert.deepEqual(discoverWorkflows(base), [
          ".github/workflows/ci.yml",
          `${EXEMPT_DIR}/bug_report.yml`,
        ], `${eol === "\r\n" ? "CRLF" : "LF"} ${key} must be linted`);
      } finally {
        remove(base);
      }
    }
  }
});

test("a noncanonical form and a workflows-scoped form basename both stay in scope", () => {
  const base = tempDir("inventory-shape-");
  try {
    write(base, ".github/workflows/bug_report.yml", FORM_BUG);
    write(base, `${EXEMPT_DIR}/feature_request.yml`, ['"name": Feature request', "description: x", "body:", "  - type: textarea"].join("\n") + "\n");
    write(base, `${EXEMPT_DIR}/bug_report.yml`, FORM_BUG);
    write(base, `${EXEMPT_DIR}/config.yml`, FORM_CONFIG);
    assert.deepEqual(discoverWorkflows(base), [
      ".github/workflows/bug_report.yml",
      `${EXEMPT_DIR}/feature_request.yml`,
    ]);
  } finally {
    remove(base);
  }
});

test("known issue templates stay exempt with LF and CRLF endings", () => {
  for (const eol of ["\n", "\r\n"]) {
    const base = tempDir("inventory-eol-");
    try {
      write(base, ".github/workflows/ci.yml", "name: CI\n");
      writeKnownForms(base, eol);
      assert.deepEqual(discoverWorkflows(base), [".github/workflows/ci.yml"], eol === "\r\n" ? "CRLF" : "LF");
    } finally {
      remove(base);
    }
  }
});

test("a missing or empty live workflow directory fails closed", () => {
  const base = tempDir("inventory-live-");
  try {
    assert.throws(() => discoverWorkflows(base), /no YAML workflows found/);
    fs.mkdirSync(path.join(base, ".github", "workflows"), { recursive: true });
    assert.throws(() => discoverWorkflows(base), /no YAML workflows found/);
    write(base, ".github/workflows/readme.txt", "not yaml\n");
    assert.throws(() => discoverWorkflows(base), /no YAML workflows found/);
  } finally {
    remove(base);
  }
});

test("symlinked workflow roots, child directories, and files fail instead of escaping", () => {
  const rootBase = tempDir("inventory-root-");
  const rootTarget = tempDir("inventory-root-target-");
  const childBase = tempDir("inventory-child-");
  const childTarget = tempDir("inventory-child-target-");
  try {
    write(rootTarget, "ci.yml", "name: CI\n");
    fs.mkdirSync(path.join(rootBase, ".github"), { recursive: true });
    fs.symlinkSync(rootTarget, path.join(rootBase, ".github", "workflows"), process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => discoverWorkflows(rootBase), /refusing to follow symbolic link/);

    write(childBase, ".github/workflows/ci.yml", "name: CI\n");
    write(childTarget, "escaped.yml", "name: escaped\n");
    const childLink = path.join(childBase, ".github", "workflows", "escape");
    fs.symlinkSync(childTarget, childLink, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => discoverWorkflows(childBase), /refusing to follow symbolic link/);
    fs.unlinkSync(childLink);
    // A file symlink needs elevation on Windows, so only the POSIX job adds one.
    if (process.platform !== "win32") {
      fs.symlinkSync(path.join(childTarget, "escaped.yml"), path.join(childBase, ".github", "workflows", "escaped.yml"), "file");
      assert.throws(() => discoverWorkflows(childBase), /refusing to follow symbolic link/);
    }
  } finally {
    remove(rootBase, rootTarget, childBase, childTarget);
  }
});

test("a symlinked or non-directory template namespace fails", () => {
  const base = tempDir("inventory-namespace-");
  const target = tempDir("inventory-namespace-target-");
  try {
    write(base, ".github/workflows/ci.yml", "name: CI\n");
    write(base, "skills/no-templates/SKILL.md", "# no template namespace\n");
    assert.deepEqual(discoverWorkflows(base), [".github/workflows/ci.yml"], "a missing namespace is optional");
    write(base, "skills/not-a-directory/assets/templates", "plain file\n");
    assert.throws(() => discoverWorkflows(base), /not a directory/);
    remove(path.join(base, "skills/not-a-directory"));
    fs.mkdirSync(path.join(base, "skills/linked/assets"), { recursive: true });
    fs.symlinkSync(target, path.join(base, "skills/linked/assets/templates"), process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => discoverWorkflows(base), /refusing to follow symbolic link/);
    // A symlinked skill entry itself must be refused, never skipped as a
    // non-directory; a broken link must still be refused, so no existsSync.
    remove(path.join(base, "skills/linked"));
    fs.symlinkSync(target, path.join(base, "skills/linked-skill"), process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => discoverWorkflows(base), /refusing to follow symbolic link/, "a symlinked skill entry must be refused");
    if (process.platform !== "win32") {
      fs.unlinkSync(path.join(base, "skills/linked-skill"));
      fs.symlinkSync(path.join(target, "missing"), path.join(base, "skills/broken-skill"), "dir");
      assert.throws(() => discoverWorkflows(base), /refusing to follow symbolic link/, "a broken skill link must still be refused");
    }
  } finally {
    remove(base, target);
  }
});

test("ordinary non-directory skill entries are skipped, not read as namespaces", () => {
  const base = tempDir("inventory-skills-file-");
  try {
    write(base, ".github/workflows/ci.yml", "name: CI\n");
    write(base, "skills/README.md", "# Skills index\n");
    write(base, "skills/future-advisor/assets/templates/notes.yml", "not: a workflow\n");
    assert.deepEqual(discoverWorkflows(base), [
      ".github/workflows/ci.yml",
      "skills/future-advisor/assets/templates/notes.yml",
    ]);
  } finally {
    remove(base);
  }
});

test("non-YAML files and unrelated directories never enter the inventory", () => {
  const base = tempDir("inventory-skip-");
  try {
    write(base, ".github/workflows/ci.yml", "name: CI\n");
    write(base, ".github/workflows/README.md", "documentation\n");
    write(base, ".github/workflows/notes.txt", "documentation\n");
    write(base, ".pi-lens-probe-home/owned/config.yml", "name: owned\n");
    write(base, "docs/example.yml", "name: documentation\n");
    assert.deepEqual(discoverWorkflows(base), [".github/workflows/ci.yml"]);
  } finally {
    remove(base);
  }
});

test("the CLI resolves the repository from its own module path, not the cwd", () => {
  const cwd = tempDir("inventory-cwd-");
  try {
    const result = spawnSync(process.execPath, [productionModule], { cwd, env: runnerEnv, ...RUN_OPTIONS });
    assert.equal(result.error, undefined, "the CLI must spawn");
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), discoverWorkflows(repoRoot));
    assert.equal(result.stderr, "");
  } finally {
    remove(cwd);
  }
});

const importModule = (entry, cwd, extraArgs = []) => {
  const script = `await import(${JSON.stringify(pathToFileURL(entry).href)});`;
  return spawnSync(process.execPath, ["--input-type=module", "-e", script, ...extraArgs], { cwd, env: runnerEnv, ...RUN_OPTIONS });
};

test("importing the module is inert and the entry guard survives the -e argument shape", () => {
  const cwd = tempDir("inventory-import-");
  try {
    const imported = importModule(productionModule, cwd);
    assert.equal(imported.error, undefined, "importing must not fail to spawn");
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(imported.stdout, "", "import must not run the CLI");
    assert.equal(imported.stderr, "", "import must not print");
    const withArgument = importModule(productionModule, cwd, ["unrelated-argv-argument"]);
    assert.equal(withArgument.error, undefined, "an extra argv entry must not fail to spawn");
    assert.equal(withArgument.status, 0, withArgument.stderr);
    assert.equal(withArgument.stdout, "", "an extra argv entry must not run the CLI");

    // Controlled mutation: a lost guard would eagerly fail closed in the copied
    // project, so the CLI output is what proves the inert assertion above lives.
    const copied = path.join(cwd, "scripts", "workflow-inventory.mjs");
    fs.mkdirSync(path.dirname(copied), { recursive: true });
    fs.writeFileSync(copied, productionSource.replace(ENTRY_GUARD, "{"));
    const eager = importModule(copied, cwd);
    assert.notEqual(eager.status, 0, "a lost guard must run the CLI");
    assert.match(eager.stderr, /workflow-inventory: no YAML workflows found/, "a lost guard must surface the CLI failure");
  } finally {
    remove(cwd);
  }
});

test("an aliased CLI path still runs through canonical filesystem identity", () => {
  const base = tempDir("inventory-alias-");
  const cwd = tempDir("inventory-alias-cwd-");
  try {
    const project = path.join(base, "real");
    fs.mkdirSync(path.join(project, "scripts"), { recursive: true });
    fs.copyFileSync(productionModule, path.join(project, "scripts", "workflow-inventory.mjs"));
    write(project, ".github/workflows/ci.yml", "name: CI\n");
    const alias = path.join(base, "alias");
    fs.symlinkSync(project, alias, process.platform === "win32" ? "junction" : "dir");
    const result = spawnSync(process.execPath, [path.join(alias, "scripts", "workflow-inventory.mjs")], { cwd, env: runnerEnv, ...RUN_OPTIONS });
    assert.equal(result.error, undefined, "the aliased CLI must spawn");
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [".github/workflows/ci.yml"]);
  } finally {
    remove(base, cwd);
  }
});
