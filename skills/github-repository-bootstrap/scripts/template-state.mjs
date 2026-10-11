// Internal byte capture for already validated native template descriptors.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJson, templateDestination } from "./lib.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function captureTemplateDescriptors(descriptors, repoDir, assets, render) {
  return descriptors.map((descriptor) => {
    const source = path.join(assets, descriptor.source);
    if (!fs.lstatSync(source).isFile())
      throw new Error("Template source is not a regular file: " + descriptor.source);
    const raw = fs.readFileSync(source);
    const content = render(raw.toString("utf8"), descriptor);
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

export function templateState(records) {
  return records.map(({ content, ...metadata }) => metadata);
}

export function verifyTemplateRecords(records, expected, message) {
  if (canonicalJson(templateState(records)) !== canonicalJson(expected))
    throw new Error(message);
  return records;
}
