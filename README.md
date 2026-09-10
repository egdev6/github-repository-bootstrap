<a id="readme-top"></a>

<div align="center">
  <h1>GitHub Repository Bootstrap</h1>
  <img width="3468" height="1198" alt="Sin título" src="https://github.com/user-attachments/assets/a095690f-0d24-45f2-8e3e-813e2e5fcace" />
  <p><strong>Plan repeatable GitHub repository setup before anything changes.</strong></p>
  <p>A Pi skill for repository governance: labels, milestones, repository files, issue and pull-request templates, and optional Projects v2 setup.</p>
  <p>
    <a href="https://github.com/egdev6/github-repository-bootstrap/releases"><img src="https://img.shields.io/github/v/release/egdev6/github-repository-bootstrap?display_name=tag" alt="Release"></a>
    <a href="https://github.com/egdev6/github-repository-bootstrap/actions/workflows/release.yml?query=branch%3Amain"><img src="https://github.com/egdev6/github-repository-bootstrap/actions/workflows/release.yml/badge.svg?branch=main" alt="CI"></a>
    <a href="https://github.com/egdev6/github-repository-bootstrap/issues"><img src="https://img.shields.io/github/issues/egdev6/github-repository-bootstrap" alt="Issues"></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/egdev6/github-repository-bootstrap" alt="MIT License"></a>
  </p>
</div>

> **Read the plan before you authorize it.** This package discovers the target state, emits a machine-readable plan, and applies changes only when given the exact authorization value from that plan. It does not delete GitHub resources.

<details>
<summary><strong>Contents</strong></summary>

- [Quick start](#quick-start)
- [What it can manage](#what-it-can-manage)
- [How a bootstrap runs](#how-a-bootstrap-runs)
- [Installation and prerequisites](#installation-and-prerequisites)
- [Manifest and command examples](#manifest-and-command-examples)
- [Safety model](#safety-model)
- [Verification](#verification)
- [Release policy](#release-policy)
- [Repository map](#repository-map)
- [License](#license)

</details>

---

## Quick start

1. Install a reviewed, immutable release tag in the project you want to configure:

   ```bash
   pi install -l git:github.com/egdev6/github-repository-bootstrap@v1.0.0
   ```

2. In Pi, ask for the repository outcome—not a blind mutation. For example:

   ```text
   Bootstrap GitHub governance for this repository. Start with read-only discovery;
   I need bug and feature labels, issue forms, and a pull-request template.
   ```

3. Review the generated manifest and JSON plan. Authorize only the exact plan you intend to apply.

Use a version tag rather than a moving branch reference for future installs. GitHub Releases—not npm—are this package's distribution channel; `package.json` is intentionally `private` to prevent npm publication.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## What it can manage

| Area | Behavior |
| --- | --- |
| **Labels** | Creates missing labels. Existing labels change only when the manifest marks them `managed: true`. |
| **Milestones** | Creates missing milestones and updates existing ones only when explicitly managed. |
| **Repository files** | Copies named, repository-relative source files to repository-relative destinations using `ensure` or `replace`. |
| **Issue and PR templates** | Installs only the fixed `bug_report`, `feature_request`, and pull-request template set. Legacy `templates` configuration can coexist with generic files. |
| **Projects v2** | Optionally creates or links a project, creates configured fields and BOARD/TABLE views, and preserves existing views and matching fields. |
| **Planning evidence** | Returns one JSON report containing validation, discovery, plan, completed, skipped, and failure evidence. |

The manifest is intentionally modular: omit a resource family to leave it out of the bootstrap.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## How a bootstrap runs

| Step | What happens | Your decision |
| --- | --- | --- |
| **1. Discover** | Pi inspects the local repository binding and the relevant GitHub state. | Confirm only facts that cannot be safely inferred. |
| **2. Define** | The skill produces a manifest that is validated against the [configuration schema][schema]. | Choose the governance resources and which existing ones are managed. |
| **3. Plan** | The executor validates access, scopes, and target identity, then prints the exact create, update, skip, or unsupported actions. | Read the JSON report; a plan is not permission to mutate. |
| **4. Authorize** | The plan produces an `authorization.value` bound to its canonical inputs. | Approve the exact value only if the plan is correct. |
| **5. Apply and verify** | The executor revalidates the plan binding, applies allowed actions, and reports completed, skipped, and failed work. | Review the final report and any failures. |

A changed manifest, target, discovered state, or managed-file hash produces a different authorization value. Re-plan instead of reusing an old one.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Installation and prerequisites

### Install from a release tag

```bash
pi install -l git:github.com/egdev6/github-repository-bootstrap@v1.0.0
```

Before installing, review the release source and the [skill instructions][skill]. The package is a Pi package: `package.json` exposes the skill through `pi.skills`.

### What the executor checks

| Requirement | Why it is required |
| --- | --- |
| Pi with this package installed | Loads the guided intake and bootstrap skill. |
| A writable local Git working tree | The executor validates the local target before planning or applying. |
| An `origin` remote matching the configured `owner/repository` | Prevents applying a reviewed manifest to a different repository. |
| GitHub CLI (`gh`) with authenticated, configured scopes | Used to discover GitHub state and apply GitHub resource changes. |

| Safe local file writes | Managed file and template writes use Linux descriptor traversal on Linux. macOS and Windows enforce path confinement, symlink rejection, atomic replacement, and permission preservation. Full race immunity against parent swaps requires Linux descriptor support. |

Projects v2 discovery, GraphQL, and mutations run only when the manifest includes `project`. Its required scopes are also manifest-driven.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Manifest and command examples

The [example manifest][example-config] is a small, valid starting point. It demonstrates two explicitly managed labels and the fixed template module:

```json
{
  "account": "acme-org",
  "repository": "acme-org/widgets",
  "requiredScopes": ["repo"],
  "labels": {
    "kind:bug": {
      "color": "D73A4A",
      "description": "Defect report",
      "managed": true
    },
    "kind:feature": {
      "color": "1D76DB",
      "description": "Feature request",
      "managed": true
    }
  },
  "templates": {
    "issueForms": ["bug_report", "feature_request"],
    "issueFormLabels": {
      "bug_report": ["kind:bug"],
      "feature_request": ["kind:feature"]
    },
    "pullRequest": true,
    "mode": "ensure"
  }
}
```

Replace the example account, repository, and governance choices with facts for the target. The schema requires only `account` and `repository`; optional modules remain disabled when omitted.

### Plan first

From the target repository, after saving a reviewed manifest as `governance.json`, run the executor from Pi's project-local Git package directory:

```bash
BOOTSTRAP=".pi/git/github.com/egdev6/github-repository-bootstrap/skills/github-repository-bootstrap/scripts/bootstrap.mjs"
node "$BOOTSTRAP" --config governance.json --mode plan
```

Read the JSON report. It includes `authorization.value`; do not fabricate or reuse that value.

### Apply the reviewed plan

```bash
BOOTSTRAP=".pi/git/github.com/egdev6/github-repository-bootstrap/skills/github-repository-bootstrap/scripts/bootstrap.mjs"
node "$BOOTSTRAP" --config governance.json --mode apply --authorize '<authorization.value>'
```

The apply command accepts only the exact authorization value emitted by the corresponding plan. A nonzero exit leaves failure evidence in the JSON report; it never represents a partial operation as success.

### Configure generic repository files

Use the top-level `files` map for governed files that already exist inside the target repository. Both the source and destination must be repository-relative paths without traversal.

```json
{
  "files": {
    ".github/CODEOWNERS": {
      "source": "governance/CODEOWNERS",
      "mode": "ensure"
    }
  }
}
```

- `ensure` creates a missing destination and preserves an existing one.
- `replace` creates a missing destination or updates it when its bytes differ from the source.

For the complete contract, see the [configuration schema][schema], [adaptive intake guide][intake], and [skill instructions][skill].

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Safety model

| Guardrail | What it prevents |
| --- | --- |
| **Discovery before mutation** | Existing GitHub resources are inspected before each managed-resource change. |
| **Explicit management** | Existing labels and milestones remain unchanged unless `managed: true`; `ensure` preserves existing files and templates. |
| **Target binding** | The local Git root and `origin` must match the configured repository. |
| **Path confinement** | Generic file sources and destinations reject absolute paths, traversal, symbolic links, unsafe parents, and non-regular files. |
| **Plan-bound authorization** | `apply` requires the SHA-256-derived value from the exact reviewed plan and rechecks it before changing anything. |
| **No deletion path** | The executor creates, selectively updates, skips, or reports failures; it does not delete configured resources. |
| **Fail-closed project handling** | Conflicting project fields require manual reconciliation. Unavailable Projects v2 view capability is reported as unsupported without emulation. |

> **Do not treat discovery as authorization.** A plan tells you what would happen. Only the explicit `apply` invocation with its matching authorization value can make changes.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Verification

Run the focused local test suite:

```bash
npm test
```

The suite exercises configuration validation, plan generation, authorization binding, repository-origin checks, safe managed-file and template writes, and Projects v2 planning behavior. GitHub Actions runs the same command for pull requests to `main` and pushes to `main` using Node.js 20.

For a real bootstrap, verification is the final JSON report: inspect `completed`, `skipped`, `failures`, and `success`. A failure is evidence to investigate—not authorization for additional changes.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Release policy

GitHub Actions runs `npm test` for pull requests to `main` and pushes to `main`. After a successful push, the workflow derives `v<package.json version>`. It creates an annotated tag at the pushed commit only when the tag is missing, then independently creates a generated-notes GitHub Release only when the release is missing.

Existing tags and releases are left unchanged. GitHub Releases are the only release artifact produced by this repository; npm publication is out of scope.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Repository map

```text
.github/workflows/release.yml                         CI and release automation
skills/github-repository-bootstrap/
├── SKILL.md                                          Guided workflow and command contract
├── assets/config.schema.json                         Manifest validation contract
├── assets/example.config.json                        Minimal example manifest
├── assets/templates/                                 Fixed issue and pull-request templates
├── references/intake.md                              Fact-based governance intake
├── scripts/bootstrap.mjs                             Plan/apply entry point
├── scripts/lib.mjs                                   Validation, planning, and safety helpers
└── tests/lib.test.mjs                                Focused Node.js test suite
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## License

Distributed under the [MIT License][license].

[skill]: skills/github-repository-bootstrap/SKILL.md
[schema]: skills/github-repository-bootstrap/assets/config.schema.json
[example-config]: skills/github-repository-bootstrap/assets/example.config.json
[intake]: skills/github-repository-bootstrap/references/intake.md
[license]: LICENSE
