import { Buffer } from "node:buffer";
import { extname } from "node:path";

// Pure code-safety template renderer and policy model (T1/T2a).
//
// The renderer materializes the single `__REPOSITORY_POLICY_BASE64__` slot of a
// code-safety workflow template. It reads no file, environment, credential,
// network, or target policy, imports no donor module, holds no defaults, mutates
// neither argument, and performs no source write. It does not parse YAML,
// execute a workflow, or promise a sandbox. `undefined` policy renders the
// scanner-only default with an empty, inert slot; any other value must pass the
// strict policy model below before it is base64-encoded into the slot.
//
// The policy model mirrors the reviewed control validator shape: a plain JSON
// object with schemaVersion 1, a non-negative integer maxTextBytes, three
// string-array allowlists (bidiExceptions must stay empty), and an optional
// approvedBinaryImages list of exact `{ path, sha256 }` records. Accessors,
// hidden/symbol/extraneous keys, foreign prototypes, and unsafe image paths are
// rejected so only inert parsed data ever reaches JSON.stringify.

const SLOT = "__REPOSITORY_POLICY_BASE64__";
const SLOT_PATTERN = new RegExp(SLOT, "g");
const UNKNOWN_SLOT_PATTERN = /__[A-Z0-9_]+__/;
const REQUIRED_KEYS = ["allowedRootLifecycleHooks", "allowedSymlinks", "bidiExceptions", "maxTextBytes", "schemaVersion"];
const ALLOWED_KEYS = new Set([...REQUIRED_KEYS, "approvedBinaryImages"]);
const STRING_ARRAYS = ["allowedSymlinks", "allowedRootLifecycleHooks", "bidiExceptions"];
const IMAGE_EXTENSIONS = new Set([".png", ".ico", ".jpg", ".jpeg", ".gif", ".webp"]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const isPlainObject = (value) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

// Reject accessors, symbol keys, and exotic objects: a getter would run during
// validation or JSON.stringify, so only own data properties are ever accepted.
function assertDataObject(value) {
  if (!isPlainObject(value)) throw new TypeError("code safety policy must be a plain data object");
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new TypeError("code safety policy must not contain symbol keys");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError("code safety policy must contain data properties, not accessors");
    }
  }
}

function assertImagePath(path) {
  if (
    typeof path !== "string" ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes(":") ||
    path.split("/").some((segment) => !segment || segment === "." || segment === "..") ||
    !IMAGE_EXTENSIONS.has(extname(path).toLowerCase())
  ) {
    throw new TypeError("code safety policy approvedBinaryImages has an unsafe image path");
  }
}

export function validateCodeSafetyPolicy(policy) {
  assertDataObject(policy);
  const keys = Reflect.ownKeys(policy);
  if (keys.some((key) => !ALLOWED_KEYS.has(key)) || REQUIRED_KEYS.some((key) => !keys.includes(key))) {
    throw new TypeError("code safety policy has unexpected or missing keys");
  }
  if (policy.schemaVersion !== 1 || !Number.isInteger(policy.maxTextBytes) || policy.maxTextBytes < 0) {
    throw new TypeError("code safety policy schemaVersion/maxTextBytes is invalid");
  }
  for (const key of STRING_ARRAYS) {
    if (!Array.isArray(policy[key]) || policy[key].some((entry) => typeof entry !== "string")) {
      throw new TypeError(`code safety policy ${key} must be an array of strings`);
    }
  }
  if (policy.bidiExceptions.length > 0) {
    throw new TypeError("code safety policy bidiExceptions must be empty");
  }
  const images = policy.approvedBinaryImages ?? [];
  if (!Array.isArray(images)) throw new TypeError("code safety policy approvedBinaryImages must be an array");
  const seen = new Set();
  for (const image of images) {
    assertDataObject(image);
    const imageKeys = Reflect.ownKeys(image);
    if (imageKeys.length !== 2 || !imageKeys.includes("path") || !imageKeys.includes("sha256")) {
      throw new TypeError("code safety policy approvedBinaryImages entry is invalid");
    }
    assertImagePath(image.path);
    if (!SHA256_PATTERN.test(image.sha256) || seen.has(image.path)) {
      throw new TypeError("code safety policy approvedBinaryImages entry is invalid or duplicated");
    }
    seen.add(image.path);
  }
  return policy;
}

export function renderCodeSafetyWorkflow(raw, policy = undefined) {
  if (typeof raw !== "string") throw new TypeError("code safety template must be a string");
  if (raw.split(SLOT).length - 1 !== 1) {
    throw new Error("code safety template must contain the repository policy slot exactly once");
  }
  if (UNKNOWN_SLOT_PATTERN.test(raw.replace(SLOT_PATTERN, ""))) {
    throw new Error("code safety template contains an unknown slot marker");
  }
  const encoded =
    policy === undefined
      ? ""
      : Buffer.from(JSON.stringify(validateCodeSafetyPolicy(policy)), "utf8").toString("base64");
  // Single pass: base64 has no slot characters, so an inserted value is never
  // rescanned and the surrounding template bytes, including LF/CRLF, are kept.
  return raw.replace(SLOT_PATTERN, () => encoded);
}
