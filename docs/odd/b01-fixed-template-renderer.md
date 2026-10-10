# B01 fixed-template descriptors and renderer

A behavior-preserving extraction, immediately consumed by native
`installTemplates`; it adds no configuration, CLI argument or plan resource.

## Contract

- The helper accepts the installer's validated templates container. Descriptors
  carry `source`, POSIX `target` and `labelKey`: config, forms in manifest order,
  then PR iff truthy. They reuse `fixedTemplatePaths`, return fresh records and
  add no filtering, normalization or validation.
- Rendering replaces only the first `__LABELS__` for a truthy form key using
  `JSON.stringify(labelValues[labelKey] ?? [])`. Config and PR have no label
  key; their text, markers, Unicode and line endings remain unchanged.
- The installer still resolves assets through `sourceTemplate`, targets through
  platform `path.join`/`path.relative`, and checks `templateDestination` before
  skipping an existing destination in `ensure`, before any installer asset read.
  The old skip reason, order and create/update reports remain; `replace` always
  writes, even when bytes match.
- Local path discovery, preflight, ownership guards, `lib.mjs`, `buildPlan`,
  discovery and authorization inputs stay unchanged: no new state or hashes.

## Boundaries and follow-up

Existing symlink, collision, platform, alias, race and rollback limits remain.
Tests use independent shipped-asset goldens and read-only native gh fixtures;
skip-before-read is structural placement, not instrumented runtime evidence.
Package 1.1.0 remains: no release, migration default or workflow activation.
Byte binding remains separate future work; full #15 acceptance stays open.
#15 is offline, #17 is live, and API #49 is independent.
