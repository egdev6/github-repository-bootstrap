# B01 command transport

Refs #15. Local preparation slice for U5b-1: the synchronous command transport
moves into its own module and gains an explicit, stateless runner factory. No
runtime default, CLI flag, schema field, or publication changes.

## What this slice adds

- New `scripts/command-transport.mjs`: the existing `rejectBatchScript`,
  `resolveCommand`, and `run` contract moves here unchanged except for the
  factory seam. `createCommandRunner(execute = execFileSync)` returns a
  `run(command, args, options = {})` closure bound to that one backend; there is
  no setter, reset, environment variable, or CLI flag for the backend. The named
  production `run` is a single instance using the real `execFileSync`.
- `scripts/bootstrap.mjs`: the moved block and the now-unused `execFileSync`
  import are removed; the module imports and re-exports `run` and
  `resolveCommand`, so existing importers keep the same API. CLI helpers,
  discovery, `parseArgs`, stdout/status, the entry guard, and `main` are
  unchanged.
- New `tests/command-transport.test.mjs`: injected-backend routing, the native
  default, argv/options/input forwarding with `shell: false` and any extra
  caller option ignored, caller-argv snapshotting, last-two-line stderr and
  fallback messages, real resolver rejection of explicit `.cmd`/`.bat` paths
  before the backend runs, runner isolation across nested runners, invalid
  backend rejection, and bootstrap re-export compatibility.
- `references/execution-safety.md`: the execution-authority sentence now names
  `scripts/command-transport.mjs` alongside `bootstrap.mjs` and `lib.mjs`. No
  policy text is rewritten.

## Tests and evidence

- RED: the factory scaffold accepted a backend but still called native
  `execFileSync`; the injected-backend test failed on the observed native output
  (`command-transport-probe` vs `injected-result`), not on a loader error.
- GREEN: `node --test skills/github-repository-bootstrap/tests/command-transport.test.mjs`
  passes 10/10 on Node 24/Linux.
- Full `npm test`: 181 pass/0 fail/0 skipped, including all 171 baseline cases.
  Runs use a private `TMPDIR` whose `package.json` is `commonjs`, because
  a foreign `/tmp/package.json` with `type: module` breaks the pre-existing
  extensionless `gh` stub; that failure is environmental, not this change.
- Local Node 24/Linux only. Remote CI evidence is pending.

## Availability and risks

- This is transport only. CLI helpers use the native factory default; none
  accepts an injected non-default runner. U5b-2 orchestration remains blocked
  and unimplemented.
- The injected backend is trusted programmatic/test code at the exec boundary,
  not a sandbox: it is not exposed as a CLI option, environment hook, or
  manifest field.
- The wrapper keeps its current diagnostic behavior, including the last two
  stderr lines, and makes no secret-redaction claim.
- No schema, workflow, version (stays 1.1.0), or release change; no publication.
