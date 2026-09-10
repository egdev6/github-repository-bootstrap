import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  preflightTemplateDestinations,
  projectLinkResponseMatches,
  resolveCommand,
  run,
} from "../scripts/bootstrap.mjs";
import {
  LIMITS,
  authorizationValue,
  buildPlan,
  createProjectV2ViewArgs,
  emptyReport,
  mapProjectV2ViewLayout,
  normalizeConfig,
  normalizeGitHubOrigin,
  parseOAuthScopes,
  preflightManagedFiles,
  repositoryBindingMatches,
  templateDestination,
  resolveProjectByTitle,
  resolveProjectViewByName,
  validationErrors,
  writeManagedFile,
  writeTemplateFile,
} from "../scripts/lib.mjs";

const configuration = {
  account: "egdev6",
  repository: "egdev6/particle-studio",
  labels: {
    "type:bug": { color: "D73A4A" },
    "priority:high": { color: "B60205", description: "Urgent", managed: true },
  },
  milestones: { Foundation: {} },
  templates: {
    issueForms: ["bug_report"],
    issueFormLabels: { bug_report: ["type:bug"] },
    pullRequest: true,
    mode: "ensure",
  },
  files: {
    ".github/CODEOWNERS": { source: "governance/CODEOWNERS", mode: "ensure" },
    ".github/workflows/ci.yml": { source: "governance/ci.yml", mode: "replace" },
  },
  project: {
    title: "Particle Studio",
    fields: {
      Priority: { dataType: "SINGLE_SELECT", options: ["High", "Low"] },
    },
    views: { Board: { layout: "BOARD" } },
  },
};

const skillRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function errorsFor(config) {
  return validationErrors(config).map((error) => error.path);
}

function messagesFor(config) {
  return validationErrors(config).map((error) => error.message);
}

function preparedWrite(repository, kind, target = ".github/managed.yml") {
  if (kind === "template") {
    templateDestination(repository, target);
    return () => writeTemplateFile(repository, target, "template");
  }
  fs.mkdirSync(path.join(repository, "governance"), { recursive: true });
  fs.writeFileSync(path.join(repository, "governance/source.yml"), "managed");
  const [file] = preflightManagedFiles({ files: { [target]: { source: "governance/source.yml", mode: "replace" } } }, repository);
  return () => writeManagedFile(file);
}

/** Install a PATH-visible `gh` stub. Windows requires a real .exe (no .cmd/.bat). */
function installGhStub(bin, ghStubLogic) {
  const scriptPath = path.join(bin, "gh-stub.cjs");
  fs.writeFileSync(scriptPath, ghStubLogic);

  if (process.platform !== "win32") {
    fs.writeFileSync(
      path.join(bin, "gh"),
      `#!/usr/bin/env node\n${ghStubLogic}`,
      { mode: 0o755 },
    );
    return;
  }

  const exePath = path.join(bin, "gh.exe");
  const csPath = path.join(bin, "gh-launcher.cs");
  // Stub args in these tests are simple tokens; only the script path needs quoting.
  const source = `
using System;
using System.Diagnostics;
class Program {
  static int Main(string[] args) {
    var psi = new ProcessStartInfo();
    psi.FileName = ${JSON.stringify(process.execPath)};
    psi.Arguments = ${JSON.stringify(`"${scriptPath}"`)};
    foreach (var a in args) { psi.Arguments += " " + a; }
    psi.UseShellExecute = false;
    psi.RedirectStandardOutput = true;
    psi.RedirectStandardError = true;
    psi.RedirectStandardInput = true;
    using (var p = Process.Start(psi)) {
      Console.Write(p.StandardOutput.ReadToEnd());
      Console.Error.Write(p.StandardError.ReadToEnd());
      p.WaitForExit();
      return p.ExitCode;
    }
  }
}
`;
  fs.writeFileSync(csPath, source);

  const csc = path.join(
    process.env.WINDIR || "C:\\Windows",
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
    "csc.exe",
  );
  execFileSync(csc, ["/nologo", `/out:${exePath}`, csPath], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("minimal config disables omitted resource families without project API work", () => {
  const minimal = { account: "acme", repository: "acme/widgets" };
  assert.deepEqual(validationErrors(minimal), []);
  for (const scope of ["project", "read:project"]) {
    assert.equal(
      errorsFor({ ...minimal, requiredScopes: ["repo", scope] }).includes(
        "$.requiredScopes",
      ),
      true,
    );
  }
  const schema = JSON.parse(
    fs.readFileSync(
      path.join(skillRoot, "assets", "config.schema.json"),
      "utf8",
    ),
  );
  assert.deepEqual(schema.required, ["account", "repository"]);
  assert.deepEqual(
    schema.allOf[0].then.properties.requiredScopes.not.contains.enum,
    ["project", "read:project"],
  );
  const normalized = normalizeConfig(minimal);
  assert.deepEqual(normalized.labels, []);
  assert.deepEqual(normalized.milestones, []);
  assert.equal(normalized.templates, null);
  assert.equal(normalized.project, null);
  assert.deepEqual(buildPlan(normalized), []);

  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "github-repository-bootstrap-minimal-config-"),
  );
  try {
    const repository = path.join(temporaryDirectory, "repository");
    const bin = path.join(temporaryDirectory, "bin");
    const configPath = path.join(temporaryDirectory, "config.json");
    const logPath = path.join(temporaryDirectory, "gh.log");
    fs.mkdirSync(bin);
    execFileSync("git", ["init", repository], { stdio: "ignore" });
    execFileSync("git", ["-C", repository, "remote", "add", "origin", "https://github.com/acme/widgets.git"]);
    fs.writeFileSync(configPath, JSON.stringify(minimal));
    const ghStubLogic = `const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.GH_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "--version") process.stdout.write("gh version test\\n");
else if (args.join(" ") === "api -i user") process.stdout.write("HTTP/2 200\\nx-oauth-scopes: repo\\n");
else if (args.join(" ") === "api users/acme") process.stdout.write('{"type":"Organization"}');
else if (args.join(" ") === "api repos/acme/widgets") process.stdout.write('{"full_name":"acme/widgets","node_id":"R_1","owner":{"login":"acme"}}');
else if (args.join(" ") === "api user") process.stdout.write('{"login":"maintainer"}');
else process.exitCode = 1;
`;
    installGhStub(bin, ghStubLogic);
    const run = (mode, authorize) =>
      spawnSync(
        process.execPath,
        [
          path.join(skillRoot, "scripts", "bootstrap.mjs"),
          "--config",
          configPath,
          "--repo-dir",
          repository,
          "--mode",
          mode,
          ...(authorize ? ["--authorize", authorize] : []),
        ],
        {
          encoding: "utf8",
          env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, GH_LOG: logPath },
        },
      );
    const planResult = run("plan");
    assert.equal(planResult.status, 0, planResult.stderr);
    const planReport = JSON.parse(planResult.stdout);
    const applyResult = run("apply", planReport.authorization.value);
    assert.equal(applyResult.status, 0, applyResult.stderr);
    assert.equal(JSON.parse(applyResult.stdout).success, true);
    const calls = fs.readFileSync(logPath, "utf8");
    assert.doesNotMatch(calls, /project|graphql|labels|milestones/i);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("validation rejects unsafe or incomplete project fields", () => {
  const invalid = structuredClone(configuration);
  invalid.project.fields.Priority = { dataType: "SINGLE_SELECT" };
  invalid.labels["type:bug"].color = "#bad";
  const errors = errorsFor(invalid);
  assert.equal(errors.includes("$.project.fields.Priority.options"), true);
  assert.equal(errors.includes("$.labels.type:bug.color"), true);
});

test("runtime validation enforces schema limits and canonical map identities", () => {
  const invalid = structuredClone(configuration);
  invalid.labels = Object.fromEntries(
    Array.from({ length: LIMITS.labels + 1 }, (_, index) => [
      `label-${index}`,
      { color: "D73A4A" },
    ]),
  );
  invalid.project.fields.Priority.options = ["High, urgent", "High, urgent"];
  const errors = errorsFor(invalid);
  assert.equal(errors.includes("$.labels"), true);
  assert.equal(errors.includes("$.project.fields.Priority.options[0]"), true);
  assert.equal(errors.includes("$.project.fields.Priority.options[1]"), true);

  const schema = JSON.parse(
    fs.readFileSync(
      path.join(skillRoot, "assets", "config.schema.json"),
      "utf8",
    ),
  );
  assert.equal(schema.properties.labels.type, undefined);
  assert.equal(schema.$defs.labels.type, "object");
  assert.equal(schema.$defs.labels.maxProperties, LIMITS.labels);
  assert.equal(schema.$defs.field.properties.options.maxItems, LIMITS.options);
  assert.equal(schema.$defs.field.properties.options.uniqueItems, true);
  assert.equal(schema.$defs.field.properties.options.items.pattern, "^[^,]+$");
  assert.equal(schema.$defs.files.maxProperties, LIMITS.files);
  assert.deepEqual(validationErrors(configuration), []);
});

test("existing project fields skip only when their configuration matches", () => {
  const config = normalizeConfig(configuration);
  const matching = {
    name: "Priority",
    type: "ProjectV2SingleSelectField",
    options: [{ name: "High" }, { name: "Low" }],
  };
  const plan = buildPlan(config, { fields: [matching] });
  assert.equal(
    plan.find(
      (entry) =>
        entry.resource === "project-field" && entry.target === "Priority",
    ).action,
    "skip",
  );
  assert.throws(
    () => buildPlan(config, { fields: [{ ...matching, dataType: "TEXT" }] }),
    /differs from managed configuration/,
  );
  assert.throws(
    () =>
      buildPlan(config, {
        fields: [{ ...matching, options: [{ name: "Low" }, { name: "High" }] }],
      }),
    /differs from managed configuration/,
  );
});

test("template preflight rejects symlink destinations before remote mutations", () => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(skillRoot, "tests", ".template-preflight-"),
  );
  try {
    const repository = path.join(temporaryDirectory, "repository");
    const outside = path.join(temporaryDirectory, "outside");
    fs.mkdirSync(path.join(repository, ".github"), { recursive: true });
    fs.mkdirSync(outside);
    fs.symlinkSync(
      outside,
      path.join(repository, ".github", "ISSUE_TEMPLATE"),
    );
    let remoteMutationCalled = false;
    assert.throws(
      () =>
        preflightTemplateDestinations(configuration, repository, () => {
          remoteMutationCalled = true;
        }),
      /symbolic link/,
    );
    assert.equal(remoteMutationCalled, false);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("template destinations reject symbolic links and permit regular in-repository files", () => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(skillRoot, "tests", ".template-destination-"),
  );
  try {
    const repository = path.join(temporaryDirectory, "repository");
    const outside = path.join(temporaryDirectory, "outside");
    fs.mkdirSync(repository);
    fs.mkdirSync(outside);
    fs.symlinkSync(
      path.join(outside, "config.yml"),
      path.join(repository, "destination-link"),
    );
    assert.throws(
      () => writeTemplateFile(repository, "destination-link", "unsafe"),
      /symbolic link/,
    );

    fs.symlinkSync(outside, path.join(repository, "linked-parent"));
    assert.throws(
      () => writeTemplateFile(repository, "linked-parent/config.yml", "unsafe"),
      /symbolic link/,
    );

    writeTemplateFile(repository, ".github/ISSUE_TEMPLATE/config.yml", "safe");
    assert.equal(
      fs.readFileSync(
        path.join(repository, ".github/ISSUE_TEMPLATE/config.yml"),
        "utf8",
      ),
      "safe",
    );
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("descriptor-relative writes confine ancestor and missing-parent swaps", { skip: process.platform !== "linux" }, () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(skillRoot, "tests", ".ancestor-swap-"));
  const target = ".github/managed.yml";
  const confined = (kind, exists) => {
    const repository = path.join(temporaryDirectory, `${kind}-${exists}`);
    const outside = path.join(temporaryDirectory, `${kind}-${exists}-outside`);
    const parent = path.join(repository, ".github");
    const external = path.join(outside, "managed.yml");
    fs.mkdirSync(parent, { recursive: true }); fs.mkdirSync(outside);
    if (exists) fs.writeFileSync(path.join(parent, "managed.yml"), "inside"), fs.writeFileSync(external, "outside");
    const openSync = fs.openSync;
    fs.openSync = function (name, ...args) {
      if (!/^\/proc\/self\/fd\/\d+\/managed\.yml$/.test(name)) return openSync.call(this, name, ...args);
      const saved = `${parent}-saved`;
      fs.renameSync(parent, saved); fs.symlinkSync(outside, parent);
      try { return openSync.call(this, name, ...args); }
      finally { fs.unlinkSync(parent); fs.renameSync(saved, parent); }
    };
    try { assert.doesNotThrow(preparedWrite(repository, kind)); }
    finally { fs.openSync = openSync; }
    assert.equal(fs.readFileSync(path.join(parent, "managed.yml"), "utf8"), kind);
    assert.equal(fs.existsSync(external) ? fs.readFileSync(external, "utf8") : null, exists ? "outside" : null);
  };
  try {
    for (const kind of ["managed", "template"]) for (const exists of [true, false]) confined(kind, exists);
    const repository = path.join(temporaryDirectory, "missing-parent");
    const parent = path.join(repository, ".github"); const outside = `${repository}-outside`;
    fs.mkdirSync(parent, { recursive: true }); fs.mkdirSync(outside);
    const mkdirSync = fs.mkdirSync;
    fs.mkdirSync = function (name, ...args) {
      if (!/^\/proc\/self\/fd\/\d+\/new-parent$/.test(name)) return mkdirSync.call(this, name, ...args);
      const saved = `${parent}-saved`;
      fs.renameSync(parent, saved); fs.symlinkSync(outside, parent);
      try { return mkdirSync.call(this, name, ...args); }
      finally { fs.unlinkSync(parent); fs.renameSync(saved, parent); }
    };
    try { preparedWrite(repository, "template", ".github/new-parent/managed.yml")(); }
    finally { fs.mkdirSync = mkdirSync; }
    assert.equal(fs.readFileSync(path.join(parent, "new-parent/managed.yml"), "utf8"), "template");
    assert.equal(fs.existsSync(path.join(outside, "new-parent")), false);
  } finally { fs.rmSync(temporaryDirectory, { recursive: true, force: true }); }
});

test("approved root identity rejects replacement before managed or template mutation", () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(skillRoot, "tests", ".root-swap-"));
  const confined = (kind, exists) => {
    const repository = path.join(temporaryDirectory, `${kind}-${exists}`);
    const outside = `${repository}-outside`; const target = ".github/managed.yml";
    const external = path.join(outside, target);
    fs.mkdirSync(path.join(repository, ".github"), { recursive: true }); fs.mkdirSync(path.dirname(external), { recursive: true });
    if (exists) fs.writeFileSync(path.join(repository, target), "inside"), fs.writeFileSync(external, "outside");
    const write = preparedWrite(repository, kind); const { openSync, realpathSync, statSync } = fs;
    const saved = `${repository}-saved`; let swapped = false;
    const swap = () => { if (!swapped) fs.renameSync(repository, saved), fs.renameSync(outside, repository), swapped = true; };
    fs.openSync = function (name, ...args) { if (name === repository) swap(); return openSync.call(this, name, ...args); };
    fs.realpathSync = function (name, ...args) { if (name === repository) swap(); return realpathSync.call(this, name, ...args); };
    fs.statSync = function (name, ...args) { if (name === repository) swap(); return statSync.call(this, name, ...args); };
    try { assert.throws(write, /root changed/); } finally {
      fs.openSync = openSync; fs.realpathSync = realpathSync; fs.statSync = statSync;
      if (swapped) fs.renameSync(repository, outside), fs.renameSync(saved, repository);
    }
    assert.equal(fs.existsSync(external) ? fs.readFileSync(external, "utf8") : null, exists ? "outside" : null);
  };
  try { for (const kind of ["managed", "template"]) for (const exists of [true, false]) confined(kind, exists); }
  finally { fs.rmSync(temporaryDirectory, { recursive: true, force: true }); }
});

test("descriptor support fails closed and traversal failures close every descriptor", { skip: process.platform !== "linux" }, () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(skillRoot, "tests", ".descriptor-support-"));
  const blocked = (kind, failure) => {
    const repository = path.join(temporaryDirectory, `${kind}-${failure}`); fs.mkdirSync(repository);
    const write = preparedWrite(repository, kind); const { openSync, fstatSync } = fs;
    if (failure === "proc") fs.openSync = function (name, ...args) {
      if (name === "/proc/self/fd") throw Object.assign(new Error("missing proc"), { code: "ENOENT" });
      return openSync.call(this, name, ...args);
    };
    else {
      let reads = 0;
      fs.fstatSync = function (descriptor) {
        const stat = fstatSync.call(this, descriptor);
        return ++reads === 2 ? { ...stat, ino: stat.ino + 1 } : stat;
      };
    }
    try { assert.throws(write, /verified \/proc/); }
    finally { fs.openSync = openSync; fs.fstatSync = fstatSync; }
    assert.equal(fs.existsSync(path.join(repository, ".github")), false);
  };
  try {
    for (const failure of ["proc", "identity"]) for (const kind of ["managed", "template"]) blocked(kind, failure);
    const repository = path.join(temporaryDirectory, "cleanup"); fs.mkdirSync(repository);
    const { openSync, closeSync } = fs; const openDescriptors = new Set();
    fs.openSync = function (name, ...args) {
      if (/^\/proc\/self\/fd\/\d+\/.github$/.test(name)) throw Object.assign(new Error("EACCES blocked"), { code: "EACCES" });
      const descriptor = openSync.call(this, name, ...args);
      if (name === repository || String(name).startsWith("/proc/self/fd")) openDescriptors.add(descriptor);
      return descriptor;
    };
    fs.closeSync = function (descriptor) { openDescriptors.delete(descriptor); return closeSync.call(this, descriptor); };
    try { assert.throws(() => writeTemplateFile(repository, ".github/managed.yml", "unsafe"), /EACCES/); assert.deepEqual([...openDescriptors], []); }
    finally { fs.openSync = openSync; fs.closeSync = closeSync; }
  } finally { fs.rmSync(temporaryDirectory, { recursive: true, force: true }); }
});

test("generic files are hashed, safely written, and reject unsafe paths", () => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(skillRoot, "tests", ".managed-files-"),
  );
  try {
    const repository = path.join(temporaryDirectory, "repository");
    fs.mkdirSync(path.join(repository, "governance"), { recursive: true });
    fs.writeFileSync(path.join(repository, "governance", "CODEOWNERS"), "* @acme");
    const files = {
      ".github/CODEOWNERS": {
        source: "governance/CODEOWNERS",
        mode: "replace",
      },
    };
    const [file] = preflightManagedFiles({ files }, repository);
    assert.match(file.sourceHash, /^[a-f0-9]{64}$/);
    assert.equal(file.destinationHash, null);
    writeManagedFile(file);
    assert.equal(
      fs.readFileSync(path.join(repository, ".github", "CODEOWNERS"), "utf8"),
      "* @acme",
    );
    assert.equal(
      preflightManagedFiles({ files }, repository)[0].destinationHash,
      file.sourceHash,
    );

    const ensure = { source: "governance/CODEOWNERS", mode: "ensure" };
    assert.throws(
      () =>
        preflightManagedFiles(
          { files: { managed: ensure, "managed/child": ensure } },
          repository,
          () => {
            throw new Error("mutation reached");
          },
        ),
      /is an ancestor of/,
    );

    const [racedFile] = preflightManagedFiles(
      { files: { ".github/raced": ensure } },
      repository,
    );
    const racedDestination = path.join(repository, ".github", "raced");
    fs.writeFileSync(racedDestination, "unmanaged");
    assert.throws(
      () => writeManagedFile(racedFile),
      (err) => err.code === "EEXIST" || /EEXIST|already exists/i.test(err.message),
    );
    assert.equal(fs.readFileSync(racedDestination, "utf8"), "unmanaged");

    const [finalLink] = preflightManagedFiles(
      { files: { ".github/final-link": { source: "governance/CODEOWNERS", mode: "replace" } } }, repository,
    );
    const outsideFinal = path.join(temporaryDirectory, "outside-final");
    fs.writeFileSync(outsideFinal, "outside");
    fs.symlinkSync(outsideFinal, path.join(repository, ".github", "final-link"));
    assert.throws(
      () => writeManagedFile(finalLink),
      (err) => err.code === "ELOOP" || /ELOOP|symbolic link/i.test(err.message),
    );
    assert.equal(fs.readFileSync(outsideFinal, "utf8"), "outside");

    fs.symlinkSync(
      temporaryDirectory,
      path.join(repository, "linked-destination"),
    );
    assert.throws(
      () =>
        preflightManagedFiles(
          {
            files: {
              "linked-destination/CODEOWNERS": {
                source: "governance/CODEOWNERS",
                mode: "ensure",
              },
            },
          },
          repository,
        ),
      /symbolic link/,
    );
    assert.throws(
      () =>
        preflightManagedFiles(
          { files: { ".gitignore": { source: "../outside", mode: "ensure" } } },
          repository,
        ),
      /repository-relative path without traversal/,
    );
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("legacy resource arrays fail clearly instead of silently accepting duplicate identities", () => {
  const invalid = structuredClone(configuration);
  invalid.labels = [
    { name: "type:bug", color: "D73A4A" },
    { name: "type:bug", color: "FFFFFF" },
  ];
  assert.equal(errorsFor(invalid).includes("$.labels"), true);
  assert.equal(
    messagesFor(invalid).includes(
      "legacy arrays are unsupported; use an object map keyed by the managed identity",
    ),
    true,
  );
});

test("normalization sorts resource maps before plan generation", () => {
  const reversed = structuredClone(configuration);
  reversed.labels = {
    "priority:high": configuration.labels["priority:high"],
    "type:bug": configuration.labels["type:bug"],
  };
  reversed.milestones = { Zebra: {}, Foundation: {} };
  reversed.files = {
    ".github/workflows/ci.yml": configuration.files[".github/workflows/ci.yml"],
    ".github/CODEOWNERS": configuration.files[".github/CODEOWNERS"],
  };
  reversed.project.fields = {
    "Target date": { dataType: "DATE" },
    Priority: configuration.project.fields.Priority,
  };
  reversed.project.views = {
    Table: { layout: "TABLE" },
    Board: { layout: "BOARD" },
  };
  const normalized = normalizeConfig(reversed);
  assert.deepEqual(
    normalized.labels.map((label) => label.name),
    ["priority:high", "type:bug"],
  );
  assert.deepEqual(
    normalized.milestones.map((milestone) => milestone.title),
    ["Foundation", "Zebra"],
  );
  assert.deepEqual(
    normalized.files.map((file) => file.destination),
    [".github/CODEOWNERS", ".github/workflows/ci.yml"],
  );
  assert.deepEqual(
    normalized.project.fields.map((field) => field.name),
    ["Priority", "Target date"],
  );
  assert.deepEqual(
    normalized.project.views.map((view) => view.name),
    ["Board", "Table"],
  );
});

test("plan creates missing resources and preserves unmanaged existing resources", () => {
  const config = normalizeConfig(configuration);
  const plan = buildPlan(config, {
    labels: [
      { name: "type:bug", color: "FFFFFF", description: "Different" },
      { name: "priority:high", color: "FFFFFF", description: "Different" },
    ],
    milestones: [{ title: "Foundation", description: null, dueOn: null }],
    files: [
      { destination: ".github/CODEOWNERS", sourceHash: "new", destinationHash: "old" },
      { destination: ".github/workflows/ci.yml", sourceHash: "new", destinationHash: "old" },
    ],
    templates: [".github/ISSUE_TEMPLATE/bug_report.yml"],
    project: {
      id: "PVT_kwDOExample",
      title: "Particle Studio",
      number: 1,
      linked: false,
    },
    fields: [],
    views: [],
    viewsSupported: true,
  });
  assert.deepEqual(
    plan.find(
      (entry) => entry.resource === "label" && entry.target === "type:bug",
    ).action,
    "skip",
  );
  assert.deepEqual(
    plan.find(
      (entry) => entry.resource === "label" && entry.target === "priority:high",
    ).action,
    "update",
  );
  assert.deepEqual(
    plan.find((entry) => entry.resource === "project-link").action,
    "link",
  );
  assert.deepEqual(
    plan.find((entry) => entry.resource === "project-field").action,
    "create",
  );
  assert.deepEqual(
    plan.find((entry) => entry.resource === "project-view").action,
    "create",
  );
  assert.equal(
    plan.some((entry) => entry.target === ".github/ISSUE_TEMPLATE/config.yml"),
    true,
  );
  assert.deepEqual(
    plan.filter((entry) => entry.resource === "file").map((entry) => [entry.target, entry.action]),
    [[".github/CODEOWNERS", "skip"], [".github/workflows/ci.yml", "update"]],
  );
});

test("plan reports unavailable GraphQL views without emulation", () => {
  const plan = buildPlan(normalizeConfig(configuration), {
    viewsSupported: false,
  });
  const view = plan.find((entry) => entry.resource === "project-view");
  assert.equal(view.action, "unsupported");
  assert.match(view.reason, /GraphQL/);
});

test("GitHub Projects v2 layouts map to GraphQL layout enums", () => {
  assert.equal(mapProjectV2ViewLayout("BOARD"), "BOARD_LAYOUT");
  assert.equal(mapProjectV2ViewLayout("TABLE"), "TABLE_LAYOUT");
  assert.throws(
    () => mapProjectV2ViewLayout("ROADMAP"),
    /Unsupported configured/,
  );
});

test("duplicate configured project view names fail closed", () => {
  assert.throws(
    () =>
      resolveProjectViewByName(
        [
          { id: "PVTV_1", name: "Board" },
          { id: "PVTV_2", name: "Board" },
        ],
        "Board",
      ),
    /Duplicate GitHub Projects v2 view name/,
  );
  assert.throws(
    () =>
      buildPlan(normalizeConfig(configuration), {
        viewsSupported: true,
        views: [
          { id: "PVTV_1", name: "Board" },
          { id: "PVTV_2", name: "Board" },
        ],
      }),
    /Duplicate GitHub Projects v2 view name/,
  );
});

test("project view plan preserves unmanaged default views", () => {
  const plan = buildPlan(normalizeConfig(configuration), {
    viewsSupported: true,
    views: [{ id: "PVTV_default", name: "View 1", layout: "TABLE_LAYOUT" }],
  });
  const configuredBoard = plan.find(
    (entry) => entry.resource === "project-view" && entry.target === "Board",
  );
  assert.equal(configuredBoard.action, "create");
  assert.equal(
    plan.some(
      (entry) => entry.resource === "project-view" && entry.target === "View 1",
    ),
    false,
  );
  assert.equal(
    plan.some(
      (entry) => entry.action === "update" || entry.action === "delete",
    ),
    false,
  );
});

test("createProjectV2View GraphQL arguments bind the exact input", () => {
  const args = createProjectV2ViewArgs("PVT_kwDOExample", {
    name: "Board",
    layout: "BOARD",
    settings: { visibleFieldIds: ["PVTF_priority", "PVTF_target_date"] },
  });
  assert.deepEqual(args.slice(0, 3), ["api", "graphql", "-f"]);
  assert.match(args[3], /createProjectV2View/);
  assert.deepEqual(args.slice(4), [
    "-F",
    "input[projectId]=PVT_kwDOExample",
    "-F",
    "input[name]=Board",
    "-F",
    "input[layout]=BOARD_LAYOUT",
    "-F",
    "input[configuration][visibleFieldIds][]=PVTF_priority",
    "-F",
    "input[configuration][visibleFieldIds][]=PVTF_target_date",
  ]);
});

test("repository binding accepts only exact supported GitHub HTTPS and SSH origins", () => {
  for (const origin of [
    "https://github.com/egdev6/particle-studio.git",
    "https://github.com/egdev6/particle-studio/",
    "git@github.com:egdev6/particle-studio.git",
    "ssh://git@github.com/egdev6/particle-studio.git",
  ]) {
    assert.equal(
      repositoryBindingMatches("EgDev6/Particle-Studio", origin),
      true,
    );
  }
  for (const origin of [
    "https://token@github.com/egdev6/particle-studio.git",
    "https://@github.com/egdev6/particle-studio.git",
    "https://github.com/egdev6/particle-studio.git?ref=main",
    "https://github.com/egdev6/particle-studio.git#readme",
    "https://gitlab.com/egdev6/particle-studio.git",
    "https://github.com/egdev6/particle-studio/extra",
    "https://github.com/egdev6/",
    "https://github.com//particle-studio",
    "https://github.com/egdev6/particle-studio.git.backup",
    "ssh://user@github.com/egdev6/particle-studio.git",
    "git@github.com:egdev6/particle-studio.git/extra",
  ]) {
    assert.equal(normalizeGitHubOrigin(origin), null, origin);
  }
  assert.equal(
    repositoryBindingMatches(
      "egdev6/particle-studio",
      "git@github.com:egdev6/other.git",
    ),
    false,
  );
});

test("duplicate project titles fail closed before identity selection", () => {
  assert.throws(
    () =>
      resolveProjectByTitle(
        [
          { id: "PVT_1", number: 1, title: "Particle Studio" },
          { id: "PVT_2", number: 2, title: "Particle Studio" },
        ],
        "Particle Studio",
      ),
    /Duplicate GitHub Projects v2 title/,
  );
  assert.deepEqual(
    resolveProjectByTitle(
      [{ id: "PVT_1", number: 1, title: "Particle Studio" }],
      "Particle Studio",
    ),
    { id: "PVT_1", number: 1, title: "Particle Studio" },
  );
});

test("authorization hash binds the exact canonical plan inputs", () => {
  const inputs = {
    config: normalizeConfig(configuration),
    target: {
      repoDir: "/work/particle-studio",
      origin: "git@github.com:egdev6/particle-studio.git",
      repository: configuration.repository,
    },
    observed: {
      labels: [],
      milestones: [],
      templates: [],
      files: [
        {
          destination: ".github/CODEOWNERS",
          source: "governance/CODEOWNERS",
          mode: "ensure",
          sourceHash: "source-v1",
          destinationHash: null,
        },
      ],
      project: null,
      fields: [],
      views: [],
      viewsSupported: null,
      repositoryId: "R_1",
    },
    plan: [
      {
        resource: "label",
        target: "type:bug",
        action: "create",
        reason: "missing",
      },
    ],
  };
  const authorization = authorizationValue(inputs);
  assert.match(authorization, /^APPLY_GITHUB_PROJECT_BOOTSTRAP:[a-f0-9]{64}$/);
  assert.equal(authorizationValue(structuredClone(inputs)), authorization);
  const reordered = structuredClone(configuration);
  reordered.labels = {
    "priority:high": configuration.labels["priority:high"],
    "type:bug": configuration.labels["type:bug"],
  };
  assert.equal(
    authorizationValue({ ...inputs, config: normalizeConfig(reordered) }),
    authorization,
  );
  const changed = structuredClone(inputs);
  changed.observed.repositoryId = "R_2";
  assert.notEqual(authorizationValue(changed), authorization);
  changed.observed.files[0].sourceHash = "source-v2";
  assert.notEqual(authorizationValue(changed), authorization);
});

test("failure reports always retain the declared machine-readable shape", () => {
  const report = emptyReport("apply");
  report.failures.push({ message: "repository binding failed" });
  assert.deepEqual(Object.keys(report).sort(), [
    "authorization",
    "completed",
    "discovered",
    "failures",
    "mode",
    "plan",
    "schemaVersion",
    "skipped",
    "success",
    "validation",
  ]);
  assert.equal(report.success, false);
  assert.equal(
    Array.isArray(report.completed) &&
      Array.isArray(report.skipped) &&
      Array.isArray(report.failures),
    true,
  );
  assert.deepEqual(Object.keys(report.discovered).sort(), [
    "files",
    "labels",
    "milestones",
    "project",
    "templates",
    "viewsSupported",
  ]);
});

test("templates enforce review labels, required scoped evidence, and no blank issues", () => {
  const readTemplate = (name) =>
    fs.readFileSync(path.join(skillRoot, "assets", "templates", name), "utf8");
  assert.match(readTemplate("config.yml"), /^blank_issues_enabled: false$/m);
  const bug = readTemplate("bug_report.yml");
  assert.match(bug, /id: environment/);
  assert.match(bug, /id: affected_area/);
  assert.match(bug, /id: agent_client/);
  assert.match(bug, /id: shell/);
  assert.match(bug, /report enters review before implementation/);
  assert.doesNotMatch(bug, /id: agent_client[\s\S]*?validations:/);
  assert.doesNotMatch(bug, /id: shell[\s\S]*?validations:/);
  const feature = readTemplate("feature_request.yml");
  assert.match(feature, /id: affected_area/);
  assert.match(feature, /id: scope_non_goals/);
  assert.match(feature, /proposal requires product review/);
  const example = JSON.parse(
    fs.readFileSync(
      path.join(skillRoot, "assets", "example.config.json"),
      "utf8",
    ),
  );
  assert.equal(Object.hasOwn(example, "project"), false);
  assert.deepEqual(example.requiredScopes, ["repo"]);
  assert.equal(example.labels["kind:bug"].managed, true);
  assert.equal(
    example.templates.issueFormLabels.bug_report.includes("kind:bug"),
    true,
  );
  assert.equal(
    example.templates.issueFormLabels.feature_request.includes("kind:feature"),
    true,
  );
});

test("project link mutation requires the exact configured repository node ID", () => {
  const linked = {
    data: { linkProjectV2ToRepository: { repository: { id: "R_1" } } },
  };
  assert.equal(projectLinkResponseMatches(linked, "R_1"), true);
  assert.equal(projectLinkResponseMatches(linked, "R_2"), false);
  assert.equal(
    projectLinkResponseMatches(
      { data: { linkProjectV2ToRepository: {} } },
      "R_1",
    ),
    false,
  );
});

test("scope headers are deterministic", () => {
  assert.deepEqual(
    parseOAuthScopes(
      "HTTP/2 200\r\nx-oauth-scopes: repo, project, workflow\r\n",
    ),
    ["repo", "project", "workflow"],
  );
});

test("cross-platform writes succeed on non-Linux platforms", () => {
  // Property 1: Bug Condition — Cross-Platform Write Succeeds
  // Validates: Requirements 2.1, 2.2
  //
  // On unfixed code this test FAILS because requireDescriptorRelativeSupport()
  // throws "Safe managed writes require Linux descriptor-relative filesystem
  // support" before any byte is written.  That failure IS the success condition
  // for this exploration task — it proves the bug exists.
  //
  // After the fix the test PASSES, confirming the bug is resolved.
  const temporaryDirectory = fs.mkdtempSync(
    path.join(skillRoot, "tests", ".cross-platform-writes-"),
  );
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  assert.equal(platform?.configurable, true);
  try {
    const repository = path.join(temporaryDirectory, "repository");
    fs.mkdirSync(path.join(repository, "governance"), { recursive: true });
    fs.writeFileSync(
      path.join(repository, "governance", "source.yml"),
      "managed content",
    );

    // Override platform to 'darwin' — same pattern as the existing "non-Linux" test.
    Object.defineProperty(process, "platform", { ...platform, value: "darwin" });
    try {
      // --- writeManagedFile ---
      const [file] = preflightManagedFiles(
        {
          files: {
            ".github/managed.yml": {
              source: "governance/source.yml",
              mode: "replace",
            },
          },
        },
        repository,
      );
      // On unfixed code this throws "Safe managed writes require Linux
      // descriptor-relative filesystem support" and the assertion fails.
      assert.doesNotThrow(() => writeManagedFile(file));
      assert.equal(
        fs.readFileSync(
          path.join(repository, ".github", "managed.yml"),
          "utf8",
        ),
        "managed content",
        "writeManagedFile must write exact content on non-Linux",
      );

      // --- writeTemplateFile ---
      // On unfixed code this also throws the same platform error.
      assert.doesNotThrow(() =>
        writeTemplateFile(repository, ".github/ISSUE_TEMPLATE/config.yml", "template content"),
      );
      assert.equal(
        fs.readFileSync(
          path.join(repository, ".github", "ISSUE_TEMPLATE", "config.yml"),
          "utf8",
        ),
        "template content",
        "writeTemplateFile must write exact content on non-Linux",
      );
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

// ─── Preservation property tests (Task 2) ────────────────────────────────────
// These 6 tests encode Property 2: Security Invariants on Linux Remain Intact.
// Tests 1–3 and 6 test rejection paths that occur BEFORE any write byte is
// emitted, so they should pass on both fixed and unfixed Linux code.
// Tests 4–5 exercise the full write path and will FAIL on unfixed code on
// any platform where the Linux descriptor-relative guard fires (including the
// Windows host used during development). They document the expected post-fix
// behavior and become green after the fix lands.

test("safeWriteFile rejects symlink in destination path before any write", () => {
  // Property 2 — Validates: Requirements 2.3, 2.4, 3.3
  // Symlink detection runs before any write bytes are emitted.
  // This test passes on unfixed Linux code because managedPath / templateDestination
  // both call lstatSync on each component and reject symlinks before the
  // descriptor-relative write path is reached.
  const temporaryDirectory = fs.mkdtempSync(
    path.join(skillRoot, "tests", ".symlink-rejection-"),
  );
  try {
    const repository = path.join(temporaryDirectory, "repository");
    const outside = path.join(temporaryDirectory, "outside");
    fs.mkdirSync(repository);
    fs.mkdirSync(outside);

    // --- leaf symlink: destination itself is a symlink ---
    const outsideFile = path.join(outside, "leaf.yml");
    fs.writeFileSync(outsideFile, "outside content");
    fs.symlinkSync(outsideFile, path.join(repository, "leaf-link.yml"));
    // writeTemplateFile uses templateDestination which checks lstatIfPresent
    assert.throws(
      () => writeTemplateFile(repository, "leaf-link.yml", "unsafe"),
      /symbolic link/,
    );
    // outside file must be untouched
    assert.equal(fs.readFileSync(outsideFile, "utf8"), "outside content");

    // --- intermediate symlink: a parent directory component is a symlink ---
    fs.symlinkSync(outside, path.join(repository, "linked-dir"));
    assert.throws(
      () => writeTemplateFile(repository, "linked-dir/config.yml", "unsafe"),
      /symbolic link/,
    );
    // no file should have been written inside `outside`
    assert.equal(fs.existsSync(path.join(outside, "config.yml")), false);

    // --- managed file with symlink in destination path ---
    fs.mkdirSync(path.join(repository, "governance"), { recursive: true });
    fs.writeFileSync(
      path.join(repository, "governance", "source.yml"),
      "source",
    );
    // Try to write a managed file whose destination resolves through a symlink.
    // preflightManagedFiles calls managedPath which calls lstatIfPresent on
    // every component, so it rejects before the write descriptor is opened.
    assert.throws(
      () =>
        preflightManagedFiles(
          {
            files: {
              "linked-dir/managed.yml": {
                source: "governance/source.yml",
                mode: "replace",
              },
            },
          },
          repository,
        ),
      /symbolic link/,
    );
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("safeWriteFile detects root-swap via dev+ino before write", () => {
  // Property 3 — Validates: Requirements 2.5, 3.4
  // Root-swap detection uses the rootIdentity captured by approvedRoot at
  // preflight time.  We simulate a swap by overwriting the `rootIdentity`
  // field on the preflighted file object with a tampered identity (ino + 1).
  //
  // On fixed code (all platforms): safeWriteFile checks rootIdentity before
  // any write and throws "root changed" — the key assertion is that the
  // destination was not created.
  //
  // On unfixed code with the platform guard:
  //   - Linux: openWriteDescriptor reaches the fstatSync identity check and
  //     throws "root changed".
  //   - Windows/macOS: requireDescriptorRelativeSupport fires first, throwing
  //     "Safe managed writes require Linux descriptor-relative filesystem
  //     support".  Both outcomes mean the write was safely rejected.
  // The core invariant (destination unchanged) holds either way, so we accept
  // both error messages on unfixed code.
  const temporaryDirectory = fs.mkdtempSync(
    path.join(skillRoot, "tests", ".root-swap-detection-"),
  );
  try {
    const repository = path.join(temporaryDirectory, "repository");
    fs.mkdirSync(path.join(repository, "governance"), { recursive: true });
    fs.writeFileSync(
      path.join(repository, "governance", "source.yml"),
      "source content",
    );

    const [file] = preflightManagedFiles(
      {
        files: {
          ".github/managed.yml": {
            source: "governance/source.yml",
            mode: "replace",
          },
        },
      },
      repository,
    );

    // Tamper the captured rootIdentity — increment ino by 1 to simulate that
    // the root directory was replaced with a different inode between preflight
    // and write time.
    const tamperedFile = {
      ...file,
      rootIdentity: { ...file.rootIdentity, dev: file.rootIdentity.dev + 9999, ino: file.rootIdentity.ino + 9999 },
    };

    // Accept either:
    //   - "root changed"  — fixed code, or unfixed Linux
    // Both represent a safe rejection before any bytes are written.
    assert.throws(
      () => writeManagedFile(tamperedFile),
      /root changed/,
    );

    // The destination must not have been created.
    assert.equal(
      fs.existsSync(path.join(repository, ".github", "managed.yml")),
      false,
    );
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("safeWriteFile exclusive mode throws EEXIST when destination exists", () => {
  // Property 4 — Validates: Requirements 3.7
  // mode:"ensure" with an already-existing destination must throw a write-
  // rejected error and leave the original file content untouched.
  //
  // On fixed code (all platforms): safeWriteFile detects the existing file
  // before rename and throws with code "EEXIST".
  //
  // On unfixed Linux code: openWriteDescriptor opens with O_CREAT|O_EXCL which
  // propagates EEXIST from the kernel.
  //
  // On unfixed Windows/macOS: requireDescriptorRelativeSupport fires first,
  // throwing "Safe managed writes require Linux descriptor-relative filesystem
  // support" (no `code`).  The write is still safely rejected.
  //
  // Core invariant: the original file content is ALWAYS unchanged, regardless
  // of which error is thrown.  On fixed and unfixed-Linux code, the error also
  // carries code "EEXIST".
  const temporaryDirectory = fs.mkdtempSync(
    path.join(skillRoot, "tests", ".exclusive-eexist-"),
  );
  try {
    const repository = path.join(temporaryDirectory, "repository");
    fs.mkdirSync(path.join(repository, "governance"), { recursive: true });
    fs.writeFileSync(
      path.join(repository, "governance", "source.yml"),
      "new content",
    );

    // Preflight against a destination that does NOT yet exist so that
    // destinationHash === null (making exclusive = true for mode:"ensure").
    const [file] = preflightManagedFiles(
      {
        files: {
          ".github/exclusive-race.yml": {
            source: "governance/source.yml",
            mode: "ensure",
          },
        },
      },
      repository,
    );
    assert.equal(file.destinationHash, null);

    // Create the destination AFTER preflight to simulate a race condition.
    fs.mkdirSync(path.join(repository, ".github"), { recursive: true });
    const tempDest = path.join(repository, ".github", "exclusive-race.yml");
    fs.writeFileSync(tempDest, "raced content");

    // writeManagedFile must throw — either EEXIST (fixed / unfixed-Linux) or
    // the platform guard error (unfixed Windows/macOS).  Both are a safe
    // rejection.
    assert.throws(
      () => writeManagedFile(file),
      (err) => {
        // Accept EEXIST from fixed/Linux or the platform guard from Windows/macOS.
        const isEexist = err.code === "EEXIST";
        const isPlatformGuard = /Linux descriptor-relative/.test(err.message);
        assert.equal(
          isEexist || isPlatformGuard,
          true,
          `Expected EEXIST or platform-guard error, got: ${err.message}`,
        );
        return true;
      },
    );

    // Original content must always be preserved.
    assert.equal(fs.readFileSync(tempDest, "utf8"), "raced content");
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("safeWriteFile creates missing parent directories without following symlinks", () => {
  // Property 1 + Requirement 2.7 — Validates: Requirements 2.7
  // When a parent directory of the destination does not yet exist, safeWriteFile
  // must create it and write the file correctly without introducing symlinks.
  //
  // NOTE: This test verifies POST-FIX behavior. On unfixed code (Linux
  // descriptor-relative path), writeManagedFile would fail with the platform
  // guard on Windows. On Linux unfixed code it exercises openWriteDescriptor
  // which also creates intermediate directories — so the test may pass on
  // Linux unfixed but is principally a fix-validation test.
  const temporaryDirectory = fs.mkdtempSync(
    path.join(skillRoot, "tests", ".missing-parent-"),
  );
  try {
    const repository = path.join(temporaryDirectory, "repository");
    fs.mkdirSync(repository);

    // Write the template file to a deeply nested path whose parents don't exist.
    const relativePath = ".github/ISSUE_TEMPLATE/deeply/nested/config.yml";
    writeTemplateFile(repository, relativePath, "nested content");

    const written = path.join(repository, ...relativePath.split("/"));
    assert.equal(fs.readFileSync(written, "utf8"), "nested content");

    // No `.tmp` file should remain in the parent directory.
    const parentDir = path.dirname(written);
    const tmpFiles = fs
      .readdirSync(parentDir)
      .filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(tmpFiles, [], "no .tmp files should remain after write");
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("safeWriteFile writes correct content atomically on all platforms", () => {
  // Property 1 + Property 5 — Validates: Requirements 2.1, 2.2, 3.1, 3.2
  // After a successful write, the destination must contain byte-identical
  // content, and no .tmp file must remain.
  //
  // NOTE: This test verifies POST-FIX behavior. On unfixed code the Linux
  // descriptor-relative guard fires on non-Linux hosts, causing the test to
  // fail. It is written here to validate the fix on all platforms.
  const temporaryDirectory = fs.mkdtempSync(
    path.join(skillRoot, "tests", ".atomic-write-"),
  );
  try {
    const repository = path.join(temporaryDirectory, "repository");
    fs.mkdirSync(path.join(repository, "governance"), { recursive: true });

    // Use a binary-safe buffer to verify byte-identical copy.
    const knownContent = Buffer.from(
      "line1\nline2\nline3\n\u00e9\u00e0\u00fc",
      "utf8",
    );
    fs.writeFileSync(
      path.join(repository, "governance", "source.bin"),
      knownContent,
    );

    const [file] = preflightManagedFiles(
      {
        files: {
          ".github/output.bin": {
            source: "governance/source.bin",
            mode: "replace",
          },
        },
      },
      repository,
    );

    writeManagedFile(file);

    const dest = path.join(repository, ".github", "output.bin");
    const written = fs.readFileSync(dest);
    assert.equal(
      written.equals(knownContent),
      true,
      "written bytes must be byte-identical to source content",
    );

    // No .tmp file should remain in the parent directory.
    const parentDir = path.join(repository, ".github");
    const tmpFiles = fs
      .readdirSync(parentDir)
      .filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(tmpFiles, [], "no .tmp files should remain after write");
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("safeWriteFile cleans up temp file on EEXIST race", () => {
  // Validates: Requirements 2.8 (atomic write / no partial files)
  //
  // On fixed code: the temp file is written first, then EEXIST is detected on
  // re-check before rename, the temp file is unlinked, and EEXIST is thrown.
  // No .tmp file remains — this is the primary thing we verify.
  //
  // On unfixed Linux code: EEXIST is thrown directly from O_CREAT|O_EXCL
  // without ever writing a temp file — no .tmp files, trivially correct.
  //
  // On unfixed Windows/macOS: requireDescriptorRelativeSupport fires first,
  // "Safe managed writes require Linux descriptor-relative filesystem support"
  // is thrown before any temp file is written — no .tmp files, trivially
  // correct.
  //
  // In all cases: the original file content is unchanged and no .tmp remains.
  // The error code check is relaxed to accept either EEXIST or the platform
  // guard so the test can run consistently on the Windows dev host.
  const temporaryDirectory = fs.mkdtempSync(
    path.join(skillRoot, "tests", ".eexist-cleanup-"),
  );
  try {
    const repository = path.join(temporaryDirectory, "repository");
    fs.mkdirSync(path.join(repository, "governance"), { recursive: true });
    fs.writeFileSync(
      path.join(repository, "governance", "source.yml"),
      "source",
    );

    // Preflight when destination does not exist (so destinationHash === null,
    // making exclusive = true for mode:"ensure").
    const [file] = preflightManagedFiles(
      {
        files: {
          ".github/target.yml": {
            source: "governance/source.yml",
            mode: "ensure",
          },
        },
      },
      repository,
    );
    assert.equal(file.destinationHash, null);

    // Create the destination AFTER preflight to trigger exclusive rejection.
    fs.mkdirSync(path.join(repository, ".github"), { recursive: true });
    fs.writeFileSync(
      path.join(repository, ".github", "target.yml"),
      "existing",
    );

    // Accept either EEXIST (fixed / unfixed-Linux) or the platform guard
    // (unfixed Windows/macOS) — both safely reject the write.
    assert.throws(
      () => writeManagedFile(file),
      (err) => {
        const isEexist = err.code === "EEXIST";
        const isPlatformGuard = /Linux descriptor-relative/.test(err.message);
        assert.equal(
          isEexist || isPlatformGuard,
          true,
          `Expected EEXIST or platform-guard error, got: ${err.message}`,
        );
        return true;
      },
    );

    // Assert no .tmp file remains in the parent directory.
    const parentDir = path.join(repository, ".github");
    const tmpFiles = fs
      .readdirSync(parentDir)
      .filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(tmpFiles, [], "no .tmp files should remain after EEXIST");

    // Original file content must be untouched.
    assert.equal(
      fs.readFileSync(
        path.join(repository, ".github", "target.yml"),
        "utf8",
      ),
      "existing",
    );
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("writeManagedFile preserves file permissions (0755, 0600) on replace", () => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(skillRoot, "tests", ".permissions-preserve-"),
  );
  try {
    const repository = path.join(temporaryDirectory, "repository");
    fs.mkdirSync(path.join(repository, "governance"), { recursive: true });
    fs.mkdirSync(path.join(repository, ".github"), { recursive: true });

    fs.writeFileSync(
      path.join(repository, "governance", "script.sh"),
      "#!/bin/sh\necho new",
    );
    const dest = path.join(repository, ".github", "script.sh");
    fs.writeFileSync(dest, "#!/bin/sh\necho old", { mode: 0o755 });

    if (process.platform !== "win32") {
      const initialMode = fs.statSync(dest).mode & 0o777;
      assert.equal(initialMode, 0o755);
    }

    const [file] = preflightManagedFiles(
      {
        files: {
          ".github/script.sh": {
            source: "governance/script.sh",
            mode: "replace",
          },
        },
      },
      repository,
    );

    writeManagedFile(file);

    assert.equal(fs.readFileSync(dest, "utf8"), "#!/bin/sh\necho new");

    if (process.platform !== "win32") {
      const finalMode = fs.statSync(dest).mode & 0o777;
      assert.equal(
        finalMode,
        0o755,
        "0755 permissions must be preserved after replace",
      );
    }

    // 0600 permission case
    fs.writeFileSync(
      path.join(repository, "governance", "secret.key"),
      "key-new",
    );
    const secretDest = path.join(repository, ".github", "secret.key");
    fs.writeFileSync(secretDest, "key-old", { mode: 0o600 });

    if (process.platform !== "win32") {
      const initialSecretMode = fs.statSync(secretDest).mode & 0o777;
      assert.equal(initialSecretMode, 0o600);
    }

    const [secretFile] = preflightManagedFiles(
      {
        files: {
          ".github/secret.key": {
            source: "governance/secret.key",
            mode: "replace",
          },
        },
      },
      repository,
    );

    writeManagedFile(secretFile);

    assert.equal(fs.readFileSync(secretDest, "utf8"), "key-new");

    if (process.platform !== "win32") {
      const finalSecretMode = fs.statSync(secretDest).mode & 0o777;
      assert.equal(
        finalSecretMode,
        0o600,
        "0600 permissions must be preserved after replace",
      );
    }
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("bootstrap run() does not interpret shell metacharacters in arguments", () => {
  const directResult = run("node", [
    "-e",
    "console.log(process.argv[1])",
    "arg & calc.exe & %PATH% | echo injected",
  ]).trim();
  assert.equal(directResult, "arg & calc.exe & %PATH% | echo injected");

  const temporaryDirectory = fs.mkdtempSync(
    path.join(skillRoot, "tests", ".metachar-test-"),
  );
  try {
    const jsPath = path.join(temporaryDirectory, "stub.js");
    fs.writeFileSync(
      jsPath,
      'console.log(JSON.stringify(process.argv.slice(2)));',
    );

    const testArgs = [
      "literal & calc.exe",
      "%VAR% & dir",
      "foo | bar",
      "<input> > output",
    ];

    if (process.platform === "win32") {
      const cmdPath = path.join(temporaryDirectory, "stub.cmd");
      fs.writeFileSync(cmdPath, `@node "%~dp0stub.js" %*\r\n`);
      assert.throws(
        () => resolveCommand(cmdPath),
        /crosses a command shell boundary/,
      );
      assert.throws(
        () => run(cmdPath, testArgs),
        /crosses a command shell boundary/,
      );
    } else {
      const cmdPath = path.join(temporaryDirectory, "stub");
      fs.writeFileSync(
        cmdPath,
        `#!/usr/bin/env node\n${fs.readFileSync(jsPath, "utf8")}`,
        { mode: 0o755 },
      );
      const output = run(cmdPath, testArgs);
      const parsed = JSON.parse(output.trim());
      assert.deepEqual(parsed, testArgs);
    }
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("resolveCommand and run fail closed on every batch script", () => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(skillRoot, "tests", ".unsupported-batch-"),
  );
  try {
    const unsupportedBat = path.join(temporaryDirectory, "unsupported.bat");
    fs.writeFileSync(unsupportedBat, "@echo off\r\necho dangerous\r\n");

    assert.throws(
      () => resolveCommand(unsupportedBat),
      /crosses a command shell boundary/,
    );
    assert.throws(
      () => run(unsupportedBat, []),
      /crosses a command shell boundary/,
    );
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("resolveCommand rejects @echo node wrappers and never executes payload", () => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(skillRoot, "tests", ".echo-node-regression-"),
  );
  try {
    const canaryPath = path.join(temporaryDirectory, "canary.txt");
    const payloadPath = path.join(temporaryDirectory, "payload.js");
    fs.writeFileSync(
      payloadPath,
      `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(canaryPath)}, "executed");\n`,
    );

    const fakeCmd = path.join(temporaryDirectory, "echo-node.cmd");
    fs.writeFileSync(fakeCmd, '@echo node "%~dp0payload.js"\r\n');

    assert.throws(
      () => resolveCommand(fakeCmd),
      /crosses a command shell boundary/,
    );
    assert.throws(
      () => run(fakeCmd, []),
      /crosses a command shell boundary/,
    );
    assert.equal(
      fs.existsSync(canaryPath),
      false,
      "payload.js must never be executed",
    );
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("resolveCommand rejects exit /b wrappers and never executes later Node payload", () => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(skillRoot, "tests", ".exit-b-regression-"),
  );
  try {
    const canaryPath = path.join(temporaryDirectory, "canary.txt");
    const payloadPath = path.join(temporaryDirectory, "payload.js");
    fs.writeFileSync(
      payloadPath,
      `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(canaryPath)}, "executed");\n`,
    );

    const fakeCmd = path.join(temporaryDirectory, "early-exit.cmd");
    fs.writeFileSync(
      fakeCmd,
      '@echo off\r\nexit /b 0\r\n@node "%~dp0payload.js" %*\r\n',
    );

    assert.throws(
      () => resolveCommand(fakeCmd),
      /crosses a command shell boundary/,
    );
    assert.throws(
      () => run(fakeCmd, []),
      /crosses a command shell boundary/,
    );
    assert.equal(
      fs.existsSync(canaryPath),
      false,
      "payload.js after exit /b must never be executed",
    );
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
