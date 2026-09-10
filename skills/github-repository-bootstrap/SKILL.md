---
name: github-repository-bootstrap
description: "Trigger: GitHub repository bootstrap, labels, milestones, issue templates, PR templates, Projects v2, project fields, project views. Plan and apply reusable repository bootstrap safely."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

# GitHub Repository Bootstrap

## Activation Contract

Use for repeatable GitHub repository setup. Treat `assets/config.schema.json` as the configuration contract and `scripts/bootstrap.mjs` as execution authority.

## Hard Rules

- Infer repository, account, stack, and existing governance facts before asking. Ask only unresolved values through open-ended input; never invent governance.
- Generate a reviewed manifest from the confirmed facts. Resource modules are optional: labels, milestones, generic repository files, legacy templates, and Projects v2. Omit an unwanted module; the normalized manifest disables it.
- Preserve configured resources: discover before every ensure, create missing resources, update only `managed: true` resources or templates with `mode: "replace"`, and never delete.
- Configure generic repository files through the top-level `files` map: repository-relative destination keys and `source` values, each with explicit `ensure` or `replace`. Preflight sources and destinations under the actual repository root; reject absolute paths, traversal, symbolic links, non-regular files, and unsafe parents.
- Plan source and destination SHA-256 state. `ensure` creates only missing files; `replace` creates missing files and updates differing bytes. Apply only the exact authorized plan.
- Legacy `templates` remains accepted and operates unchanged during this transition; it may be configured alongside `files`.
- Keep the fixed template set only: `bug_report`, `feature_request`, and the pull-request template. Arbitrary managed template files are out of scope.
- Run `plan` before mutation. Apply only after explicit authorization with the exact SHA-256 value from that reviewed plan; never reuse it after any config, target, discovery, or plan change.
- Require `gh`, authentication, applicable scopes, target access, and valid configuration before mutation. Run Projects v2 discovery, GraphQL, and mutations only when `project` is configured.
- Local writes use descriptor-relative traversal on Linux for race-free parent confinement. macOS and Windows provide a narrower guarantee: root confinement, symlink rejection, atomic sibling replacement, and permission preservation. Full TOCTOU race immunity requires Linux descriptor support. There is no bypass flag.

## Execution Steps

1. Follow [adaptive intake](references/intake.md), then validate the reviewed manifest against the schema.
2. Plan: `node .pi/skills/github-repository-bootstrap/scripts/bootstrap.mjs --config governance.json --mode plan`.
3. Review the JSON report and obtain explicit approval.
4. Apply with its exact value: `node .pi/skills/github-repository-bootstrap/scripts/bootstrap.mjs --config governance.json --mode apply --authorize '<authorization.value>'`.
5. Verify the report, archive it, and report unsupported views without emulation.

## Output Contract

Emit one JSON report with validation, discovery, plan, completed, skipped, and failure evidence. Nonzero exit never claims success; reported partial mutations remain visible.

## References

- [Adaptive intake](references/intake.md)
- [Configuration schema](assets/config.schema.json)
- [Example configuration](assets/example.config.json)
- [Bootstrap executor](scripts/bootstrap.mjs)
