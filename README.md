<h1 align="center">GitHub Repository Bootstrap</h1>

<p align="center">A small Pi skill for planning and applying repeatable GitHub repository setup without bypassing repository governance.</p>

<p align="center">
  <a href="https://github.com/egdev6/github-repository-bootstrap/releases"><img src="https://img.shields.io/github/v/release/egdev6/github-repository-bootstrap?display_name=tag" alt="Release"></a>
  <a href="https://github.com/egdev6/github-repository-bootstrap/actions/workflows/release.yml?query=branch%3Amain"><img src="https://github.com/egdev6/github-repository-bootstrap/actions/workflows/release.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://github.com/egdev6/github-repository-bootstrap/issues"><img src="https://img.shields.io/github/issues/egdev6/github-repository-bootstrap" alt="Issues"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/egdev6/github-repository-bootstrap" alt="License"></a>
</p>

## Status

This public repository is distributed directly as a Pi package. `package.json` remains `private: true` only to prevent npm publication; install the skill from a reviewed release tag.

## Quick path

1. Install the existing immutable release tag in the target project:

   ```bash
   pi install -l git:github.com/egdev6/github-repository-bootstrap@v1.0.0
   ```

2. Ask Pi to bootstrap repository governance, such as labels, milestones, issue templates, or a Projects v2 board.
3. Review the generated manifest and plan, then explicitly authorize the exact plan before any mutation.

Use a version tag such as `v1.0.0`, never a moving branch reference, for future installs.

## Capabilities

| Area | What the skill does |
| --- | --- |
| Intake | Infers available repository facts and asks only for unresolved governance choices. |
| Configuration | Validates a reviewed manifest against its configuration schema. |
| Planning | Discovers current state and reports the exact creates, updates, skips, and failures before changes run. |
| Managed resources | Supports labels, milestones, repository files, legacy templates, and optional Projects v2 configuration. |
| Application | Applies only the reviewed plan after explicit authorization tied to its SHA-256 value. |

## Safety model

- Discovery happens before every managed-resource change; configured resources are preserved unless they are explicitly managed.
- The workflow never deletes resources. Repository-file sources and destinations are constrained to safe paths under the target repository.
- `plan` is required before `apply`; authorization is bound to the exact reviewed plan and cannot be reused after relevant state changes.
- Failed operations remain visible in the JSON report instead of being represented as success.

## Release policy

The GitHub Actions workflow runs `npm test` for pull requests to `main` and pushes to `main`. After successful `main` checks, it derives `v<package.json version>`. When that version has no tag yet—normally after a package version change—it creates an annotated tag at the pushed commit and a GitHub Release with generated notes. Existing tags and releases are reported and left unchanged.

GitHub Releases are the only release artifact produced here. npm publication is out of scope, and this package stays private.

## Verification

Run the focused test suite locally:

```bash
npm test
```

The same command is the required `test` job in GitHub Actions.

## License

[MIT](LICENSE)
