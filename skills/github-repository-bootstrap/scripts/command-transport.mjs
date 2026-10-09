// Synchronous command transport for the bootstrap skill. `resolveCommand`
// rejects batch-script wrappers, and `createCommandRunner` binds one trusted,
// synchronous backend per runner while the default production `run` uses
// `execFileSync`. This module is an exec boundary, not a sandbox: the injected
// callback is trusted test/programmatic code and may do anything it can.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function rejectBatchScript(candidate) {
  if (/\.(cmd|bat)$/i.test(candidate)) {
    throw new Error(
      `Unsupported batch script wrapper: ${candidate}. Executing .cmd or .bat files crosses a command shell boundary; provide a direct executable binary (such as gh.exe) instead.`,
    );
  }
}

export function resolveCommand(command) {
  if (path.isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    if (fs.existsSync(command)) {
      rejectBatchScript(command);
      return { cmd: command, args: [] };
    }
    if (fs.existsSync(command + ".exe")) {
      return { cmd: command + ".exe", args: [] };
    }
    for (const ext of [".cmd", ".bat"]) {
      if (fs.existsSync(command + ext)) rejectBatchScript(command + ext);
    }
    return { cmd: command, args: [] };
  }

  if (process.platform === "win32") {
    const pathDirs = (process.env.PATH || "").split(path.delimiter);
    const extensions = (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM")
      .split(";")
      .map((ext) => ext.toLowerCase());

    let batchMatch = null;
    for (const dir of pathDirs) {
      if (!dir) continue;
      for (const ext of ["", ...extensions]) {
        const candidate = path.join(dir, command + ext);
        try {
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            if (/\.(cmd|bat)$/i.test(candidate)) {
              if (!batchMatch) batchMatch = candidate;
              continue;
            }
            return { cmd: candidate, args: [] };
          }
        } catch {
          // Ignore unreadable PATH entries and keep searching.
        }
      }
    }
    if (batchMatch) rejectBatchScript(batchMatch);
  }

  return { cmd: command, args: [] };
}

export function createCommandRunner(execute = execFileSync) {
  if (typeof execute !== "function") {
    throw new TypeError(
      "createCommandRunner requires a synchronous execute function",
    );
  }
  return function run(command, args, options = {}) {
    const resolved = resolveCommand(command);
    const commandArgs = resolved.args ? [...resolved.args, ...args] : args;
    try {
      return execute(resolved.cmd, commandArgs, {
        encoding: "utf8",
        input: options.input,
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      });
    } catch (error) {
      const detail = String(error.stderr || error.message)
        .trim()
        .split("\n")
        .slice(-2)
        .join(" ");
      throw new Error(`${command} failed: ${detail || "no diagnostic returned"}`);
    }
  };
}

export const run = createCommandRunner();
