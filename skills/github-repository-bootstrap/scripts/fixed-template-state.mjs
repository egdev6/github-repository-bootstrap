// Capture bytes for the native fixed-template authorization boundary.
// Called only after native configuration validation; no general asset discovery.
import { fixedTemplateDescriptors, renderFixedTemplate } from "./fixed-template-renderer.mjs";
import { captureTemplateDescriptors, templateState, verifyTemplateRecords } from "./template-state.mjs";

export function captureFixedTemplates(templates, repoDir, assets) {
  return captureTemplateDescriptors(
    fixedTemplateDescriptors(templates), repoDir, assets,
    (raw, descriptor) => renderFixedTemplate(
      raw, descriptor.labelKey, templates.issueFormLabels,
    ),
  );
}

export function fixedTemplateState(records) {
  return templateState(records);
}

export function verifyFixedTemplates(templates, repoDir, assets, expected) {
  const records = captureFixedTemplates(templates, repoDir, assets);
  return verifyTemplateRecords(
    records, expected,
    "Fixed template source or destination changed after authorization",
  );
}
