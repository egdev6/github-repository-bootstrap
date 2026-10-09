# Execution Safety

Read this before planning or applying. It carries the executor detail that [`SKILL.md`](../SKILL.md) summarizes. `scripts/bootstrap.mjs` and `scripts/lib.mjs` remain the execution authority; this reference never overrides them and never adds schema fields, selection flags, or approval flags.

## Generic Repository Files

Configure generic repository files through the top-level `files` map: repository-relative destination keys and `source` values, each with explicit `ensure` or `replace`. Preflight sources and destinations under the actual repository root; reject absolute paths, traversal, symbolic links, non-regular files, and unsafe parents. Each entry is planned with its source and destination SHA-256.

The runtime rejects `files`-to-`files` destination conflicts at preflight. Configuration validation additionally rejects a `files` destination that equals, contains, or is contained by a **selected** fixed template destination: `.github/ISSUE_TEMPLATE/config.yml` whenever `templates` is present, each selected issue form, and `.github/pull_request_template.md` only when `pullRequest` is true. The rejection is an error at `$.files.<destination>` and applies to `ensure` and `replace` in both modules; identical bytes never authorize the overlap. The comparison is lexical and host-aware, so it does not resolve symlinks, hard links, or every alias a case-insensitive volume can present. Any overlap that only such an alias would create still needs manual review; a broader general collision guard is not available.

## Fixed Templates

Keep the fixed template set only: `bug_report`, `feature_request`, and the pull-request template. Configure them through `templates`: `issueForms`, `issueFormLabels`, `pullRequest`, and `mode`. `issueFormLabels` must reference labels already declared in `labels`; never add a missing label to satisfy validation. Arbitrary managed template files are out of scope.

Legacy `templates` remains accepted and operates unchanged during this transition; it may be configured alongside `files`.

## Plan And Authorization

Plan source and destination SHA-256 state. `ensure` creates only missing files; `replace` creates missing files and updates differing bytes. Apply only the exact authorized plan.

Run `plan` before mutation. Apply only after explicit authorization with the exact SHA-256 value from that reviewed plan; never reuse it after any config, target, discovery, or plan change. A plain plan is read-only evidence, never permission.

Require `gh`, authentication, applicable scopes, target access, and valid configuration before mutation. Run Projects v2 discovery, GraphQL, and mutations only when `project` is configured.

## Managed And Reconciliation Boundaries

`managed: false` gates updates to an existing resource but never disables a module; a module can still create missing resources. Leave is an intake decision — omit the optional module and re-plan, or stop the dependents — not a runtime selector or intent flag.

- Never delete, rename, or run a label assignment migration on an existing resource, at any stage.
- Read-only reconciliation, `adapt`, and `leave` never recolor or rewrite existing governance. Only an explicitly approved `apply` with `managed: true` may update the label color or description it declares for a managed label; renames and assignment migration stay forbidden at every stage.
- Apply a proposal only to its exact proposed resources and permitted settings; choose `managed: true` or `mode: "replace"` explicitly. Preserve every resource outside the proposal and invent no CI.
- Adapt never overwrites existing governance. Preserve existing names, colors, issue-form label mappings, project fields, and views.
- Conflicting project fields or duplicate linked projects fail for manual resolution; never select the first match.
- Unknown permissions stop the affected module's decision. Never reroute an unknown into an overwrite.

## Local Write Guarantees

Local writes use descriptor-relative traversal on Linux for race-free parent confinement. macOS and Windows provide a narrower guarantee: root confinement, symlink rejection, atomic sibling replacement, and permission preservation. Full TOCTOU race immunity requires Linux descriptor support. There is no bypass flag.

## Planned Modules (Not Available In This Release)

The modules below are policy for future reviewed units. They are **not implemented** here: the current schema and `validationErrors` reject their fields, and no CLI selection or approval flag exists for them. Do not place these fields in a manifest. This section is a contract for later work, not a current capability, and it never authorizes a future API call.

| Planned module | Manifest field rejected today | Supported |
| --- | --- | --- |
| Branch protection | `branchProtection` | No |
| Issue lifecycle workflow | `templates.issueWorkflow` | No |
| Project issue sync | `project.issueSync` | No |
| General file/template collision guard | none | No; only the selected fixed-template destinations above are guarded today |

Planned policy, kept here so it is never mistaken for current behavior:

- Branch protection would be classic only, never rulesets. It would manage only `requiredApprovingReviewCount` and `allowAdminBypass` (`enforce_admins`); every administrator can bypass, not one exclusive owner. Under `adapt` or `leave`, preserve stronger existing protections and every other protection flag. Under an explicitly approved `apply`, only the two managed branch-protection fields may change — even when the reviewed diff weakens protection (for example `requiredApprovingReviewCount` 2 → 1 or admin bypass false → true). The weakening diff must be shown and explicitly approved; no other protection flag may change, ever. Rulesets and unverifiable rules stay unsupported.
- The issue lifecycle workflow (`templates.issueWorkflow`, `.github/workflows/issue-lifecycle.yml`) would default on when `issueForms` is non-empty and require the canonical `status:needs-review`, `status:approved`, and `status:in-progress` labels. A canonical constraint that cannot be adapted needs a human choice: add the canonical labels, opt out, or stop.
- Project issue sync (`project.issueSync`, `.github/workflows/project-issue-sync.yml`) would install only after the project is created or linked, the repository secret metadata is present, and the token's project write capability is confirmed. Credential separation: local discovery uses the operator's `gh` token only to check capability and secret metadata; the stored credential is verified only at runtime by the workflow itself. No command reads a secret value.
