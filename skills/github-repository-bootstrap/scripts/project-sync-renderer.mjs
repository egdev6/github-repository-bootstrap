import { Buffer } from "node:buffer";

// Pure project-sync template renderer (U4b).
//
// Takes an unparsed template string plus explicit `{ owner, title, secretName }`
// strings and returns the materialized string. It reads no file, environment,
// credential, or API, holds no defaults (no implicit `GH_PROJECT_TOKEN`), does
// not parse YAML, execute Actions, or sandbox the caller, and materializes only
// the three known slots in a single pass over the ORIGINAL text — so inserted
// values are never rescanned and adjacent known markers are each replaced once.

const SLOT_SECRET = "__SECRET_NAME__";
const SLOT_OWNER = "__PROJECT_OWNER__";
const SLOT_TITLE = "__PROJECT_TITLE_BASE64__";
const SLOTS = [SLOT_SECRET, SLOT_OWNER, SLOT_TITLE];
// Slot names hold no regex metacharacters, so this alternation is literal.
const SLOT_PATTERN = new RegExp(SLOTS.join("|"), "g");
// Any other marker in the original (known slots removed) is an unknown contract.
const UNKNOWN_SLOT_PATTERN = /__[A-Z0-9_]+__/;

// Canonical GitHub login bound and canonical project-title bound.
const OWNER_LENGTH = 39;
const TITLE_LENGTH = 255;
const OWNER_PATTERN = /^[A-Za-z0-9-]+$/;
const SECRET_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_SECRET_PREFIX = /^GITHUB_/i;
// Rejected anywhere as explicit control and line-terminator validation.
const SECRET_FORBIDDEN = /[\u0000-\u001f\u007f\u2028\u2029]/;

// Errors name the invalid field but never echo the raw caller value.
function assertTemplateText(templateText) {
  if (typeof templateText !== "string") {
    throw new TypeError("project sync template must be a string");
  }
}

function assertParameters(parameters) {
  if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) {
    throw new TypeError("project sync parameters must be a non-null plain object");
  }
  const prototype = Object.getPrototypeOf(parameters);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("project sync parameters must be a non-null plain object");
  }
  const keys = Reflect.ownKeys(parameters);
  if (keys.length !== 3 || keys.some((key) => !["owner", "title", "secretName"].includes(key))) {
    throw new Error("project sync parameters must contain own keys owner, title, and secretName (missing or unsupported own keys)");
  }
}

function assertOwner(owner) {
  if (typeof owner !== "string") {
    throw new TypeError("project sync owner must be a string");
  }
  if (!owner || owner.length > OWNER_LENGTH || !OWNER_PATTERN.test(owner)) {
    throw new Error(`project sync owner must be a GitHub login of at most ${OWNER_LENGTH} characters`);
  }
}

function assertTitle(title) {
  if (typeof title !== "string") {
    throw new TypeError("project sync title must be a string");
  }
  if (!title || title.length > TITLE_LENGTH) {
    throw new Error(`project sync title must be a non-empty string of at most ${TITLE_LENGTH} characters`);
  }
  // A UTF-8 round-trip rejects lone UTF-16 surrogates instead of replacing them
  // with U+FFFD; valid composed/decomposed text is kept without normalization.
  if (Buffer.from(title, "utf8").toString("utf8") !== title) {
    throw new Error("project sync title must be well-formed UTF-8 text");
  }
}

function assertSecretName(secretName) {
  if (typeof secretName !== "string") {
    throw new TypeError("project sync secret name must be a string");
  }
  if (
    !secretName ||
    RESERVED_SECRET_PREFIX.test(secretName) ||
    !SECRET_PATTERN.test(secretName) ||
    SECRET_FORBIDDEN.test(secretName)
  ) {
    throw new Error("project sync secret name must be a valid Actions secret identifier");
  }
}

function assertSlots(templateText) {
  for (const slot of SLOTS) {
    if (templateText.split(slot).length - 1 !== 1) {
      throw new Error("project sync template must contain each required slot exactly once");
    }
  }
  if (UNKNOWN_SLOT_PATTERN.test(templateText.replace(SLOT_PATTERN, ""))) {
    throw new Error("project sync template contains an unknown slot marker");
  }
}

export function renderProjectIssueSyncWorkflow(templateText, parameters) {
  assertTemplateText(templateText);
  assertParameters(parameters);
  // All three required own keys are guaranteed present, so direct reads cannot fall back to a polluted Object.prototype.
  const { owner, title, secretName } = parameters;
  assertOwner(owner);
  assertTitle(title);
  assertSecretName(secretName);
  assertSlots(templateText);

  const replacements = new Map([
    // Secret NAME (never a value) goes raw inside the existing `secrets.*` expression.
    [SLOT_SECRET, secretName],
    // Owner and title are JSON.stringify-quoted YAML scalars; the title is UTF-8
    // base64 so it can never become a raw scalar, shell fragment, or expression.
    [SLOT_OWNER, JSON.stringify(owner)],
    [SLOT_TITLE, JSON.stringify(Buffer.from(title, "utf8").toString("base64"))],
  ]);

  return templateText.replace(SLOT_PATTERN, (slot) => replacements.get(slot));
}
