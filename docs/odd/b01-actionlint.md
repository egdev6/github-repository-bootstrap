# B01 actionlint workflow lint gate

Refs #13. Lint slice of the B01 chain; tracker `docs/odd/b01-ci-chain.md`.
Targets `main`; local checks precede remote CI.

## What this slice adds

- `actionlint` `1.7.12` in the `security` job, installed like Gitleaks with
  independent version/URL/SHA-256 literals, `curl --fail`, strict
  `sha256sum --check` before only the named binary is streamed out with
  `tar -xzOf`, then `chmod +x`, `GITHUB_PATH` and `-version`.
- `scripts/lint-workflows.mjs` runs the discovered workflows with the verified
  binary through an owned empty `{}` config. It requires an absolute existing
  `ACTIONLINT_BIN` (no PATH fallback), never shells out or installs, is bounded
  at 30s, and treats a spawn error, signal or null status as a failure.
- Its private Go template prints only `filepath:line:column:kind`; no source,
  message or private path is echoed, and a repository `.github/actionlint.yaml`
  ignore cannot hide findings because the wrapper always passes `{}`.
- `security` gains the lint and separate Linux-only fixtures steps; existing
  Gitleaks steps and pins are untouched.

## Tests

- `workflow-policy.test.mjs`: 13 tests (11 pre-existing, 2 new) for the pins,
  verification-before-extraction order and CI invocation.
- `actionlint-fixtures.mjs`: 4 Linux-only fixtures, not `*.test.mjs`; they
  prove a missing/wrong binary hard-fails, and an invalid future asset fails
  safely with no source echoed even under a repo ignore.

## Evidence and deferrals

Local: `npm test` 69 pass / 0 fail; actionlint 4 pass / 0 skipped; Gitleaks
4 pass / 0 skipped; CLI clean; installer blocks `bash -n` clean. Not complete
#13: remote CI is pending, evidence is local only, and no merge, version, tag
or release action is taken.
