import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { discoverTestFiles } from "../../../scripts/run-tests.mjs";

// Portable test-runner unit. The first check pins the `npm test` wiring and the
// in-process discovery contract. The remaining checks build throwaway projects
// that copy the production runner verbatim, then drive it as a real CLI from an
// unrelated working directory. They prove file discovery, project-root
// resolution, argument safety without a shell, and exit-code propagation. No
// network, GitHub, or secret access: only local Node child processes.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");
const productionRunner = path.join(repoRoot, "scripts/run-tests.mjs");
const runnerSource = read("scripts/run-tests.mjs");

// The runner's entry-point guard keeps `import` side-effect free. This exact
// line is the target for the controlled mutation in the import test.
const ENTRY_GUARD = "if (isEntryPoint()) {";

const PASSING_TEST = ['import test from "node:test";', 'test("fixture passes", () => {});', ""].join("\n");
const FAILING_TEST = [
  'import test from "node:test";',
  'import assert from "node:assert/strict";',
  'test("fixture fails", () => { assert.equal(1, 2); });',
  "",
].join("\n");

test("npm test uses the portable runner and discovers sorted real test files", () => {
  assert.equal(JSON.parse(read("package.json")).scripts.test, "node scripts/run-tests.mjs");
  assert.ok(runnerSource.includes("skills/github-repository-bootstrap/tests"), "runner must target the test directory");
  assert.ok(runnerSource.includes("shell: false") && runnerSource.includes("--test"), "runner must call the node test runner without a shell");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "run-tests-"));
  try {
    fs.writeFileSync(path.join(directory, "b.test.mjs"), "");
    fs.writeFileSync(path.join(directory, "a.test.mjs"), "");
    fs.writeFileSync(path.join(directory, "ignore.mjs"), "");
    fs.mkdirSync(path.join(directory, "nested.test.mjs"));
    assert.deepEqual(discoverTestFiles(directory).map((file) => path.basename(file)), ["a.test.mjs", "b.test.mjs"]);
    assert.deepEqual(discoverTestFiles(path.join(directory, "missing")), []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// Copies the production runner unchanged into `base/name/scripts/run-tests.mjs`
// and, when `tests` is provided, writes those files into the discovered test
// directory. Returns the CLI entry point inside the copied project.
function writeFixture(base, name, { tests = null } = {}) {
  const project = path.join(base, name);
  fs.mkdirSync(path.join(project, "scripts"), { recursive: true });
  fs.copyFileSync(productionRunner, path.join(project, "scripts", "run-tests.mjs"));
  if (tests) {
    const directory = path.join(project, "skills", "github-repository-bootstrap", "tests");
    fs.mkdirSync(directory, { recursive: true });
    for (const [file, source] of Object.entries(tests)) fs.writeFileSync(path.join(directory, file), source);
  }
  return path.join(project, "scripts", "run-tests.mjs");
}

// Node sets NODE_TEST_CONTEXT inside a running test file. Inheriting it into a
// nested `node --test` makes Node skip the child files and exit 0, so the CLI
// fixtures must spawn the runner with that marker removed.
const runnerEnv = { ...process.env };
delete runnerEnv.NODE_TEST_CONTEXT;

const tempDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

// Every fixture spawn is bounded: a hung child sets `error` (ETIMEDOUT) and a
// null status, so the exact-status assertions below fail instead of hanging.
const runRunner = (entry, cwd) => spawnSync(process.execPath, [entry], { cwd, env: runnerEnv, timeout: 10_000, encoding: "utf8" });

const importRunner = (entry, cwd, extraArgs = []) => {
  const script = `await import(${JSON.stringify(pathToFileURL(entry).href)});`;
  return spawnSync(process.execPath, ["--input-type=module", "-e", script, ...extraArgs], { cwd, env: runnerEnv, timeout: 10_000, encoding: "utf8" });
};

test("copied runner finds its own project from an unrelated cwd and never reaches a shell", () => {
  const base = tempDir("runner-fixture-");
  const cwd = tempDir("runner-cwd-");
  try {
    // Spaces, `&`, `;`, and a `$(...)` command substitution would all trigger a
    // shell. With `shell: false` they must stay literal path bytes.
    const copied = writeFixture(base, "project with spaces & meta;$(touch INJECTED)", {
      tests: { "zz.test.mjs": PASSING_TEST, "aa.test.mjs": PASSING_TEST },
    });
    const result = runRunner(copied, cwd);
    assert.equal(result.status, 0, `fixture runner must pass:\n${result.stdout}\n${result.stderr}`);
    assert.ok(result.stdout.includes("fixture passes"), "the copied runner must actually execute fixture tests");
    assert.ok(!fs.existsSync(path.join(cwd, "INJECTED")), "shell metacharacters must never be interpreted");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("a directory alias resolves to the real entry point and still runs the CLI", () => {
  const base = tempDir("runner-alias-");
  const cwd = tempDir("runner-alias-cwd-");
  try {
    // A directory symlink (junction on Windows, where symlinks need elevation)
    // makes `import.meta.url` and `process.argv[1]` disagree on the raw path.
    // The runner must compare canonical filesystem identities instead, so the
    // aliased entry still runs its tests rather than exiting 0 with no output.
    const copied = writeFixture(base, "real", { tests: { "known.test.mjs": PASSING_TEST } });
    const project = path.dirname(path.dirname(copied));
    const alias = path.join(base, "alias");
    fs.symlinkSync(project, alias, process.platform === "win32" ? "junction" : "dir");
    const aliased = path.join(alias, "scripts", "run-tests.mjs");
    const result = runRunner(aliased, cwd);
    assert.equal(result.error, undefined, "the aliased runner must spawn");
    assert.equal(result.status, 0, `the aliased runner must pass:\n${result.stdout}\n${result.stderr}`);
    assert.ok(result.stdout.includes("fixture passes"), "the aliased runner must execute fixture tests");

    // Node's `--preserve-symlinks` keeps the alias in `import.meta.url`; the
    // canonical comparison must still recognize the entry point.
    const preserved = spawnSync(process.execPath, ["--preserve-symlinks", aliased], { cwd, env: runnerEnv, timeout: 10_000, encoding: "utf8" });
    assert.equal(preserved.error, undefined, "the preserve-symlinks aliased runner must spawn");
    assert.equal(preserved.status, 0, `the preserve-symlinks aliased runner must pass:\n${preserved.stdout}\n${preserved.stderr}`);
    assert.ok(preserved.stdout.includes("fixture passes"), "preserve-symlinks must still execute fixture tests");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("the runner propagates a failing fixture test as a nonzero exit", () => {
  const base = tempDir("runner-failing-");
  const cwd = tempDir("runner-cwd-");
  try {
    const copied = writeFixture(base, "failing", { tests: { "fail.test.mjs": FAILING_TEST } });
    const result = runRunner(copied, cwd);
    assert.equal(result.error, undefined, "the fixture runner must spawn");
    assert.equal(result.status, 1, `a failing fixture test must fail the runner:\n${result.stdout}\n${result.stderr}`);
    assert.ok(result.stdout.includes("fixture fails"), "the failing fixture test must actually run");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("a project with no test files exits 1 with a clear reason instead of crashing", () => {
  const base = tempDir("runner-empty-");
  const cwd = tempDir("runner-cwd-");
  try {
    for (const [name, tests] of [["missing", null], ["empty", {}]]) {
      const copied = writeFixture(base, name, tests ? { tests } : {});
      const result = runRunner(copied, cwd);
      assert.equal(result.status, 1, `${name} fixture must exit 1`);
      assert.match(result.stderr, /No \*\.test\.mjs files found/, `${name} fixture must explain the failure`);
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("the import guard prevents CLI startup and the regression control detects its loss", () => {
  const base = tempDir("runner-import-");
  const cwd = tempDir("runner-import-cwd-");
  try {
    // Import a copied fixture project rather than the production source, so a
    // lost guard runs only one bounded fixture test instead of the whole tree.
    const intact = writeFixture(base, "intact", { tests: { "known.test.mjs": PASSING_TEST } });
    const imported = importRunner(intact, cwd);
    assert.equal(imported.error, undefined, "importing must not fail to spawn");
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(imported.stdout.trim(), "", "import must not run the test CLI");
    assert.ok(!imported.stderr.includes("recursively"), "import must not trigger a nested test run");

    // `node -e "<script>" <arg>` leaves a positional argument as argv[1]. It is
    // not a file, so the guard must stay inert: no crash and no eager CLI. This
    // covers Node's `-e` invocation shape, where argv[1] is an argument rather
    // than a module path.
    const withArgument = importRunner(intact, cwd, ["unrelated-argv-argument"]);
    assert.equal(withArgument.error, undefined, "an extra argv entry must not fail to spawn");
    assert.equal(withArgument.status, 0, withArgument.stderr);
    assert.equal(withArgument.stdout.trim(), "", "an extra argv entry must not run the test CLI");

    // Controlled mutation: remove the entry-point guard from the generated copy
    // only, then prove the assertion above detects the now-eager CLI. Without
    // this, a corrupted guard would stay false-green because the nested runner
    // skips on an inherited NODE_TEST_CONTEXT and exits 0 with empty stdout.
    const mutated = writeFixture(base, "mutated", { tests: { "known.test.mjs": PASSING_TEST } });
    const source = fs.readFileSync(mutated, "utf8");
    assert.ok(source.includes(ENTRY_GUARD), "the runner must keep its entry-point guard");
    fs.writeFileSync(mutated, source.replace(ENTRY_GUARD, "{"));
    const eager = importRunner(mutated, cwd);
    assert.ok(eager.stdout.includes("fixture passes"), "a lost guard must surface the fixture CLI output");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
