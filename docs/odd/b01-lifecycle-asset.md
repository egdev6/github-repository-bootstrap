# B01 issue lifecycle asset (U3b)

Refs the issue lifecycle slice. U3b ships the **inert packaged
`issue-lifecycle.yml` template plus its static and behavioral binding tests**.
It does not install, activate, or execute the workflow: `templates.issueWorkflow`
is still rejected by the current validator, install is reviewed future Runtime
work (U5), and deploying the workflow to a repository stays a separate human
step. No default flag, config schema, CLI surface, or public API change lands.

## What this slice adds

- `skills/github-repository-bootstrap/assets/templates/issue-lifecycle.yml` is
  the reviewed donor script packaged verbatim except for a truthful header that
  replaces the old auto-install claim. It keeps least-privilege permissions
  (`contents: read`, `issues: write`, `pull-requests: read`), `github.token` as
  `GH_TOKEN`, a per-entity `concurrency` group with `cancel-in-progress: false`,
  and no `uses:` step. The inventory still reports it as unknown YAML for
  actionlint; no protected exemption was added.
- `tests/lifecycle-issues.test.mjs` binds the four U3b ledger rows: the static
  least-privilege/fork-safe shape plus the `issues` transitions for `opened`,
  `reopened`, `closed`, and stale events. Each behavioral case runs the asset
  heredoc under both LF and CRLF without rewriting the on-disk file.

## Tests and evidence

- Focused `tests/lifecycle-issues.test.mjs`: 5 tests, RED on the truthful header
  against the donor header (behavioral cases are preimplemented donor logic),
  then GREEN 5/5. PR, GraphQL, and the 404/403 guard stay U3c, not claimed.

## Availability and risks

- The asset is packaged but NOT available to the CLI, schema, or installer yet;
  no availability flag, default install, or module activation is claimed.
- `node:vm` is not a security boundary; only this reviewed, project-owned script
  runs in the fixture, and the fixtures carry no real secret or network access.
