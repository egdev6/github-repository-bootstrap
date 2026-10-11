# Native Project CLI verification

Refs #15. Exercise the already shipped plan/apply executor with independent,
exact-argv local replies. This unit changes test infrastructure, not product behavior.

## Review path

1. Read the fixed-target protocol oracle in tests/helpers/project-cli-fixtures.mjs.
2. Follow the immediately consuming Project CLI scenarios in fixed-template-renderer.test.mjs.
3. Compare completed/skipped/failure evidence and the exact read/write command order.

## Evidence boundaries

- Plan is read-only; apply requires its exact authorization and reports partial mutations.
- Missing and unlinked Projects create/link, refresh exact identity, then handle fields/views.
- Matching existing fields, existing views and unrelated resources are preserved.
- Test view layout and selected field input, identity, pagination, malformed JSON and permission errors.
- Known unavailable view capability remains a reported skip; unexpected failures stop.
- Unknown stub calls still fail closed; fixtures read no credentials or secret values.
- Original mixed native15cases/90assertions and shared CLI helper cases remain present.
- Deterministic fixtures are not live Projects, credential proof or hosted-platform evidence.

## Next step

Run verification only with separate authorization. #15 remains incomplete:
workflow activation, remaining scenarios and acceptance still need their own units.
No runtime flags, version, package metadata, release, roadmap or issue state changes.
