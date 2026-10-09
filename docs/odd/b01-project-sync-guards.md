# B01 project-sync guards (U4d)

U4d adds bounded guards to the inert packaged `assets/templates/project-issue-sync.yml`
and the offline S14–S17 donor contract. Nothing installs, activates, or runs a
workflow: the current schema and CLI reject `project.issueSync` and
`templates.issueWorkflow`, and no default, flag, or opt-out exists.

## Guards

- **Cursor cycles.** Each pagination loop keeps its own `Set` of seen cursors and
  fails on a revisited cursor before the VM deadline. The sets are per invocation
  and per loop (project listing and item listing), so a cursor value shared by the
  two loops is not a false cycle. The donor guard that only compared consecutive
  cursors is not ported; the consecutive-identical case still reports
  `pagination did not advance`.
- **Events.** Only `opened`/`reopened` issues events are processed. Unknown valid
  actions and non-`issues` event names skip with zero API calls. A malformed event
  (non-object, missing/non-string action, missing/non-object issue, or a number
  that is not a safe positive integer) fails closed before the REST read. The event
  `JSON.parse` is wrapped generically and never echoes the parse excerpt.

## Fixture semantics

The fixture helper records every `gh` argument (`added` = mutation attempt) and a
separate `fakeAdded` = the fake backend's local default-state trace. A supplied
mutation response override records no state, and a failed call records an attempt
but no state. Neither value proves a real remote board changed, so the guards only
prove fail-closed behavior. `exitCode` is `undefined` on success and `1` after
`fatal` — a catchable simulation, never a native process status — and `node:vm` is
not a sandbox.

## Donor mapping and validation

The offline file maps the 16 S14–S17 scenarios one-to-one (S14 warnings/skips, S15
ambiguity/stale/unexpected, S16 malformed pages/payloads/identity, S17 page walking
and repo-vs-project owner binding) plus access-code, cycle, event, title, and
repository-identity extras. Validated with `node --test` on the guard file and the
existing runtime file, then the full `npm test` suite; Red was observed against the
unguarded asset before the guards landed. U5 still owns every non-runtime case.
