# B01 advisory skills (U1)

This records local preparation; delivery and SHA-bound remote evidence are tracked separately in the PR.

## Scope

- Register two advisory skills: `skills/github-ci-advisor/` and `skills/repository-security-review/`.
- Wire them into `package.json` (`pi.skills`), the bootstrap `SKILL.md` cross-links, the `intake.md` handoff, and the README skill table.
- Add structural tests in `skills/github-repository-bootstrap/tests/advisor.test.mjs`.
- No runtime, schema, template, workflow, or default changes.

## Local evidence

- Four new skill docs: 186 lines (53 + 46 + 53 + 34).
- Structural advisor test: 138 lines, 8 cases; frontmatter checks exercise both LF and CRLF on every platform.
- Windows exposed an LF-only assertion; the explicit CRLF reproduction failed before the fix. No skip, workflow change, or metadata check removal was used.
- Local suite observed 77 passing (69 baseline + 8); gitleaks 4 and actionlint 4 fixtures pass on the local Node 24 toolchain.

## Availability

- `package.json` `pi.skills` is the discovery contract for a trusted package that Pi loads or reloads; a local path can also load without install settings, for example `pi -e <path>`.
- The `.atl/skill-registry.md` index is a delegator cache, not a Pi loading prerequisite.
- Runtime load, reload, and trust were not tested here, so no verified loading claim is made.
- Remote CI evidence is PENDING; remaining roadmap modules (issue workflow, project issue sync, branch protection) are not implemented or claimed here.
