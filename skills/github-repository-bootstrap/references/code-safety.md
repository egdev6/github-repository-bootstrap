# Code safety in new bootstrap plans

Propose `"codeSafety": { "mode": "ensure" }` in newly authored manifests by default.
Review the proposal and approve its exact bootstrap plan before installing anything.
Existing manifests are not changed automatically; omission or `false` keeps the module inactive.

## Quick path

1. Inspect `.github/workflows/code-safety.yml` without executing target scripts.
2. Record missing, matching or different state in the reconciliation ledger.
3. Propose `codeSafety` in the new manifest, or honor an opt-out. An existing workflow is preserved in `ensure` mode; replacing it requires an explicit reviewed `replace` decision.
4. Run `plan`, inspect the source/rendered/destination evidence, approve that exact SHA authorization, then `apply` and verify the report.
5. Publication, workflow execution, required checks and branch protection remain separate decisions.

## Configuration

```json
{
  "account": "acme-org",
  "repository": "acme-org/widgets",
  "codeSafety": { "mode": "ensure" }
}
```

| Selection | Effect |
| --- | --- |
| Omitted or `false` | No workflow observation or installation; does not uninstall an existing workflow |
| `{ "mode": "ensure" }` | Create only if missing; preserve any existing file |
| `{ "mode": "replace" }` | Create missing or replace differing bytes after exact plan approval; equal bytes skip |
| `policy` inside the object | Optional objective checker policy, explicitly reviewed and rendered as static workflow data |

The executor does not infer this module from labels, templates, stack or existing configuration.
The default is an intake/example proposal, not a silent runtime default or an approval flag.
Generic `files` cannot own the same destination while this native module is active.
Source, rendered policy and destination drift invalidate the plan; re-plan instead of bypassing the guard.

## Trust and scope

- Control tools: public `egdev6/quorb` at reviewed commit `176ae636fdd80ce60d6fffec188ce558c5f6692b`. This cross-repository dependency is deliberate, visible and immutable; it never follows `main`.
- Target: the workflow event commit in a separate checkout, consumed as inert Git blobs. No target package installs, hooks, scripts, builds or local actions execute in this job.
- Tools and policy controls come from the reviewed control baseline or static approved workflow data, never the target's policy file.
- Events: pull requests, manual dispatch and pushes to `main`. If the default branch is not `main`, pushes to that branch do not trigger this asset; disclose the limitation rather than claim automatic coverage of all default branches.
- Default coverage: Semgrep for JS/TS and zizmor for GitHub Actions workflows. Findings are advisory; scanner errors, parse failures and unknown coverage fail closed.
- Actions and Linux runtime are pinned; wheels are checked against the trusted manifest. Scanner containers are ephemeral, read-only and offline. Hosted runners and the Node major are platform dependencies, not hermetic pins.

This is not a universal malware detector. Rust, arbitrary languages, all exfiltration and every form of obfuscation are not certified. A passing job can contain advisory findings: inspect its report.
A PR can change its own workflow; enforced review and branch protections are separate requirements.

## Optional repository policy

Omit `policy` to run only Semgrep and zizmor. To add objective repository checks, supply the supported policy object explicitly: schema version, text limit, allowed symlinks and root lifecycle hooks, empty bidi exceptions, and optional image path/SHA256 approvals.
Review exclusions for this exact repository; do not inherit Quorb's image approvals, trust a policy submitted by a PR, or auto-approve unknown binary assets.
The rendered policy is part of the authorized workflow bytes. Updating it needs a fresh plan and human review.

## Cost and delivery

Each run provisions verified wheels and a pinned runtime image on Ubuntu; budget download bandwidth, installation time and up to the configured 20-minute timeout. No global tool installation is required.
Opt-out preserves existing files and credentials. Bootstrap never deletes a workflow or configures required checks, secrets or branch protections as part of this module.
Rollback of a published adoption is a separately reviewed revert, not an automatic bootstrap deletion.
