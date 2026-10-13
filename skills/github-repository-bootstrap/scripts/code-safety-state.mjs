// Capture bytes for the optional native Code safety workflow authorization
// boundary. Called only after native configuration validation and only for an
// explicitly active module; it performs no general asset discovery.
import { CODE_SAFETY_DESTINATION } from "./lib.mjs";
import { renderCodeSafetyWorkflow } from "./code-safety-renderer.mjs";
import {
  captureTemplateDescriptors,
  templateState,
  verifyTemplateRecords,
} from "./template-state.mjs";

function codeSafetyDescriptors() {
  return [{ source: "code-safety.yml", target: CODE_SAFETY_DESTINATION }];
}

export function captureCodeSafety(config, repoDir, assets) {
  return captureTemplateDescriptors(
    codeSafetyDescriptors(),
    repoDir,
    assets,
    (raw) => renderCodeSafetyWorkflow(raw, config.codeSafety?.policy),
  );
}

export function codeSafetyState(records) {
  return templateState(records);
}

export function verifyCodeSafety(config, repoDir, assets, expected) {
  const records = captureCodeSafety(config, repoDir, assets);
  return verifyTemplateRecords(
    records,
    expected,
    "Code safety workflow source or destination changed after authorization",
  );
}
