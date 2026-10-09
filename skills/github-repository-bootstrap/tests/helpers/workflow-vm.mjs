// In-process fixture runner for project-owned workflow scripts.
//
// `runWorkflowScript` executes a workflow's inline `node <<'NODE'` body inside a
// `node:vm` context seeded with a fake `require`, virtual filesystem, virtual
// environment, and fake `gh` CLI. The fake CLI records every call. The fixture
// API exposes no real module, filesystem, child process, environment token, or
// network, and the helper itself performs no host I/O or spawns.
//
// `node:vm` is NOT a security boundary: hostile code CAN escape it. Fixture
// scripts are reviewed, project-owned, and must never carry untrusted content.
//
// These helpers are read-only: they never write files, mutate the environment,
// or spawn a process.
import vm from "node:vm";

export const FIXTURE_EVENT_PATH = "/virtual/github-event.json";
export const FIXTURE_TOKEN = "fixture-token";
export const DEFAULT_TIMEOUT_MS = 5_000;
export const MAX_TIMEOUT_MS = 4_294_967_295;

const escapePattern = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Return the exact body bytes of the single `node <<'NODE' ... NODE` heredoc in
 * `yamlText`. Line endings (LF or CRLF) and indentation are preserved verbatim.
 * Throws on zero heredocs, more than one, or a body without a terminator.
 */
export function extractNodeHeredoc(yamlText) {
  if (typeof yamlText !== "string") throw new TypeError("yamlText must be a string");
  const openers = [...yamlText.matchAll(/^([ \t]*)node <<'NODE'[ \t]*\r?\n/gm)];
  if (openers.length !== 1) throw new Error(`expected exactly one node heredoc; found ${openers.length}`);
  const opener = openers[0];
  const indent = opener[1];
  const bodyStart = opener.index + opener[0].length;
  const terminator = new RegExp(`^${escapePattern(indent)}NODE[ \\t]*\\r?(?:\\n|$)`, "m");
  const close = terminator.exec(yamlText.slice(bodyStart));
  if (!close) throw new Error("node heredoc is not terminated");
  return yamlText.slice(bodyStart, bodyStart + close.index);
}

const normalizeGhResponse = (value) => {
  if (value instanceof Error) throw value;
  if (typeof value === "string") return value;
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  throw new Error("gh fixture response must be a string, object, or Error");
};

// A `gh` fixture is either a queue consumed per call or a handler called with
// `{ command, args }`. A missing, exhausted, or undefined response fails closed.
const ghResponder = (gh) => {
  if (Array.isArray(gh)) {
    const queue = [...gh];
    return () => {
      if (queue.length === 0) throw new Error("gh fixture queue is exhausted");
      return normalizeGhResponse(queue.shift());
    };
  }
  if (typeof gh === "function") return (args) => normalizeGhResponse(gh({ command: "gh", args }));
  return () => { throw new Error("gh fixture must be a queue array or a handler function"); };
};

/**
 * Run `script` in a fresh `node:vm` context and return the captured `calls`,
 * `logs`, and the sandbox `process` (which exposes only `env`). The context
 * seeds only a virtual event file, a virtual environment, and fake
 * dependencies. A `timeout` in milliseconds bounds the run and defaults to a
 * finite value.
 */
export function runWorkflowScript(script, options = {}) {
  if (typeof script !== "string") throw new TypeError("script must be a string");
  const { event = {}, eventName = "issues", repository = "fixture/repo", gh, timeout = DEFAULT_TIMEOUT_MS } = options;
  if (!Number.isInteger(timeout) || timeout <= 0 || timeout > MAX_TIMEOUT_MS) throw new Error(`timeout must be a positive integer no greater than ${MAX_TIMEOUT_MS}`);

  const calls = [];
  const logs = [];
  const eventJson = JSON.stringify(event);
  const respond = ghResponder(gh);

  const modules = Object.freeze({
    "node:fs": Object.freeze({
      readFileSync(pathname, encoding) {
        if (pathname !== FIXTURE_EVENT_PATH) throw new Error(`fixture fs: unknown path ${pathname}`);
        if (encoding !== "utf8") throw new Error("fixture fs: readFileSync requires utf8");
        return eventJson;
      },
    }),
    "node:child_process": Object.freeze({
      execFileSync(command, args, opts) {
        if (command !== "gh") throw new Error(`fixture shell: unexpected command ${command}`);
        if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) throw new Error("fixture shell: args must be an array of strings");
        if (!opts || opts.encoding !== "utf8" || !Array.isArray(opts.stdio) || opts.stdio.join(",") !== "ignore,pipe,pipe") throw new Error("fixture shell: options must be encoding utf8 and stdio [ignore, pipe, pipe]");
        const argv = Array.from(args);
        calls.push({ command: "gh", args: argv, options: { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] } });
        return respond([...argv]);
      },
    }),
  });

  const environment = {
    GITHUB_EVENT_NAME: eventName,
    GITHUB_REPOSITORY: repository,
    GITHUB_EVENT_PATH: FIXTURE_EVENT_PATH,
    GH_TOKEN: FIXTURE_TOKEN,
  };
  const sandboxProcess = Object.freeze({ env: environment });
  const capture = (...parts) => logs.push(parts.map(String).join(" "));
  const sandbox = vm.createContext({
    require: (id) => {
      if (!Object.prototype.hasOwnProperty.call(modules, id)) throw new Error(`fixture require: unknown module ${id}`);
      return modules[id];
    },
    process: sandboxProcess,
    console: Object.freeze({ log: capture, warn: capture, error: capture }),
  });
  vm.runInContext(script, sandbox, { timeout, filename: "workflow-fixture.js" });
  return { calls, logs, process: sandboxProcess };
}
