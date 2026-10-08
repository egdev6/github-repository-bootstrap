// Portable test entry point.
//
// `node --test "dir/*.test.mjs"` relies on shell glob expansion, which Windows
// shells and some CI runners do not perform. This runner discovers the test
// files with Node APIs and passes explicit paths to the Node test runner, so
// `npm test` behaves the same on Linux, macOS, and Windows.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testsDir = path.join(repoRoot, "skills/github-repository-bootstrap/tests");

export function discoverTestFiles(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

export function main() {
  const files = discoverTestFiles(testsDir);
  if (files.length === 0) {
    console.error(`No *.test.mjs files found in ${testsDir}`);
    process.exitCode = 1;
    return 1;
  }
  const result = spawnSync(process.execPath, ["--test", ...files], {
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exitCode = 1;
    return 1;
  }
  const code = result.status ?? 1;
  process.exitCode = code;
  return code;
}

// A CLI is the entry point when Node resolved the module URL to the same file
// `process.argv[1]` names. Comparing `import.meta.url` to the raw argv path is
// not portable: Node resolves the module URL through symlinks while argv keeps
// the path as typed, so a directory alias would silently skip `main()`. An
// absent argv entry, a non-file argument (`node -e ... extra`), or any other
// canonicalization failure means "not the entry point" and must stay inert.
function isEntryPoint() {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main();
}
