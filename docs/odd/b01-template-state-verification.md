# Shared template metadata verification
## Review scope
Extract the existing fixed-template metadata comparison into the capture kernel.
The fixed-template verifier consumes the helper immediately in the native CLI.
This is an internal refactor, not lifecycle or Project Sync activation.
No configuration field, default, manifest kind, permission or release changes.
## Retained behavior
Capture remains caller-owned and hashes raw source, rendered and destination bytes.
Verification strips content using the existing templateState representation.
Canonical comparison retains descriptor fields, byte hashes, order and selection size.
Equal metadata returns the original records without mutating either input.
Different metadata throws the trusted caller's exact error message.
Absent legacy expected state retains the native fixed-template error.
No accepted flag or unused workflow factory is introduced.
Existing early and late native checks still call verifyFixedTemplates.
Ensure still skips existing fixed templates; replace still always writes.
No write, new discovery, race, alias or global rollback guarantee is added.
## Verification to execute only after Source authorization
New direct cases cover equality, field drift, null destinations, selection and ordering.
Cover content exclusion, added metadata, empty/absent state and exact caller errors.
Retain all nine capture tests and fifteen native fixed-template tests unchanged.
Run direct, focused and complete suites, LF/CRLF, scanners and exact package checks.
Native review, independent verification and LSP disposition remain candidate-specific.
## Boundary with remaining #15 work
Lifecycle and sync still require complete owned validation, discovery and installation.
Keep default coupling, opt-out, canonical labels, capability/deferred and preservation.
Do not infer activation or a final <=400-line runtime cut from this refactor.
