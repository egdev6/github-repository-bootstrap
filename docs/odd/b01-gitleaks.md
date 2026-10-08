# B01 Gitleaks security gate

Refs #13. First security slice of the B01 chain; tracker
`docs/odd/b01-ci-chain.md`. Targets `main`; local checks precede remote CI.

## What this slice adds

- `security` job in `.github/workflows/release.yml`: Ubuntu, 15-minute cap,
  `contents: read`, no tokens or secrets, full-history checkout with
  `persist-credentials: false`.
- Gitleaks `8.30.1` verified with `sha256sum --check --strict` before only the
  named binary is streamed out with `tar -xzOf`; version, URL and SHA-256 are
  independent workflow literals.
- Full-history scan with `[extend] useDefault = true`, `--redact=100`,
  `--no-banner`, an empty external ignore file, `--ignore-gitleaks-allow` and
  `--log-opts='--all --full-history'`; no report artifact is uploaded.
- `test-gate` now needs `[test, security]` and requires both to succeed, so a
  secret finding blocks the push-only release job.
- `.github/ci-tools.json` mirrors the public version, URL and SHA-256; the
  workflow never reads it at build time.

## Tests

- `workflow-policy.test.mjs`: 11 structural tests (7 pre-existing, 4 new).
- `gitleaks-fixtures.mjs`: 4 Linux-only fixtures, intentionally not `*.test.mjs`
  so the matrix never discovers them; the security job runs them with
  `GITLEAKS_BIN`. They prove a history-only secret is caught and redacted, a
  benign repo passes, and the gate truth table passes only on success + success.

## Evidence and deferrals

Local: `npm test` 54 pass / 0 fail; fixtures 4 pass / 0 skipped; actionlint
1.7.12 clean. RED was 2 pass / 9 fail structurally plus a gate mismatch; GREEN
is 11/11. Not complete #13: actionlint and remaining B01 units are deferred;
remote CI is pending, evidence is local only.
