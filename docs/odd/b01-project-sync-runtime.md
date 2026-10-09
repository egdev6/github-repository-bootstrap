# B01 project-sync runtime asset and fixtures (U4c)

U4c ships the inert packaged `assets/templates/project-issue-sync.yml`, the
portable fixture helper, and the offline donor-S13 contract. Nothing installs or
activates a workflow: the current schema and CLI still reject `project.issueSync`
and `templates.issueWorkflow`, so the asset is packaged data, not a default.

## Donor ledger

| ID | State | Owner |
| --- | --- | --- |
| S01–S04 | pending | U5 schema, normalization, effective module |
| S05 | partial | U4b renderer + U4c real asset shape; manifest→renderer adapter pending U5 |
| S06–S12 | pending | U5 collision, plan, authorization, apply, deferred creation |
| S13 | complete in U4c | offline open-issue add and item dedup |
| S14–S17 | complete in U4d | offline warning/skip, malformed pages/identity, page/owner binding, cursor cycles, event guards |
| S18–S21 | pending | U5 capability replan, secret discovery, permission failures |

## Fixture limits and privacy scope

The helper reuses `extractNodeHeredoc` and the U4a `project-sync` profile:
read-only asset, four reviewed in-memory `gh` routes, fail-closed on other calls, no
spawn, host environment, credential, write, or network; `exitCode` is `undefined`
on success and `1` after `fatal`, never native. The donor echoed `JSON.parse`
`error.message` to `stderr`; U4c emits generic text and binds malformed listing
and live-issue responses to a fatal exit, zero mutation, and no response, title,
token, or control sentinel in logs or summary. U4d adds the S14–S17 offline
guards, per-loop cursor-cycle detection, event validation, and the separate
`fakeAdded` backend trace; see `b01-project-sync-guards.md`.
