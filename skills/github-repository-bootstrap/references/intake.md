# Adaptive Intake

Build a manifest from facts, not defaults. Inspect the repository, remote, existing GitHub resources, and stack conventions first. Record each inference and its source. Ask only for values that cannot be established safely.

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

## CI And Security Handoff

Bootstrap owns the governance resources above. When the user wants build, test, or scan pipelines, hand off to the `github-ci-advisor` skill, which proposes and applies only after approval. When untrusted scripts, manifests, workflows, or agent docs need review, hand off to the read-only `repository-security-review` skill, which reports and escalates but applies nothing. Neither handoff is automatic and neither is authority to write workflows or change repository state.

## Boundaries

Never invent project governance, milestones, workflows, labels, owners, field values, or views. Do not treat an existing resource as managed unless the manifest says so. Produce the manifest for review, then follow `plan → explicit SHA authorization → apply → verify`; a plan is not authorization.
