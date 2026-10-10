# B01 native CLI fixtures (D1)

D1 extracts the inline `gh` launcher and CLI runner from `lib.test.mjs` into a
shared local test helper. Test infrastructure only: no product module, API,
schema, flag, default, or runtime field changes.

## What this slice moves

- New `tests/helpers/native-cli-fixtures.mjs` exports `installGhFixture(bin, replies)`
  and `runBootstrapCli(options)`; the private `installGhStub` compiles the launcher.
- `installGhFixture` writes a Node/CJS `gh-stub.cjs` that appends the exact argv
  to `GH_LOG`, maps the exact `args.join(" ")` key of a locally supplied JSON
  reply table to a stdout string, and fails closed (exit 1) on any other call.
  It never evaluates request-derived code; it is not a security sandbox.
- `installGhStub` keeps the previous platform behavior: a `node` shebang
  launcher on POSIX and a generic C# `csc` launcher on Windows. The C# launcher
  only starts the Node/CJS stub with `UseShellExecute=false`; it is not a second
  JSON responder and keeps no `.cmd`/`.bat` fallback.
- `runBootstrapCli` keeps the exact `spawnSync` flags, `--config`/`--repo-dir`/
  `--mode`/`--authorize` arguments, UTF-8 encoding, and `PATH`/`GH_LOG` env, and
  adds only the test-only `GH_FIXTURES` path. It returns the raw spawn result, so
  `status`/`signal`/`error` stay visible.
- `lib.test.mjs` drops the inline launcher, reply branches, and runner and calls
  both exports from the same minimal CLI test. That test keeps every validation,
  normalization, plan/apply, report, mutation, `GH_LOG`, and families-off
  assertion. One added case covers call capture and fail-closed behavior.

## Non-goals and assumptions

The stub is local fixture plumbing, not a security control. The JSON reply
table is trusted test data supplied by the caller: it maps known simple-token
request keys to stdout strings, with no `eval` and no request-derived executable
code. It is not a universal argv filter, endpoint allowlist, or credential
proof.

Keys are the exact `args.join(" ")` string, so arguments containing spaces
collide: `["api", "user"]` and `["api user"]` reach the same key. Callers must
pass simple token argv, as the current minimal fixture does for `--version`,
`api -i user`, `api users/acme`, `api repos/acme/widgets`, and `api user`.

## Limits

- The reply table is keyed by simple `gh` argv tokens seeded for the current
  minimal queries (`--version`, `api -i user`, `api users/acme`,
  `api repos/acme/widgets`, `api user`). There is no GraphQL, stdin, or
  pagination support, no new plan API, and no builder for future units.
- Local Linux/Node evidence only; the Windows C# launcher is not compiled or run
  here. No version, release, or publication change.
