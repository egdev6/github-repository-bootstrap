// Deterministic fixed-template descriptors and rendering.
//
// Extracts the selected fixed-template assets and the single `__LABELS__`
// replacement the native installer already performs. Descriptors preserve the
// original installer order and reuse the shared fixed-template path assembly.
import path from "node:path";
import { fixedTemplatePaths } from "./fixed-template-paths.mjs";

export function fixedTemplateDescriptors(templates) {
  const forms = templates.issueForms.map((name) => ({
    source: `${name}.yml`,
    labelKey: name,
  }));
  const sources = [{ source: "config.yml", labelKey: null }, ...forms];
  if (templates.pullRequest)
    sources.push({ source: "pull_request_template.md", labelKey: null });
  const targets = fixedTemplatePaths(
    forms.map(({ source }) => path.posix.join(".github/ISSUE_TEMPLATE", source)),
    templates.pullRequest,
  );
  return sources.map((source, index) => ({ ...source, target: targets[index] }));
}

export function renderFixedTemplate(source, labelKey, labelValues) {
  return labelKey
    ? source.replace("__LABELS__", JSON.stringify(labelValues[labelKey] ?? []))
    : source;
}
