# B01 workflow inventory

Refs #13. Read-only foundation slice before a future actionlint CI gate
(`docs/odd/b01-ci-chain.md`). Targets `main`; discovery only, not linting.

## What this slice adds

- `scripts/workflow-inventory.mjs` exports `discoverWorkflows(root)` plus the
  canonical CLI entry guard from `scripts/run-tests.mjs`.
- Discovery returns sorted repository-relative `.yml`/`.yaml` paths under
  `.github/workflows` and every `skills/*/assets/templates`, registered or not.
- Exact-path exemption only for the bootstrap skill issue forms `bug_report.yml`,
  `feature_request.yml`, and `config.yml`. The signature is plain root
  `name`/`description`/`body` (or `blank_issues_enabled`) with no root
  `on`/`jobs`; changed shapes, quoted keys, or other names stay in scope.
- Missing or empty `.github/workflows` fails closed. Every inventory path is
  lstat'ed: a symlinked workflow root, child, file, or skill entry is refused,
  never followed, and a broken link is still refused (no `existsSync` probe).
  The Windows file-symlink fixture is POSIX-only because creating it needs
  elevation; directory junctions are treated as portable but are not natively
  verified in this slice.
- Ordinary non-directory skill entries such as `skills/README.md` are skipped,
  so a legitimate skill index never fails the inventory; only then are
  `assets/templates` namespaces resolved and non-directory namespaces rejected.
- The CLI derives the repository root from its own module path, not the ambient
  working directory, and emits only classified relative-path errors.

## Tests and evidence

- `workflow-inventory.test.mjs`: 13 focused tests; `npm test` 67 pass / 0 fail
  (54 pre-existing). The regression RED was `ENOTDIR` on `skills/README.md`;
  GREEN is 13/13. The live-repository test asserts the release workflow is
  included, the three exempt forms stay out, and paths are sorted relative YAML;
  the CLI test compares against `discoverWorkflows` instead of a snapshot.
- Manual actionlint 1.7.12 against the discovered JSON argv is clean.

## Deferrals

Not complete #13: wiring actionlint acquisition into CI and later consumers are
deferred. Remote CI is pending; evidence is local only.
