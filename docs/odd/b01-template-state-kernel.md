# Shared native template byte capture
## Scope
Extract the existing capture and metadata kernel into an internal module.
The fixed-template adapter consumes it immediately; CLI signatures stay unchanged.
No lifecycle workflow, schema field, default, flag or manifest kind is activated.
This is preparation for #15, not completion of lifecycle or package acceptance.
## Retained contract
Capture descriptors in their existing caller-defined order.
Hash raw source bytes before UTF-8 decoding.
Render using the trusted internal caller, then hash rendered UTF-8 bytes.
Hash raw destination bytes; use null when the destination does not exist.
Keep descriptor metadata, with content present only in capture records.
Reject non-regular sources and destinations using the existing checks.
Keep the existing destination ancestor/symlink preflight from templateDestination.
Capture and metadata collection do not write managed files.
The existing fixed-template verifier retains its comparison and error text.
Native early and late checks continue through that verifier.
Ensure still skips existing fixed templates; replace still always writes.
No new global rollback, race, alias or sandbox guarantee is introduced.
## Ownership and limits
Descriptors and renderer are trusted product code after configuration validation.
This helper does not discover arbitrary assets or expose a public planning API.
It does not validate future workflow activation, canonical labels or module decisions.
Lifecycle needs its own complete activation/opt-out, collision and file-mode contract.
Future workflow replace-diff/equal-skip must not alter legacy fixed-template behavior.
Project sync, offline protection, migration acceptance and live #17 remain separate.
No version, release, numeric SemVer choice or automatic legacy migration is included.
## Verification plan
New direct tests cover raw/rendered/destination binding, drift, order and metadata.
Cover empty input, missing/non-regular sources/destinations and renderer failures.
Retain all fifteen native fixed-template tests and their independent legacy oracle.
Run focused/native/full checks in LF and CRLF, security and exact package checks.
Use an ordinary refactor baseline and structural/functional checks; no invented RED.
Independent verification and candidate-specific native/LSP dispositions follow later.
This preparatory unit does not complete #15 or authorize delivery.
