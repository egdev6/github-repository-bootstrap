// In-process fixture runner for project-owned workflow scripts.
//
// `runWorkflowScript` executes a workflow's inline `node <<'NODE'` body inside a
// `node:vm` context seeded with a fake `require`, virtual filesystem, virtual
// environment, and fake `gh` CLI. The fake CLI records every call. By default
// (`profile: "lifecycle"`) the sandbox exposes exactly four virtual env keys, a
// consumable `process.env`, and captured `console` logs; each call record is an
// independent parent-realm snapshot. The opt-in `profile: "project-sync"`
// additionally seeds a `Buffer` global, three project env keys, virtual
// `process.stdout`/`process.stderr`/`process.exit` capture, and an in-memory
// `fs.appendFileSync` target for `GITHUB_STEP_SUMMARY`.
//
// All capture is virtual and in-memory: the helper never touches the host
// filesystem, environment, child processes, credentials, or network, and it
// never spawns. `process.exit` is a catchable simulation, not native process
// termination; it stops the reviewed script by throwing a private sentinel that
// only `runWorkflowScript` catches, outside the `node:vm` call.
//
// `node:vm` is NOT a security boundary: hostile code CAN escape it. Fixture
// scripts are reviewed, project-owned, and must never carry untrusted content.
import vm from "node:vm";

export const FIXTURE_EVENT_PATH = "/virtual/github-event.json";
export const FIXTURE_TOKEN = "fixture-token";
export const DEFAULT_TIMEOUT_MS = 5_000;
export const MAX_TIMEOUT_MS = 4_294_967_295;

const LIFECYCLE_PROFILE = "lifecycle";
const PROJECT_PROFILE = "project-sync";
const FIXTURE_OWNER = "fixture-owner";
const FIXTURE_TITLE_BASE64 = "Zml4dHVyZS1wcm9qZWN0";
const FIXTURE_SUMMARY_PATH = "/virtual/step-summary.md";

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
 * `logs`, and the sandbox `process`. The default `lifecycle` profile exposes a
 * `process` with only `env` and returns `{ calls, logs, process }`. The opt-in
 * `project-sync` profile adds a `Buffer` global, three project env keys, virtual
 * `process.stdout`/`stderr`/`exit`, and a virtual summary append target, then
 * also returns `summary` and `exitCode`. The context seeds only a virtual event
 * file, a virtual environment, and fake dependencies; all capture is in-memory
 * and never touches the host. A `timeout` in milliseconds bounds the run and
 * defaults to a finite value.
 */
export function runWorkflowScript(script, options = {}) {
  if (typeof script !== "string") throw new TypeError("script must be a string");
  const {
    event = {},
    eventName = "issues",
    repository = "fixture/repo",
    gh,
    timeout = DEFAULT_TIMEOUT_MS,
    profile = LIFECYCLE_PROFILE,
    projectOwner = FIXTURE_OWNER,
    projectTitleBase64 = FIXTURE_TITLE_BASE64,
    tokenPresent = true,
    summaryEnabled = true,
    summaryFailure = false,
  } = options;
  if (!Number.isInteger(timeout) || timeout <= 0 || timeout > MAX_TIMEOUT_MS) throw new Error(`timeout must be a positive integer no greater than ${MAX_TIMEOUT_MS}`);
  if (profile !== LIFECYCLE_PROFILE && profile !== PROJECT_PROFILE) throw new Error(`profile must be "${LIFECYCLE_PROFILE}" or "${PROJECT_PROFILE}"`);
  const isProject = profile === PROJECT_PROFILE;
  if (isProject) {
    if (typeof projectOwner !== "string") throw new TypeError("projectOwner must be a string");
    if (typeof projectTitleBase64 !== "string") throw new TypeError("projectTitleBase64 must be a string");
    for (const [name, value] of [["tokenPresent", tokenPresent], ["summaryEnabled", summaryEnabled], ["summaryFailure", summaryFailure]]) {
      if (typeof value !== "boolean") throw new TypeError(`${name} must be a boolean`);
    }
  }

  const calls = [];
  const logs = [];
  const summaryParts = [];
  const eventJson = JSON.stringify(event);
  const respond = ghResponder(gh);

  const fsModule = {
    readFileSync(pathname, encoding) {
      if (pathname !== FIXTURE_EVENT_PATH) throw new Error(`fixture fs: unknown path ${pathname}`);
      if (encoding !== "utf8") throw new Error("fixture fs: readFileSync requires utf8");
      return eventJson;
    },
  };
  if (isProject) {
    fsModule.appendFileSync = (pathname, text) => {
      if (pathname !== FIXTURE_SUMMARY_PATH) throw new Error(`fixture fs: unknown path ${pathname}`);
      if (typeof text !== "string") throw new Error("fixture fs: appendFileSync requires a string");
      if (summaryFailure) throw new Error("fixture fs: simulated summary write failure");
      summaryParts.push(text);
    };
  }

  const modules = Object.freeze({
    "node:fs": Object.freeze(fsModule),
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
    GH_TOKEN: isProject && !tokenPresent ? "" : FIXTURE_TOKEN,
  };
  if (isProject) {
    environment.PROJECT_OWNER = projectOwner;
    environment.PROJECT_TITLE_BASE64 = projectTitleBase64;
    environment.GITHUB_STEP_SUMMARY = summaryEnabled ? FIXTURE_SUMMARY_PATH : "";
    Object.freeze(environment);
  }

  let exitCode;
  const exitSentinels = new WeakMap();
  const sandboxProcess = isProject
    ? Object.freeze({
        env: environment,
        stdout: Object.freeze({
          write(text) {
            if (typeof text !== "string") throw new Error("fixture stdout.write requires a string");
            logs.push(text);
            return true;
          },
        }),
        stderr: Object.freeze({
          write(text) {
            if (typeof text !== "string") throw new Error("fixture stderr.write requires a string");
            logs.push(text);
            return true;
          },
        }),
        exit(code = 0) {
          if (!Number.isInteger(code) || code < 0 || code > 255) throw new Error("fixture process.exit code must be an integer from 0 to 255");
          const sentinel = new Error(`fixture process.exit(${code})`);
          exitSentinels.set(sentinel, code);
          throw sentinel;
        },
      })
    : Object.freeze({ env: environment });

  const capture = (...parts) => logs.push(parts.map(String).join(" "));
  const sandbox = vm.createContext({
    require: (id) => {
      if (!Object.prototype.hasOwnProperty.call(modules, id)) throw new Error(`fixture require: unknown module ${id}`);
      return modules[id];
    },
    process: sandboxProcess,
    console: Object.freeze({ log: capture, warn: capture, error: capture }),
    ...(isProject ? { Buffer } : {}),
  });
  try {
    vm.runInContext(script, sandbox, { timeout, filename: "workflow-fixture.js" });
  } catch (error) {
    if (exitSentinels.has(error)) exitCode = exitSentinels.get(error);
    else throw error;
  }
  const result = { calls, logs, process: sandboxProcess };
  if (isProject) {
    result.summary = summaryParts.join("");
    result.exitCode = exitCode;
  }
  return result;
}
