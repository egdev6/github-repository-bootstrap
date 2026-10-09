# B01 project-sync renderer (U4b)

U4b ships the pure renderer that materializes a project-sync template from
explicit parameters. It is inert data plumbing: no asset is copied, no schema,
CLI flag, default, installer, or workflow is added, and the published validator
still rejects `project.issueSync` and `templates.issueWorkflow`.

## API

`scripts/project-sync-renderer.mjs` exports one function
`renderProjectIssueSyncWorkflow(templateText, { owner, title, secretName })`
returning a string. It imports only `node:buffer`, reads no file, environment,
credential, or API, holds no defaults (no implicit `GH_PROJECT_TOKEN`), mutates
neither argument, and is deterministic across calls.

## Slots, encoding, and validation

Only three markers are materialized, each exactly once in the original text:
`__SECRET_NAME__`, `__PROJECT_OWNER__`, `__PROJECT_TITLE_BASE64__`. Substitution
is a single pass over the original, so inserted values are never rescanned: a
secret name literally reading `__PROJECT_TITLE_BASE64__` stays literal instead of
becoming the encoded title. Adjacent known markers are allowed and each replaced
once; any other `__UPPERCASE_MARKER__` in the original is rejected before
replacement, while legitimate `${{ github.repository }}` / `${{ github.actor }}`
and prefix/suffix bytes, including LF/CRLF, are preserved.

- The secret NAME (never a value) goes raw inside the existing `secrets.*`
  expression and must match `[A-Za-z_][A-Za-z0-9_]*` with no case-insensitive
  `GITHUB_` prefix and no control character or line terminator anywhere.
- `owner` is a non-empty ASCII login of at most the canonical 39 characters,
  quoted via `JSON.stringify` as `PROJECT_OWNER: "acme-org"`. `title` is
  non-empty, at most the canonical 255 UTF-16 code units, must round-trip
  through UTF-8 so lone surrogates are rejected, and is UTF-8 base64-encoded and
  `JSON.stringify`-quoted, so it can never become a raw YAML scalar, shell
  fragment, or Actions expression.
- Parameters must be a plain or null-prototype object with exactly the three own
  keys owner, title, and secretName (enumerable or hidden); foreign prototypes,
  arrays, and extra hidden or symbol keys are rejected. Errors never echo values.

This slice covers only the pure-renderer portion of donor case S05. The real
project-sync asset shape is U4c and the normalized manifest→renderer adapter is
U5, as are schema/config availability and runtime/remote integration. The
renderer does not parse YAML, execute a workflow, or sandbox a caller, and makes
no claim that a caller passed a valid workflow.
