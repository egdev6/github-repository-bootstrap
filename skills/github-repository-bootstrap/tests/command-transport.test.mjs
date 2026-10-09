import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createCommandRunner,
  resolveCommand,
  run as productionRun,
} from "../scripts/command-transport.mjs";

// A reviewed, harmless child program: it only writes a constant string and
// touches no network, credentials, or files.
const NATIVE_PROBE = [
  "-e",
  "process.stdout.write('command-transport-probe')",
];

test("createCommandRunner routes commands through the injected backend", () => {
  const calls = [];
  const runner = createCommandRunner((cmd, args, options) => {
    calls.push({ cmd, args: [...args], options: { ...options } });
    return "injected-result";
  });

  const result = runner(process.execPath, NATIVE_PROBE);

  assert.equal(result, "injected-result");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, process.execPath);
  assert.deepEqual(calls[0].args, NATIVE_PROBE);
});

test("the default production runner still executes a real process", () => {
  const output = productionRun(process.execPath, NATIVE_PROBE);

  assert.equal(typeof output, "string");
  assert.equal(output, "command-transport-probe");
});

test("the runner forwards argv and a fixed synchronous exec contract", () => {
  const seen = [];
  const runner = createCommandRunner((cmd, args, options) => {
    seen.push({ cmd, args, options });
    return "";
  });

  runner("transport-probe", ["one", "two"], {
    input: "payload",
    shell: true,
    env: { TRANSPORT_PROBE: "1" },
    timeout: 5,
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].cmd, "transport-probe");
  assert.deepEqual(seen[0].args, ["one", "two"]);
  assert.equal(seen[0].options.encoding, "utf8");
  assert.equal(seen[0].options.shell, false);
  assert.deepEqual(seen[0].options.stdio, ["pipe", "pipe", "pipe"]);
  assert.equal(seen[0].options.input, "payload");
  assert.equal(seen[0].options.env, undefined);
  assert.equal(seen[0].options.timeout, undefined);
});

test("the runner snapshots caller argv and isolates recorder state", () => {
  const callerArgs = ["alpha", "beta"];
  const snapshots = [];
  const runner = createCommandRunner((_cmd, args) => {
    snapshots.push([...args]);
    args.push("mutated-by-backend");
    return "";
  });

  runner("transport-probe", callerArgs);

  assert.deepEqual(callerArgs, ["alpha", "beta"]);
  assert.deepEqual(snapshots, [["alpha", "beta"]]);
});

test("the runner keeps the last two stderr lines in the failure message", () => {
  const runner = createCommandRunner(() => {
    const error = new Error("boom");
    error.stderr = "first line\nsecond line\nthird line\n";
    throw error;
  });

  assert.throws(
    () => runner("transport-probe", []),
    /transport-probe failed: second line third line/,
  );
});

test("the runner falls back to a generic diagnostic for empty errors", () => {
  const runner = createCommandRunner(() => {
    throw new Error("");
  });

  assert.throws(
    () => runner("transport-probe", []),
    /transport-probe failed: no diagnostic returned/,
  );
});

test("the real resolver rejects batch paths before the injected backend", () => {
  const scratch = fs.mkdtempSync(
    path.join(os.tmpdir(), "command-transport-batch-"),
  );
  try {
    let calls = 0;
    const runner = createCommandRunner(() => {
      calls += 1;
      return "";
    });

    for (const extension of [".cmd", ".bat"]) {
      const wrapper = path.join(scratch, `wrapper${extension}`);
      fs.writeFileSync(wrapper, "@echo off\r\n");
      assert.throws(
        () => resolveCommand(wrapper),
        /crosses a command shell boundary/,
      );
      assert.throws(
        () => runner(wrapper, []),
        /crosses a command shell boundary/,
      );
    }

    assert.equal(calls, 0, "the backend must not run for a rejected path");
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test("independent runners keep their own backend and never leak state", () => {
  const first = createCommandRunner(() => "first");
  const second = createCommandRunner(() => "second");

  assert.equal(first("transport-probe", []), "first");
  assert.equal(second("transport-probe", []), "second");

  const outer = createCommandRunner(() => {
    const nested = createCommandRunner(() => "nested");
    assert.equal(nested("transport-probe", []), "nested");
    throw new Error("inner boom");
  });
  assert.throws(() => outer("transport-probe", []), /inner boom/);

  assert.equal(first("transport-probe", []), "first");
  assert.equal(productionRun(process.execPath, NATIVE_PROBE), "command-transport-probe");
});

test("the factory rejects a backend that is not a function", () => {
  assert.throws(
    () => createCommandRunner("not-a-function"),
    /requires a synchronous execute function/,
  );
});

test("bootstrap re-exports the transport without auto-running main", async () => {
  const transport = await import("../scripts/command-transport.mjs");
  const bootstrap = await import("../scripts/bootstrap.mjs");

  assert.equal(bootstrap.run, transport.run);
  assert.equal(bootstrap.resolveCommand, transport.resolveCommand);
  assert.equal(typeof bootstrap.run, "function");
  assert.equal(typeof bootstrap.resolveCommand, "function");
});
