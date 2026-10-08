# CI Review

Detail for [the CI advisor skill](../SKILL.md): read-only discovery, the evidence-based growth table, and the per-item plan ledger. It is advisory guidance, not an executable scanner and not a guarantee that a pipeline is complete or secure.

## Read-Only Discovery

| Surface | Read |
| --- | --- |
| Stack | Manifests, lockfiles, and script definitions only. Never install, run scripts, or execute downloaded code. |
| Existing CI | Workflows, jobs, triggers, runners, action pins, permissions, and concurrency. |
| Required checks | Actual branch-protection or ruleset state through the API, only when authorized and access is valid. |
| Runtime | Version files and supported-version evidence already in the repository. |

Classify each surface as present, missing, different, or unknown. Never treat unknown as absent.

## Growth Advisory

Propose a change only from repository evidence, never from a weekly schedule or file counts alone.

| Evidence change | Proposal | Rationale, cost, and risks |
| --- | --- | --- |
| Multiple packages or workspaces | Add path filters and per-package jobs, or a dependency-coverage job | Avoids unrelated runs; risks missed cross-package breakage if filters are wrong. |
| Database or service integration points | Add integration tests in an isolated service | Improves confidence; slower and needs a sandbox with no secrets. |
| Several supported runtime versions | Add a version matrix | Confirms compatibility; multiplies runtime cost and can hide flaky combinations. |
| New or changed dependencies | Add SCA and license checks | Surfaces vulnerable or incompatible licenses; adds noise and false positives. |
| Caches present or planned | Review cache keys and staleness | Faster builds; stale caches can pass on old artifacts. |
| Coverage available | Report it without inventing a threshold | Useful signal; a fabricated gate blocks unrelated work. |
| Lockfiles present | Verify the install is reproducible in CI | Prevents drift; may require a frozen-lockfile command. |
| Slower checks accumulating | Split fast and heavy jobs, add timeouts and concurrency | Keeps feedback fast; too much concurrency can starve runners. |
| Release or publish artifacts | Defer to a later CD proposal | Out of scope for this skill; never auto-deploy. |

Retire a check only when it is proven redundant or obsolete. Preserve its required-check name unless you explicitly warn that branch rules depend on it and require a separate manual change; branch protection does not manage required checks.

## Secret Scanning Baseline

Prefer an installed, approved deterministic scanner, such as a Gitleaks action pinned to a human-verified immutable ref. When no verified ref is available, leave the pin unresolved rather than inventing a SHA. Pair it with a secrets-permissions review and a human, read-only repository-safety review; never claim an action automatically detects prompt injection.

## Plan Ledger

Record one row per proposal: current state, evidence, proposed change (add/modify/retire), priority, cost, approval, checks, verification, rollback, and unresolved items. The user applies per workflow, adapts, or leaves each item. The [bootstrap executor](../../github-repository-bootstrap/SKILL.md) produces the JSON plan and its exact authorization value; never compose or invent a hash. That value is applied only after approval and is never permission to commit, push, enable checks or protection, or deploy.

Before drafting repository-local sources or a manifest, show the intended paths and scope and obtain permission to write those review artifacts. Draft permission is not apply permission: run the executor's read-only `plan`, review its exact proposed destination changes, obtain approval of the emitted value, then run `apply` with that value. Re-plan if any source, destination, manifest, or discovered state changes.

## Boundaries

Do not write workflows in the repository under review without approval, add CI fields to an unrelated schema, execute project code to discover commands, or act as an executable scanner.
