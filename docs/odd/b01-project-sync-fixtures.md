# B01 project-sync fixtures (U4a)

U4a ships only an opt-in `node:vm` fixture profile, its focused tests, and this
note. No runtime module, asset, renderer, schema, CLI flag, install, or activation
lands; the published validator still rejects `project.issueSync` and `templates.issueWorkflow`.

## Profile API

`runWorkflowScript(script, { profile, ... })` validates an explicit profile.
`"lifecycle"` (absent or default) is unchanged: four env keys, a mutable
`process.env`, a frozen `{ env }` process, and `{ calls, logs, process }`.
Unknown, `null`, or non-string profiles throw. `profile: "project-sync"` freezes a fresh
7-key env (`PROJECT_OWNER`, `PROJECT_TITLE_BASE64`, `GITHUB_STEP_SUMMARY`, plus the four),
seeds a `Buffer` global, and exposes a frozen `{ env, stdout, stderr, exit }` process.
Typed options: `projectOwner` / `projectTitleBase64` are strings (defaults `fixture-owner`,
base64 of `fixture-project`; malformed or empty strings pass, base64 is not this layer's
contract), `tokenPresent` selects the fixture token vs `""`, and `summaryEnabled`
/ `summaryFailure` are booleans. The result adds `summary` and `exitCode`.

## Virtual outputs and exit limitation

`process.stdout` / `stderr.write` append to `logs` and return `true`, while
`fs.appendFileSync` accepts only the fixed virtual summary path and a string.
`summaryEnabled: false` blanks the env, and `summaryFailure: true` throws a fake
IO error the source may catch. `process.exit(code)` validates an integer 0–255 and
throws a sentinel whose identity is private to this one `runWorkflowScript` call;
only that call catches it outside the VM run, so a mock error from another run is
never mistaken for it. Later reviewed code is unreached, and `exitCode` is
`undefined` when the script completes without an explicit exit — a catchable
simulation, not native process termination. Scripts are trusted and project-owned;
`node:vm` is not a sandbox and no host I/O, credential, or network API is
provided or claimed.
