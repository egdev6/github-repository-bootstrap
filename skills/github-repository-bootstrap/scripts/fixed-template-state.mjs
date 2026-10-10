// Capture bytes for the native fixed-template authorization boundary.
// Called only after native configuration validation; no general asset discovery.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJson, templateDestination } from "./lib.mjs";
import { fixedTemplateDescriptors, renderFixedTemplate } from "./fixed-template-renderer.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function captureFixedTemplates(templates, repoDir, assets) {
  return fixedTemplateDescriptors(templates).map((descriptor) => {
    const source = path.join(assets, descriptor.source);
    if (!fs.lstatSync(source).isFile())
      throw new Error("Template source is not a regular file: " + descriptor.source);
    const raw = fs.readFileSync(source);
    const content = renderFixedTemplate(
      raw.toString("utf8"), descriptor.labelKey, templates.issueFormLabels,
    );
    const destination = templateDestination(repoDir, descriptor.target);
    if (destination.exists && !fs.lstatSync(destination.target).isFile())
      throw new Error("Template destination is not a regular file: " + descriptor.target);
    return {
      ...descriptor,
      sourceHash: hash(raw),
      renderedHash: hash(Buffer.from(content, "utf8")),
      destinationHash: destination.exists ? hash(fs.readFileSync(destination.target)) : null,
      content,
    };
  });
}

export function fixedTemplateState(records) {
  return records.map(({ content, ...metadata }) => metadata);
}

export function verifyFixedTemplates(templates, repoDir, assets, expected) {
  const records = captureFixedTemplates(templates, repoDir, assets);
  if (canonicalJson(fixedTemplateState(records)) !== canonicalJson(expected))
    throw new Error("Fixed template source or destination changed after authorization");
  return records;
}
