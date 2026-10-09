# B01 fixed-template collision guard (U5a)

U5a adds a lexical, host-aware configuration guard that stops a top-level
`files` destination from claiming a path owned by the current fixed template
installer. It changes only `validationErrors`; no schema, plan, CLI, backend,
template asset, or future-module changes.

## Semantics

- Reserved fixed destinations: `.github/ISSUE_TEMPLATE/config.yml` whenever
  `templates` is present (even with no issue forms and `pullRequest: false`);
  each selected `bug_report`/`feature_request`; and
  `.github/pull_request_template.md` only when `pullRequest` is true.
- A `files` destination is rejected when it equals a reserved destination or is
  an ancestor/descendant of one, reported at `$.files.<destination>`, for both
  `ensure` and `replace` in either module. Identical bytes never authorize the
  overlap.
- Only the destination is compared; a `files` `source` equal to a reserved path
  is valid. Prefixes that are not path segments (`.github/ISSUE_TEMPLATE2/...`,
  `config.yml.bak`) and any unselected fixed path stay valid.
- Malformed `templates`/`files` containers add no reservation and no new throw;
  existing validation errors are unchanged. `branchProtection`,
  `templates.issueWorkflow`, and `project.issueSync` remain rejected, and
  `assets/example.config.json` still validates.

## Limits

The comparison normalizes with host separators and folds case on
`win32`/`darwin`. Folding is conservative: on a case-sensitive volume it may
reject names that are actually distinct, and it never probes the native
filesystem. It does not resolve symlinks, hard links, or every alias a
case-insensitive volume can present. On POSIX a backslash is a literal filename
character, matching the write path, so it is not treated as a separator. A
general collision guard for future modules is not implemented.

## Tests and evidence

- New `tests/fixed-template-collisions.test.mjs`: 8 tests covering the four
  current fixed paths (equality and ancestor/descendant), the selection matrix,
  the four file/template mode combinations, non-collision prefixes, source-only
  and disabled selections, malformed inputs, the future-field/legacy boundary,
  and platform-exact case-fold/backslash host behavior asserted per
  `process.platform` (Linux does not execute the macOS/Windows branches).
- RED against unchanged `lib.mjs` (old 7 tests retained): 3 pass / 4 fail (four
  collision groups); the new host test passes on Linux baseline. GREEN: 8 / 0.
- Full `npm test` (`node scripts/run-tests.mjs`): 171 pass / 0 fail / 0 skipped,
  up from the 163-test baseline. Node 24.20.0, Linux.
- Budget against base `3ed43`: 62 lib + 4 reference + 284 test + 49 doc = 399
  add+del, under the 400-line cap.
