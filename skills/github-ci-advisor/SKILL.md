---
name: github-ci-advisor
description: "Trigger: CI advisor, build pipeline, test pipeline, GitHub Actions, CI audit, security check, CI evolution. Propose, and only after approval apply, least-privilege CI for an existing repository."
license: MIT
metadata:
  author: gentleman-programming
  version: "1.0"
---

# GitHub CI Advisor

## Activation Contract

Use when the user asks for CI advice, build/test pipeline help, a CI audit or security check, or CI evolution (add, modify, retire). Do not activate automatically during repository bootstrap, and invent no fixed CI manifest or unknown schema fields. It proposes, applies only after explicit approval, and never commits, pushes, releases, deploys, or enables checks or protection.

## Hard Rules

- Discover read-only: read manifests, lockfiles, and script definitions; inspect workflows, triggers, action pins, permissions, and required checks. Use the API for required checks only with authorized, valid access. Never run project scripts, install hooks, or execute downloaded code as discovery.
- Propose from observed commands only: build, typecheck, and tests when they exist, otherwise a smoke check. Ask the human for unset requirements, skip unwanted modules, and never guess a universal CI from an assumed npm project.
- Pin every action to an immutable SHA with human-verified provenance; without verified provenance, stop with unresolved pins and invent no SHA, version, dependency, or code.
- Least privilege: `contents: read`, no secrets to forks, no privileged checkout of a pull-request target. Run untrusted pull-request code only sandboxed without secrets or a writable token; containers reduce risk but are not an absolute sandbox.
- Baseline with a pinned secrets scanner (e.g. a verified-ref Gitleaks action), a secrets-permissions review, and a human read-only repository-safety review. Never claim an action detects prompt injection. Run deterministic scanners only when installed and approved, fetch external evidence only when safe, invent nothing.
- Retire a check only when proven redundant or obsolete; preserve required check names or explicitly warn that branch rules depend on them and need a separate manual change, since branch protection does not manage checks.
- Ask approval before any repository or file mutation, before commands that run project code, and before hooks or network access. Proposal approval is not authority to deploy.
- Re-plan after any config, state, or evidence change.

## Decision Gates

| Situation | Action |
| --- | --- |
| Stack or commands unverifiable | Ask the human; guess no pipeline. |
| Action ref lacks a verified immutable SHA | Stop with unresolved pins. |
| User wants deploy or CD | Out of scope; stop. |
| Removing a check branch rules depend on | Warn, keep the name, require a separate manual change. |
| Module not requested | Skip it; no API call, no workflow. |

## Execution Steps

1. Reconcile read-only: stack, commands, workflows, triggers, pins, permissions, and required checks.
2. Use [CI review](references/ci-review.md) for the growth-advisory table and plan ledger.
3. Propose a plan that materializes repository-local sources into `.github/workflows` via the existing files map with `ensure` or `replace`, adding no CI fields elsewhere.
4. Run bootstrap `plan`; request approval of its exact emitted authorization value.
5. Apply per workflow only after approval; never commit, push, auto-enable checks or protection, or run CD.
6. Re-plan on any change.

## Output Contract

Return the plan ledger: current state, evidence, proposed change (add/modify/retire), priority, cost, approval, checks, verification, rollback, and unresolved items. The user may apply per workflow, adapt, or leave each item. Never claim a files-map delete or an unrun mutation.

## References

- [CI review](references/ci-review.md)
- [Repository security review](../repository-security-review/SKILL.md)
