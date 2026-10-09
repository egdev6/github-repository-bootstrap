# B01 pull request lifecycle binding (U3c)

Refs the issue lifecycle workflow slice. U3c ships **PR/GraphQL binding tests
for the inert packaged `issue-lifecycle.yml` plus three inline guards**. Nothing
here is published, activated, or wired into the CLI: `templates.issueWorkflow`
is still rejected by the current validator, install stays reviewed future
Runtime work (U5), and deploying the workflow remains a human step. No default
flag, config schema, installer, or public API change lands in this slice.

## What this slice binds

- `tests/lifecycle-pull-requests.test.mjs` binds the five remaining root rows:
  approved same-repo references across pages retaining approval (3223-3260),
  fork/draft/blocked/unapproved skips with loud GraphQL errors (3262-3308),
  narrow 404 tolerance versus 403 (3345-3369), non-404 deletion failure
  (3371-3384), and malformed closing-issue pagination (3405-3434).
- The same file adds three guards: a repeated GraphQL cursor A→B→A fails with
  the known pagination error instead of looping, duplicate OPEN references are
  read and mutated once each, and only the workflow's own PR actions
  (`opened`, `reopened`, `edited`, `synchronize`, `ready_for_review`) run.
- Fixtures are strict: unknown or malformed `gh` calls fail loudly, and only
  fixture-owned state changes. The promised live reads are ISSUES only; no live
  PR polling or broader API guarantee is claimed.

## Delivered means local-tested

"Delivered" here means the case is bound and passing in this checkout under
Node 24, with individual per-unit source snapshots and no commits. It does NOT
mean published, released, or available: there is no npm publication, no PI
install, no startup/load/reload/trust, and no API sandbox proof. `node:vm` is an
execution context, not a security boundary; only this reviewed, project-owned
script runs in the fixture, and fixtures carry no real secret or network access.
Node 20 remote CI for these new cases is still pending.
