# B01 execution safety

Refs #13. Documentation-only slice for the bootstrap skill; no runtime change.

## What this slice adds

- `references/execution-safety.md`: executor detail moved out of `SKILL.md`, the
  current file, template, plan, managed, and local-write boundaries, and a
  clearly marked `Planned Modules (Not Available In This Release)` boundary.
- `SKILL.md`: a new `Decision Gates` section in the style-guide order, plus the
  execution-safety link. Detail moved, not dropped, to stay under 1000 tokens.
- `references/intake.md`: read-only reconciliation gate, classification,
  per-module `apply`/`adapt`/`leave`, decision dependencies, and the ledger.

## Tests and evidence

- New `tests/intake.test.mjs`: 12 section-bound cases (6 RED before wiring, then
  12 GREEN), cross-checked against the shipped schema and validator.
- Full `npm test`: 77 to 89 passing; Gitleaks 4 and actionlint 4 fixtures pass.
- Local Node 24/Linux only. Remote CI evidence is pending.

## Availability and risks

- Planned modules are NOT available: current schema and `validationErrors` reject
  `branchProtection`, `templates.issueWorkflow`, and `project.issueSync`.
- Files-vs-fixed-template overlap needs manual review; a runtime collision guard
  is planned, not shipped, so no current guarantee is claimed.
- No schema, workflow, version (stays 1.1.0), or release change; no publication.
