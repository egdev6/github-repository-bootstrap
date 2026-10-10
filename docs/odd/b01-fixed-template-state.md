# B01: fixed-template byte authorization

This unit binds selected config, issue-form and PR-template bytes in the native
CLI, using the delivered descriptors and first-marker renderer.

## Contract
- Observations include ordered source/target/label keys and SHA-256 of raw
  source bytes, rendered UTF-8 bytes and raw destination bytes (null if missing).
- Content stays private to the capture, not in authorization observations.
- Template-absent configuration adds no observation field or empty array.
- Changed source or destination bytes require a fresh plan and approval,
  including distinct invalid UTF-8 inputs that render identically.
- An early comparison precedes managed-file and label mutations; a late
  comparison precedes the template batch and returns the exact write payload.
- Ensure keeps existing bytes and its old skip reason. Replace still writes
  and reports updates even for equal bytes. Selection and report order remain.
- Source/destination non-regular files and destination symlinks fail closed.
  Metadata capture reads assets even in ensure mode; this is not a neutral refactor.

## Limits and verification
Late rejection preserves earlier completed work; there is no global rollback.
Batch capture does not eliminate concurrent changes after capture, aliases,
source-read races or inherited platform descriptor limitations.
The shared offline gh fixture supports a trusted object reply that changes only
an owned copied asset during a mocked label creation; it is not a sandbox.
Tests retain all delivered renderer assertions and cover byte identities,
early rejection, late partial reports, fresh approval and unchanged modes.
Run meaningful native CLI RED with the installer/discovery unwired, then GREEN
after wiring, full LF/CRLF suites, scanners, pack equivalence and independent
verification before delivery. No tests or successful type checking are implied
by this RAM proposal.
Lifecycle/sync/protection activation, API #49, migration and full #15 acceptance
are separate; no flag, version, release or live Project proof is added.

The source-file symlink case is explicitly skipped on Windows; destination
junction checks still run there. Existing descriptor/procfs skips remain separate.
