# Default Code Safety

Local preparation against published `ca148cdda2d2cc31334a453811c9d06187bc80d7`.
Commits and a single pull request are now authorized for `github.com/egdev6/github-repository-bootstrap` using the current GitHub CLI session. Merge, release, protections and installation remain unauthorized.

## Specs

- S1: "merged. Me interesa que este workflow lo añadas por dfecto a github-repository bootstrap"
- S2: "Sí, preparar integración aislada" — preserve the original dirty source and installed package.
- S3: "Semgrep + zizmor; política adicional opcional" — default scanner scope is JS/TS and workflows; objective repository checks require an explicit reviewed policy, never Quorb's image exceptions.
- S4: "Reutilizar la baseline inmutable actual" — control repository `egdev6/quorb`, full reviewed commit `176ae636fdd80ce60d6fffec188ce558c5f6692b`; target repositories remain dynamic inert inputs.
- S5: "Sí, unidades locales revisables" — prepare distinct reviewable units without commits or publication.
- S6: Preserve existing bootstrap guarantees: exact hash authorization, ensure preserves existing destinations, source/render/destination drift fails closed; omitted legacy modules remain inactive. New intake/example manifests explicitly select Code safety by default and allow opt-out.

## Tasks

- T0 | S2,S5 | fixture isolation prerequisite | route: writer + verifier | commit: 93b692c3407e911aa2c142148d4a5349eb6de118 | status: verified locally
- T1 | S3-S5 | packaged workflow and pure renderer with focused tests | route: writer + verifier | commit: 9912e00c466681e490032abea381064345db8e5e | status: verified locally with pristine bytes; 423-line exception approved
- T2a | S2-S6 | explicit optional module, validation/planning/collisions | route: writer + verifier | commit: 6b6ecaada006535f049e7e4ea46eacd2d068ed74 | status: verified locally
- T2b | S2-S6 | discovery and hash-bound installation | route: writer + verifier | commit: 68959d8efe1ee48a611720b9cab702c771f2310c | status: verified locally after separate isolation correction; 501-line exception approved
- T3 | S1,S3,S6 | new-manifest default, opt-out, docs and integration regression | route: inline + verifier | commit: authorized; pending record | status: verified locally; not published or installed

## Log

- L1: "merged. Me interesa que este workflow lo añadas por dfecto a github-repository bootstrap"
- L2: User approved isolated local preparation, then GitHub reads and isolated clone; original source and installed package remain untouched.
- L3: User selected "Semgrep + zizmor; política adicional opcional", "Reutilizar la baseline inmutable actual", "Sí, unidades locales revisables".
- L4: Published base differs from both dirty local source and installed package. Clone branch `ci/default-code-safety` pins published main `ca148cdda2d2cc31334a453811c9d06187bc80d7`.
- L5: Baseline test run exited 1: 207/244 passed, 37 fixture failures caused by ambient `/tmp/package.json` type module. No ambient file deleted. Fixture-local CommonJS pin and self-contained regression gave 246/246 passing; independent verifier subsequently confirmed 246/246 passing, Windows bridge unchanged and fixture cleanup correct. RED observed by writer; not independently repeated.
- L6: T1, T2a and T2b writers have disjoint enforced edit surfaces. Each local unit is capped at 400 authored diff lines; no source commit or delivery authorized.
- L7: T2a and T2b stopped without edits because dependencies were not yet present. Parent owns sequencing; no schema guessed and no human decision required for this internal dependency.
- L8: T1 returned 13 renderer tests and 13 inventory tests passing, but 423 authored lines exceeded its 400-line budget. User explicitly selected "Aceptar esta unidad local de 423 líneas"; tests were not compressed or removed. This exception grants no delivery authority and applies only to T1.
- L9: T1 independent verification confirmed 13 renderer and 13 inventory tests passing, validator alignment and trust separation. Disclosures: fixed push branch `main`, policy temporary file lasts until hosted-runner teardown, actual GHA/actionlint not run; writer RED was module-absence rather than functional-rule RED.
- L10: T2a delivered 377 lines and 8 model/67 focused tests passing. Independent verification found absent/malformed workflow observation was incorrectly treated as missing or matching, plus a schema/runtime mismatch for `b..png`. Parent routed a separate bounded correction unit; T2a remains NOTPASS until these are fixed and checked.
- L11: T3 example now explicitly selects scanner-only Code safety. Default regression RED showed missing example/safety docs; GREEN 3 tests after updates. Initial skill/advisor token-budget and wording regressions were corrected, with 23 default/intake/advisor tests passing. These structural tests do not prove actual LLM behavior or live CI. No installed default changed.
- L12: T2a correction observed RED 8/10 passing, then GREEN 10/10 plus 69 focused tests. Unknown observations now throw before planning; source/render hashes are bound and tested. Original model unit was 377 authored lines; separate correction delta 149 (cumulative 526), not a claim that the combined unit fits 400.
- L13: T2b delivered 9 CLI tests GREEN after RED 2/9 passing, plus 104 affected tests. Unit budget 501 exceeded 400; user explicitly selected "Aceptar esta unidad local de 501 líneas". No tests were compressed or omitted; no delivery authorized.
- L14: Integrated `npm test` and `git diff --check` exited 0: 281 tests passed, zero failures or omissions. Active script diagnostics report no errors/warnings, five non-blocking style hints. That run's integrity claim is withdrawn by L15; actual new-workflow GHA, Windows and actionlint remain unrun.
- L15: Independent integrated verification found the late-drift CLI test omitted `copySkill: true`, so fake gh wrote seven `late drift` suffixes into the real packaged asset. Focused tests passing did not prove integrity; the previous integrated GREEN is not delivery evidence for that altered asset. No original project source or installed cache was changed.
- L16: Parent removed only those exact suffixes. Restored clean asset SHA256: `64ec81f4d3057ee024f63bfacb408d422478edb4608e1a2ae90c0ab3e1771826`. Added per-test byte-integrity assertion and a pre-write isolated-context assertion; safe RED exited 1 with 8/9 passing, without mutating the clean asset. Then enabled `copySkill: true` for late drift. Fresh GREEN/full suite with before/after byte comparison exited 0 (9 CLI, 281 full tests, zero omissions); independent follow-up separately ran 9 CLI and 13 renderer tests, all passing, with exactly the same clean SHA before/mid/after. Blocker closed; previous integrity claims remain withdrawn.
- L17: Local preparation is verified only. Actual portable-workflow GHA, actionlint and Windows native execution remain unrun; the project-enabled discovery branch lacks a dedicated test. Fixed push branch `main` and public control dependency remain disclosed. No unit commits, native unit-review closure, remote changes or installed package update are claimed. Installation requires new explicit authorization.

- L18: User authorized commits and PR delivery, then selected `delivery_strategy=single-pr`, overriding the pending chain. No tracker, child PRs or chain strategy remain applicable. Cohesive oversized units and tests are retained without compression; no `size:exception` label or policy waiver is inferred.
- L19: Issue #57 was created and read back with exact approved body and labels `status:approved` and `type:chore`, explicitly authorized using current target-bound gh session (ADMIN). Duplicate searches for Code safety and Semgrep found no matches. PR reference is nonclosing `Refs #57`; issues #28–#30 cover a different scanner and remain unchanged.
- L20: Default branch verified as `main` at `ca148cdda2d2cc31334a453811c9d06187bc80d7`. PR-to-main CI is automatic. User also authorized optional workflow_dispatch on delivery branches; release job remains push-only. Do not duplicate runs unnecessarily or change CI to obtain coverage.

- L21: Four work-unit commits are recorded above. The final delivery uses the corrected pristine asset and isolated tests only; no corrupted intermediate asset was committed. This task document and new-manifest defaults are included with the final documentation unit. Native review and remote CI for the committed candidate remain pending at this checkpoint; installation is still unchanged.
