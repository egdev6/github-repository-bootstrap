# Adaptive Intake

Build a manifest from facts, not defaults. Inspect the repository, remote, existing GitHub resources, and stack conventions first. Record each inference and its source. Ask only for values that cannot be established safely.

## Read-Only Reconciliation Gate

Run a read-only reconciliation before the final manifest and before `plan`. It inventories every activated module and changes nothing. Disabled modules trigger no module-specific API calls; global authentication and repository-binding reads still occur. Treat every discovery result as evidence, never as permission to manage or change a resource.

| Module | Inventory (read-only) |
| --- | --- |
| Labels | Declared labels and, if access permits, labels currently used by issues and pull requests. Never relabel, rename, recolor, or delete. |
| Milestones | Declared milestones and existing milestones, with open/closed and due state. |
| Files | Each `files` destination under the repository root, with presence and content hash. |
| Fixed templates | `bug_report`, `feature_request`, and the pull-request template as they exist in `.github`. |
| Projects v2 | Whether a matching project is linked, plus its fields and views. |

## Classification

Classify each resource, not just each module. Record the source and how complete the evidence is.

| State | Meaning |
| --- | --- |
| Matching | Present and equivalent to the manifest intent. Safe to skip; report the alignment. |
| Missing | Absent while the module is intended. Propose a create. |
| Different | Present but differs from the manifest intent. |
| Partially applied | Some resources match and others do not inside the same module. |
| Unknown / unsupported | Access or capability is unavailable, or the shape cannot be verified. Never assume "not found" on unavailable evidence. |

A module may hold mixed per-resource states. Expose each exact conflict instead of collapsing the module to a single verdict.

## Per-Module Decision Gate

Matching resources need no question, but record the alignment. Missing resources are proposed as creates; ask for module intent only when it was not already explicit. For every difference or incompatible existing resource, ask one closed question per affected module:

| Choice | Effect |
| --- | --- |
| `apply` — Apply manifest proposal | Follow the manifest for the exact proposed resources only. |
| `adapt` — Adapt current governance | Preserve existing governance and propose only the missing resources the user agrees to add. |
| `leave` — Leave untouched | Make no change to that module. |

Rules:

- Ask up to four questions per batch when Pi interactivity allows; keep resource values free-form and never force example names.
- `apply` requires explicitly choosing `managed: true` or `mode: "replace"` and applies only the permitted settings in the proposal. Preserve everything outside the proposal, delete nothing, migrate no labels, and invent no CI.
- `adapt` preserves existing names, colors, issue-form label mappings, project fields, and views.
- `leave` is structural, never a runtime flag: omit the optional module (`labels`, `milestones`, `files`, `templates`, `project`) and re-plan. There is no CLI leave selector or intent flag. `managed: false` does not disable a module; it still creates missing resources and only gates updates of existing ones.
- File and template modes stay exact: `ensure` creates missing and preserves existing; `replace` creates missing and updates differing bytes.
- Unknown permissions or capability stop that module's decision; never reroute it into an overwrite.

## Decision Dependencies

Revisit dependent defaults after every decision; never silently re-enable an opt-out.

- Issue-form label mappings (`templates.issueFormLabels`) depend on labels; leaving labels must create none of them.
- Leaving the templates module removes only its templates; it never creates label associations.

## Leaving Labels And Dependencies

`templates.issueFormLabels` maps labels onto issue forms, so leaving the labels module affects every dependent. Omit labels only when no dependent needs a label the repository lacks.

- Never add a missing label merely to satisfy schema or dependency validation, and never relabel existing issues.
- If dependents reference labels, the human must choose one of:
  - (a) Keep only the verified existing referenced labels, declared `managed: false` so the schema validates and the plan updates nothing. Missing labels are not allowed under `leave` and nothing is created. Report the label resource as retained and preserved — never as the module "disabled" — and require the final plan to show every label skip. Drift then invalidates the authorization value and forces a re-plan.
  - (b) Disable or remove the dependents or their label associations, explicitly reviewed.
  - (c) Stop the run.
- When the referenced labels already exist, retention is allowed: keep the known existing keys unmanaged with no mutations. Do not claim leaving labels is impossible.
- Record every label dependency and retained resource in the decision ledger, and never perform a silent opt-out.

## Non-Interactive Runs

Without an interactive authority, do not guess. Stop with a decision-required handoff that lists the open per-module questions and the safe default of changing nothing. Invent no default-approval flags. The executor CLI stays non-interactive and keeps its existing `plan` and `apply` commands.

## Plan Evidence And Re-Planning

A plain `plan` is read-only evidence. It emits an authorization value, but that value is not permission and is never approval. Regenerate the final plan whenever a decision, the manifest, or discovered state changes.

## Decision Ledger

Record the reconciliation outcome in the response or a local review artifact, not in the schema and not as new config fields. Capture, per module: module, state, source, proposed diff, user decision, revised manifest. Do not fabricate selection or approval flags, and do not let a global all-defaults approval override any per-module decision. The reviewed plan still requires its own explicit SHA authorization before apply.

## Inferable Facts

Infer the repository target, owner/account candidate, remote binding, stack, existing labels, milestones, generic files, legacy templates, and Projects v2 state when access permits. Treat discovery as evidence, not permission to manage or change anything.

## Required User Decisions

Use open-ended questions for the intended repository outcome, ownership when discovery is ambiguous, and the exact resources to manage. Confirm resource names, descriptions, colors, dates, generic file sources, destinations and modes, template mode, project title, fields, options, and views only when the user elects that module. Accept arbitrary valid values; do not constrain answers to example names or project-specific terminology.

## Optional Modules

- **Git:** local repository binding and fixed template installation require a writable target repository.
- **GitHub:** labels and milestones are independent optional modules.
- **Projects v2:** a `project` manifest enables project discovery, linkage, fields, views, Project scopes, and GraphQL. Omit it to disable all Projects v2 work.
- **Files:** configure generic repository files through top-level `files`: each destination key and `source` must be repository-relative, regular, and confined to the actual repository root; each entry explicitly selects `ensure` or `replace`.
- **Templates:** configure the current fixed issue-form and pull-request templates, or omit `templates`. Legacy `templates` remains accepted unchanged during the transition and may be used alongside `files`. Arbitrary managed template files are a later module.

## Planned Modules (Not Available In This Release)

The modules below are not part of the current manifest or CLI. The current schema and `validationErrors` reject their fields; do not plan them, and do not invent a leave selector or flag for them.

| Module | Field rejected today |
| --- | --- |
| Issue lifecycle workflow | `templates.issueWorkflow` |
| Branch protection | `branchProtection` |
| Project issue sync | `project.issueSync` |

When they ship, `leave` would omit `branchProtection` like the current optional modules; until then the field is invalid.

## CI And Security Handoff

Bootstrap owns the governance resources above. When the user wants build, test, or scan pipelines, hand off to the `github-ci-advisor` skill, which proposes and applies only after approval. When untrusted scripts, manifests, workflows, or agent docs need review, hand off to the read-only `repository-security-review` skill, which reports and escalates but applies nothing. Neither handoff is automatic and neither is authority to write workflows or change repository state.

## Boundaries

Never invent project governance, milestones, workflows, labels, owners, field values, or views. Do not treat an existing resource as managed unless the manifest says so. Produce the manifest for review, then follow `plan → explicit SHA authorization → apply → verify`; a plan is not authorization.
