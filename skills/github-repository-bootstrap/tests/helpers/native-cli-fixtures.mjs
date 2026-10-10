// Shared local fixtures for the native bootstrap CLI tests (B01 D1).
//
// Test infrastructure only: the `gh` stub is a Node/CJS script driven by a JSON
// reply table, and the runner wraps `spawnSync`. No production API, product
// environment hook, or credential is introduced or read.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const FIXTURES_FILE = "gh-fixtures.json";

// The stub appends argv to GH_LOG, maps the exact `args.join(" ")` key from a
// locally supplied JSON table to stdout, and fails closed otherwise. It never
// evals request-derived code; trusted test data, not a security sandbox.
const GH_STUB_ENGINE = `const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.GH_LOG, JSON.stringify(args) + "\\n");
const replies = JSON.parse(fs.readFileSync(process.env.GH_FIXTURES, "utf8"));
if (Object.hasOwn(replies, args.join(" "))) process.stdout.write(replies[args.join(" ")]);
else process.exitCode = 1;
`;

/** Install the PATH-visible `gh` launcher for the Node/CJS stub script. */
function installGhStub(bin, scriptPath) {
  if (process.platform !== "win32") {
    fs.writeFileSync(
      path.join(bin, "gh"),
      `#!/usr/bin/env node\n${fs.readFileSync(scriptPath, "utf8")}`,
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

/** Write the reply table and install a PATH-visible `gh` stub backed by it. */
export function installGhFixture(bin, replies) {
  const fixturesPath = path.join(bin, FIXTURES_FILE);
  fs.writeFileSync(fixturesPath, JSON.stringify(replies));
  const scriptPath = path.join(bin, "gh-stub.cjs");
  fs.writeFileSync(scriptPath, GH_STUB_ENGINE);
  installGhStub(bin, scriptPath);
  return fixturesPath;
}

/** Run the native bootstrap CLI against the installed `gh` fixture. */
export function runBootstrapCli({
  skillRoot,
  bin,
  configPath,
  repository,
  mode,
  authorize,
  logPath,
}) {
  return spawnSync(
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
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        GH_LOG: logPath,
        GH_FIXTURES: path.join(bin, FIXTURES_FILE),
      },
    },
  );
}
