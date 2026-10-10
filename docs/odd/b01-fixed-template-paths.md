# B01 shared fixed-template path assembly

This unit shares path assembly between the existing validator collision
reservation and native CLI discovery/preflight. It enables no new module.

## Contract

- Keep config.yml first, selected forms in manifest order, and the optional
  pull-request template last. Return fresh arrays without changing inputs.
- The validator retains tolerant malformed-container handling, filters only
  known forms and reserves the pull-request path only for boolean true.
- Native callers retain their raw map/posix-path/truthy selection behavior;
  invalid arrays still fail before a callback with the same TypeError wording.
- The helper receives selected form destinations, not raw form names. It is not
  a schema validator and does not turn unchecked inputs into trusted paths.
- Keep existing confinement, collision, symlink and platform race guarantees.
  This extraction adds no alias protection, workflow hashes or authorization.
- Existing ensure/replace modes, SHA generation, template writes and public
  plan/apply arguments are unchanged. No new credentials, API calls or CD.

## Verification

New tests exercise ordered selections, fresh results, both modes, reserved and
unreserved paths, ancestor/descendant collisions, malformed containers and
native preflight callback behavior without filesystem fixture writes.
Existing collision, intake, native CLI and full-suite checks remain mandatory
when an implementation candidate is separately authorized and materialized.
RAM preparation and equivalence checks do not establish a passing native suite.

## Boundary

Lifecycle, project-sync and branch-protection fields remain rejected.
Their schema/normalization/hash/installation work and all acceptance obligations
remain pending in #15. The independent API candidate #49 is not a prerequisite.
Source writing, publication, delivery, assignment, closure and version/release
each require their applicable separate authority.
