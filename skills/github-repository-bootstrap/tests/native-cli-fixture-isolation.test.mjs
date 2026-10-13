// Regression guard for the native CLI `gh` fixture isolation seam (B01 D1).
//
// The fixture launcher installed by `installGhFixture` is an extensionless file
// (`bin/gh`). Node resolves the module type of an extensionless entry point from
// the nearest ancestor `package.json`, so an ambient `"type": "module"` manifest
// above the fixture directory (for example a temp-dir `package.json`) turns the
// CommonJS stub into ESM and makes `require(...)` fail. The fixture must pin its
// own `bin/package.json` to CommonJS so the stub is immune to the host temp state.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { installGhFixture } from "./helpers/native-cli-fixtures.mjs";

// Build a fresh, self-owned fixture tree with an ESM manifest above `bin`. The
// regression must not depend on whichever package.json happens to sit in the
// host temp directory, so the ancestor manifest is written explicitly.
function withOwnedFixtureRoot(run) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "native-cli-fixture-isolation-"),
  );
  try {
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ type: "module" }),
    );
    const bin = path.join(root, "nested", "bin");
    fs.mkdirSync(bin, { recursive: true });
    return run({ root, bin });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("native CLI gh fixture runs under an ambient ESM manifest", () => {
  withOwnedFixtureRoot(({ root, bin }) => {
    const logPath = path.join(root, "gh.log");
    const fixturesPath = installGhFixture(bin, {
      "--version": "gh version test\n",
      "auth status": "logged in\n",
    });
    const gh = path.join(bin, process.platform === "win32" ? "gh.exe" : "gh");
    const env = { ...process.env, GH_LOG: logPath, GH_FIXTURES: fixturesPath };

    assert.equal(
      execFileSync(gh, ["--version"], { encoding: "utf8", env }),
      "gh version test\n",
    );
    assert.equal(
      execFileSync(gh, ["auth", "status"], { encoding: "utf8", env }),
      "logged in\n",
    );
    assert.throws(
      () => execFileSync(gh, ["api", "unexpected"], { encoding: "utf8", env }),
      (error) => error.status === 1,
    );
    assert.equal(
      fs.readFileSync(logPath, "utf8"),
      '["--version"]\n["auth","status"]\n["api","unexpected"]\n',
    );
  });
});

test("native CLI gh fixture pins its launcher to CommonJS", () => {
  withOwnedFixtureRoot(({ bin }) => {
    installGhFixture(bin, { "--version": "gh version test\n" });

    assert.equal(
      fs.readFileSync(path.join(bin, "package.json"), "utf8"),
      JSON.stringify({ type: "commonjs" }),
    );
    // The stub body must stay CommonJS for the `require(...)` engine.
    assert.match(
      fs.readFileSync(path.join(bin, "gh-stub.cjs"), "utf8"),
      /^const fs = require\("node:fs"\);/,
    );

    if (process.platform === "win32") {
      // The Windows launcher is a compiled bridge to `process.execPath`.
      assert.equal(fs.existsSync(path.join(bin, "gh.exe")), true);
      const launcher = fs.readFileSync(path.join(bin, "gh-launcher.cs"), "utf8");
      assert.ok(launcher.includes(`psi.FileName = ${JSON.stringify(process.execPath)};`));
      assert.match(launcher, /psi\.UseShellExecute = false/);
      return;
    }

    const launcher = path.join(bin, "gh");
    assert.equal(fs.statSync(launcher).mode & 0o111, 0o111);
    assert.match(fs.readFileSync(launcher, "utf8"), /^#!\/usr\/bin\/env node\n/);
  });
});
