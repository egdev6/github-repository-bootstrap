# B01 lifecycle fixtures (U3a–U3c)

Refs the issue lifecycle workflow slice. U3a ships the **in-process fixture
helper and its own contract tests**, U3b ships the inert packaged
`issue-lifecycle.yml` plus its `issues` binding tests, and U3c ships the
pull-request/GraphQL binding tests and three inline guards. The inert asset is
present locally; it is NOT installed, activated, or published.
`templates.issueWorkflow` is still rejected by the current validator, install
stays reviewed future Runtime work (U5), and `project-issue-sync.yml` is out of
scope here. No default flags, config schema, writer contract, CLI surface, or
public API change lands in this slice.

## What U3a adds (helper contract)

- `skills/github-repository-bootstrap/tests/helpers/workflow-vm.mjs` exports
  `extractNodeHeredoc(yamlText)` and `runWorkflowScript(script, {...})`.
- `extractNodeHeredoc` returns the exact single `node <<'NODE'` body, preserving
  line endings (LF and CRLF) and indentation byte-for-byte. It rejects zero,
  multiple, or unterminated heredocs.
- `runWorkflowScript` runs a reviewed, project-owned script inside `node:vm`
  with a fake `require` limited to `node:fs` and `node:child_process`, a virtual
  event file, a virtual environment (`GITHUB_EVENT_NAME`, `GITHUB_REPOSITORY`,
  `GITHUB_EVENT_PATH`, and `GH_TOKEN: fixture-token` only), captured `console`
  logs, and a `gh` fixture queue or handler. Every `gh` call is recorded as an
  independent parent-realm snapshot; the handler receives its own args copy, so
  a mutating fixture cannot rewrite the record. Unknown modules, paths, commands,
  argv, or options and a missing response all fail closed, and `timeout` must be
  a positive integer no greater than `4294967295`.
- `node:vm` is an execution context, **not** a security boundary: hostile code
  CAN escape it. Fixture scripts are reviewed, project-owned, and must never
  carry untrusted content. Fixture events are JSON data: a string that looks
  like code is never executed.

## Root lifecycle ledger (all cases mapped, none dropped)

The canonical lifecycle coverage was first inspected in a machine-local,
unpublished donor snapshot of
`skills/github-repository-bootstrap/tests/lib.test.mjs` (about 3435 lines) that
predates U3. It is NOT this repository's shipped `lib.test.mjs` (1650 lines).
The line ranges below cite that donor snapshot. This slice keeps every case
visible so none is quietly retired:

| Root lines | Case | Slice |
| --- | --- | --- |
| 2791–2845 | issue workflow defaults on for issue forms; canonical status labels | U5 blocked |
| 2847–2939 | source/destination hashes invalidate the plan; symlink preflight | U5 blocked |
| 2941–2967 | opt-out leaves legacy templates untouched; README example matches | U5 blocked |
| 3121–3157 | opened adds review only with no live human state; live payload | U3b local-tested |
| 3159–3221 | reopened/closed touch only the review states | U3b local-tested |
| 3310–3343 | stale events use the live issue state | U3b local-tested |
| 3386–3403 | static, least-privilege, no checkout, fork-safe | U3b local-tested |
| 3223–3260 | approved same-repo references across pages | U3c local-tested |
| 3262–3308 | fork/draft/blocked/unapproved skipped; API error fails loudly | U3c local-tested |
| 3345–3369 | narrow 404 tolerated, 403 not | U3c local-tested |
| 3371–3384 | non-404 failure (HTTP 500) is not swallowed | U3c local-tested |
| 3405–3434 | malformed closing-issue pagination fails loudly | U3c local-tested |

Every row is preserved: the three U5 rows stay blocked (no script-availability
flag), the four U3b rows are bound in `lifecycle-issues.test.mjs`, and the five
U3c rows plus the added guard cases (GraphQL `errors`, cyclic cursor A→B→A,
duplicate refs, unsupported action/event, malformed repository) are bound in
`lifecycle-pull-requests.test.mjs`. "Delivered" means local-tested in this
checkout under Node 24 with per-unit source snapshots and no commits; it does
NOT mean published, released, or activated. There is no npm publication, PI
install, startup/load/reload/trust, or API sandbox proof, and Node 20 remote CI
for the new cases is still pending.

## Tests and evidence

- `workflow-vm.test.mjs`: 15 focused, read-only tests over the helper contract.
- RED: the importable stub produced 12 meaningful failing assertions on the
  initial contract; the two verification fixes also regressed to RED (a mutated
  handler arg leaked into the record, and `timeout: 1.1` reached `node:vm` as a
  `RangeError`).
- GREEN + TRIANGULATE: the implemented helper passes the focused file (15/15)
  and the full suite, including the added negative cases.
- U3b `lifecycle-issues.test.mjs`: 5 focused tests binding the four U3b rows to
  the inert packaged asset. RED was the truthful-header assertion; the
  behavioral cases are preimplemented donor logic. GREEN focused 5/5.
- U3c `lifecycle-pull-requests.test.mjs`: 9 focused tests binding the five U3c
  rows plus the three guards. RED was three meaningful guard failures (a cyclic
  cursor timed out, duplicate refs were read twice, and an unsupported action
  still called `gh`); the minimal asset guards then passed GREEN 9/9 focused and
  the full suite 118/118.
