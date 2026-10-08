# B01 CI delivery tracker

Refs #13. Strategy: `feature-branch-chain`.

This branch is the draft, no-merge integration tracker. The first child targets
`chore/b01-ci-tracker`; subsequent children target their immediate parent.
The verified integration base is `main` at
`010ff53d9e662571dbb75af20bdad5147654f8e5`.

## First child: portable test entry point

Scope:
- `scripts/run-tests.mjs`: explicit test-file discovery, shell-free execution,
  exit-code propagation, and canonical entry-point detection through path aliases.
- `skills/github-repository-bootstrap/tests/runner.test.mjs`: six real local
  discovery/CLI/import regressions with bounded, isolated fixtures.
- `package.json`: change only `scripts.test`; retain the published skill list.

The reviewed child unit is 266 changed lines (265 additions, one deletion).
Local isolated validation passed 43 tests: 37 existing tests plus six new tests.
The directory-alias regression first failed against the previous runner, which
returned success without executing tests; canonical realpaths fix that defect.
These results were observed locally on Node 24/Linux, not on native Node 20,
Windows, or macOS runners.

## CI execution

The current workflow filters PR events to `main`. Child PRs therefore need the
explicitly authorized `workflow_dispatch` route on their exact head branch.
Record the run URL, commit SHA, and actual matrix results before claiming remote
verification. The existing release job is push-only; dispatch must skip it.

## Deferred work

The security gate, scanner metadata, workflow assets and their behavioral tests,
bootstrap modules, new skills, and other pending documentation are not part of
the first child. Scope these as later reviewed units; do not hide dependencies
or compress code to satisfy the review budget.

## Integration gates

- [ ] Child slices independently reviewed and verified.
- [ ] Remote checks bound to the intended commit SHA pass.
- [ ] Remaining B01 dependencies and release-readiness criteria are satisfied.
- [ ] Explicit integration/merge authorization is received.

This tracker must remain draft. Creating branches, commits, PRs and CI runs is
not authority to merge, close #13, change versions, create tags or publish releases.
