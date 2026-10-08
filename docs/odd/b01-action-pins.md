# B01 action pinning
Refs #13. Follow-up to #32, integrated into `main` through #31.
This PR targets `main`; local checks below precede remote CI.

Pins in `.github/workflows/release.yml`:
- `actions/checkout` -> `11d5960a326750d5838078e36cf38b85af677262` (v4.4.0) in
  the `test` and `release` jobs.
- `actions/setup-node` -> `49933ea5288caeca8642d1e84afbd3f7d6820020` (v4.4.0) in
  the `test` and `release` jobs.
- `test` checkout adds `persist-credentials: false`; `release` keeps credential
  persistence and `fetch-depth: 0`.

Public provenance (verify on a pin update; do not only edit the test constant):
- https://github.com/actions/checkout/releases/tag/v4.4.0
- https://github.com/actions/checkout/commit/11d5960a326750d5838078e36cf38b85af677262
- https://github.com/actions/setup-node/releases/tag/v4.4.0
- https://github.com/actions/setup-node/commit/49933ea5288caeca8642d1e84afbd3f7d6820020

`workflow-policy.test.mjs` adds seven structural policy tests; against the
pre-pin workflow the historical RED was 5 pass / 2 fail (pins, test-checkout
credential), GREEN is 7 pass, `npm test` 50 pass / 0 fail, `actionlint` clean.
These are structural checks, not runtime credential claims; triggers, gating,
the release path, version derivation and idempotency commands are unchanged,
remote CI pending.
