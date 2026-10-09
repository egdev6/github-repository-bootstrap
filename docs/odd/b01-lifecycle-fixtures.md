# B01 lifecycle fixtures (U3a)

Refs the issue lifecycle workflow slice. U3a ships the **in-process fixture
helper and its own contract tests only**. The `issue-lifecycle.yml` and
`project-issue-sync.yml` assets plus the full self-contained binding tests
arrive in U3b/U3c. No default flags, config schema, writer contract, CLI
surface, or public API change lands in this slice.

## What this slice adds

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
| 2791–2845 | issue workflow defaults on for issue forms; canonical status labels | U5 |
| 2847–2939 | source/destination hashes invalidate the plan; symlink preflight | U5 |
| 2941–2967 | opt-out leaves legacy templates untouched; README example matches | U5 |
| 3121–3157 | opened adds review only with no live human state; live payload | U3b |
| 3159–3221 | reopened/closed touch only the review states | U3b |
| 3310–3343 | stale events use the live issue state | U3b |
| 3386–3403 | static, least-privilege, no checkout, fork-safe | U3b |
| 3223–3260 | approved same-repo references across pages | U3c |
| 3262–3308 | fork/draft/blocked/unapproved skipped; API error fails loudly | U3c |
| 3345–3369 | narrow 404 tolerated, 403 not | U3c |
| 3371–3384 | non-404 failure (HTTP 500) is not swallowed | U3c |
| 3405–3434 | malformed closing-issue pagination fails loudly | U3c |

U3b/U3c must bind these cases to the real scripts and validate the event label
states; they must not drop any row. The U5/U3b/U3c rows are planned deliveries,
not done, and U3a adds no script-availability flag. Additional U3c guard cases
are still needed: GraphQL `errors`, a cyclic cursor A→B→A, duplicate refs, an
unsupported action/event, and a malformed repository. Those require the real
script and are **not** claimed available in U3a.

## Tests and evidence

- `workflow-vm.test.mjs`: 15 focused, read-only tests over the helper contract.
- RED: the importable stub produced 12 meaningful failing assertions on the
  initial contract; the two verification fixes also regressed to RED (a mutated
  handler arg leaked into the record, and `timeout: 1.1` reached `node:vm` as a
  `RangeError`).
- GREEN + TRIANGULATE: the implemented helper passes the focused file (15/15)
  and the full suite, including the added negative cases.
