---
name: github-repository-bootstrap
description: "Trigger: GitHub repository bootstrap, labels, milestones, issue templates, PR templates, Projects v2, project fields, project views. Plan and apply reusable repository bootstrap safely."
license: MIT
metadata:
  author: gentleman-programming
  version: "1.0"
---

# GitHub Repository Bootstrap

## Activation Contract

Use for repeatable GitHub repository setup, especially when the target already has governance. `assets/config.schema.json` is the configuration contract; `scripts/bootstrap.mjs` is execution authority. Start with read-only reconciliation and read [execution safety](references/execution-safety.md) before planning.

## Hard Rules

- Infer repository, account, stack, and existing governance before asking. Ask only unresolved values open-ended; never invent governance.
- Reconcile before defining: inventory every activated module read-only, classify each resource, and present per-module decisions from [adaptive intake](references/intake.md). Disabled modules cause no module-specific API calls.
- Build a reviewed manifest from confirmed facts and decisions. Labels, milestones, files, templates, and Projects v2 are optional; omit a module to leave it out. `managed: false` gates updates but never disables a module.
- Preserve configured resources: discover before every ensure, create missing resources, update only `managed: true` resources or `mode: "replace"` templates, and never delete.
- The file, template, and reconciliation boundaries in [execution safety](references/execution-safety.md) are mandatory.
- Run `plan` before mutation; apply only with the exact SHA-256 authorization value from that reviewed plan, and never reuse it after any config, target, discovery, or plan change.
- Require `gh`, authentication, applicable scopes, target access, and valid configuration before mutation.

## Decision Gates

| Situation | Action |
| --- | --- |
| Resource matches the manifest | Skip safely, report alignment, ask nothing. |
| Resource missing, module intended | Propose a create; confirm intent only if not already explicit. |
| Resource differs or is incompatible | Ask one per-module choice: `apply`, `adapt`, or `leave`. |
| Discovery or permission unavailable | Never assume absent; stop that module's decision. |
| No interactive authority | Stop with a decision-required handoff; invent no flags. |
| Decision, manifest, or state changed | Reconcile again and regenerate the final plan. |

## Execution Steps

1. Follow [adaptive intake](references/intake.md): reconcile read-only, decide per module, then build the manifest.
2. Validate the reviewed manifest against the schema.
3. Plan: `node .pi/skills/github-repository-bootstrap/scripts/bootstrap.mjs --config governance.json --mode plan`.
4. Review the report and approve its exact authorization value.
5. Apply that command with `--mode apply --authorize '<authorization.value>'`.
6. Verify the report, archive it, report unsupported views, and record the decision ledger.

## Output Contract

Emit one JSON report with validation, discovery, plan, completed, skipped, and failure evidence; nonzero exit never claims success and partial mutations stay visible. Return the reconciliation ledger separately in the response or a local artifact — module, state, source, proposed diff, user decision, revised manifest — without new schema fields or approval flags. A plain plan is read-only evidence, never permission.

## References

- [Adaptive intake](references/intake.md)
- [Execution safety](references/execution-safety.md)
- [CI advisor](../github-ci-advisor/SKILL.md)
- [Repository security review](../repository-security-review/SKILL.md)
- [Configuration schema](assets/config.schema.json)
- [Example configuration](assets/example.config.json)
- [Bootstrap executor](scripts/bootstrap.mjs)
