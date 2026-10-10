import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { captureTemplateDescriptors, templateState } from "../scripts/template-state.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const descriptor = {
  source: "workflow.yml", target: ".github/workflows/example.yml", labelKey: "status",
};

function fixture(t, bytes = Buffer.from("name: café\n")) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "template-state-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo");
  const assets = path.join(root, "assets");
  fs.mkdirSync(repo);
  fs.mkdirSync(assets);
  fs.writeFileSync(path.join(assets, descriptor.source), bytes);
  return { repo, assets, source: path.join(assets, descriptor.source),
    destination: path.join(repo, descriptor.target) };
}

const capture = (f, descriptors = [descriptor], render = (raw) => raw) =>
  captureTemplateDescriptors(descriptors, f.repo, f.assets, render);

test("internal capture preserves descriptors and hashes independent raw/rendered bytes", (t) => {
  const bytes = Buffer.from("name: café\r\n");
  const f = fixture(t, bytes);
  const rendered = "name: reviewed ✓\n";
  let calls = 0;
  const records = capture(f, [descriptor], (raw, selected) => {
    calls++;
    assert.equal(raw, bytes.toString("utf8"));
    assert.equal(selected, descriptor);
    return rendered;
  });
  assert.equal(calls, 1);
  assert.deepEqual(records, [{
    ...descriptor, sourceHash: digest(bytes),
    renderedHash: digest(Buffer.from(rendered, "utf8")),
    destinationHash: null, content: rendered,
  }]);
  assert.equal(fs.existsSync(f.destination), false);
  assert.deepEqual(fs.readdirSync(f.repo), []);
  assert.deepEqual(fs.readFileSync(f.source), bytes);
});

test("existing destination hash binds bytes without decoding or writing", (t) => {
  const f = fixture(t);
  const destination = Buffer.from([0x61, 0x80, 0x0d, 0x0a]);
  fs.mkdirSync(path.dirname(f.destination), { recursive: true });
  fs.writeFileSync(f.destination, destination);
  const records = capture(f);
  assert.equal(records[0].destinationHash, digest(destination));
  assert.notEqual(records[0].destinationHash, digest(Buffer.from(destination.toString("utf8"))));
  assert.deepEqual(fs.readFileSync(f.destination), destination);
  assert.equal(records[0].sourceHash, digest(fs.readFileSync(f.source)));
});

test("same decoded rendering does not hide raw source drift", (t) => {
  const f = fixture(t, Buffer.from([0x61, 0x80]));
  const before = capture(f);
  fs.writeFileSync(f.source, Buffer.from([0x61, 0x81]));
  const after = capture(f);
  assert.equal(before[0].content, after[0].content);
  assert.equal(before[0].renderedHash, after[0].renderedHash);
  assert.equal(before[0].sourceHash, digest(Buffer.from([0x61, 0x80])));
  assert.equal(after[0].sourceHash, digest(Buffer.from([0x61, 0x81])));
  assert.notEqual(before[0].sourceHash, after[0].sourceHash);
  assert.notDeepEqual(templateState(before), templateState(after));
});

test("destination drift changes only the destination binding", (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.dirname(f.destination), { recursive: true });
  fs.writeFileSync(f.destination, Buffer.from([0x62, 0x80]));
  const before = capture(f);
  fs.writeFileSync(f.destination, Buffer.from([0x62, 0x81]));
  const after = capture(f);
  assert.equal(before[0].content, after[0].content);
  assert.equal(before[0].sourceHash, after[0].sourceHash);
  assert.equal(before[0].renderedHash, after[0].renderedHash);
  assert.equal(before[0].destinationHash, digest(Buffer.from([0x62, 0x80])));
  assert.equal(after[0].destinationHash, digest(Buffer.from([0x62, 0x81])));
  assert.notEqual(before[0].destinationHash, after[0].destinationHash);
});

test("empty selection neither reads assets nor invokes the renderer", () => {
  assert.deepEqual(captureTemplateDescriptors([], "", "", () => {
    assert.fail("empty selection must not render");
  }), []);
});

test("capture and metadata preserve caller order without mutating inputs", (t) => {
  const f = fixture(t);
  const second = { source: "second.yml", target: ".github/second.yml", kind: "test" };
  fs.writeFileSync(path.join(f.assets, second.source), "second\n");
  const inputs = [second, descriptor];
  const expected = inputs.map((value) => ({ ...value }));
  const calls = [];
  const records = capture(f, inputs, (raw, selected) => {
    calls.push(selected.source);
    return raw;
  });
  assert.deepEqual(calls, ["second.yml", "workflow.yml"]);
  assert.deepEqual(records.map(({ target }) => target), [second.target, descriptor.target]);
  assert.deepEqual(inputs, expected);
  assert.equal(records[0].content, "second\n");
  assert.equal(records[1].content, "name: café\n");
  const metadata = templateState(records);
  assert.deepEqual(metadata, records.map(({ content, ...rest }) => rest));
  assert.equal(metadata[0].kind, "test");
  assert.equal("content" in metadata[0], false);
  assert.equal("content" in metadata[1], false);
  assert.notEqual(metadata[0], records[0]);
  metadata[0].sourceHash = "changed";
  assert.notEqual(records[0].sourceHash, "changed");
  assert.equal(records[0].content, "second\n");
});

test("missing and non-regular sources fail before rendering or destination work", (t) => {
  const f = fixture(t);
  fs.unlinkSync(f.source);
  let calls = 0;
  const renderer = () => { calls++; return "unexpected"; };
  assert.throws(() => capture(f, [descriptor], renderer), { code: "ENOENT" });
  fs.mkdirSync(f.source);
  assert.throws(() => capture(f, [descriptor], renderer),
    /Template source is not a regular file: workflow\.yml/);
  assert.equal(calls, 0);
  assert.deepEqual(fs.readdirSync(f.repo), []);
});

test("non-regular destinations fail without replacing them", (t) => {
  const f = fixture(t);
  fs.mkdirSync(f.destination, { recursive: true });
  assert.throws(() => capture(f),
    /Template destination is not a regular file: \.github\/workflows\/example\.yml/);
  assert.equal(fs.lstatSync(f.destination).isDirectory(), true);
  assert.deepEqual(fs.readdirSync(f.destination), []);
});

test("renderer failure propagates and leaves the source and destination untouched", (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.dirname(f.destination), { recursive: true });
  fs.writeFileSync(f.destination, "preserve\n");
  const failure = new Error("renderer rejected");
  assert.throws(() => capture(f, [descriptor], () => { throw failure; }),
    (error) => error === failure);
  assert.equal(fs.readFileSync(f.source, "utf8"), "name: café\n");
  assert.equal(fs.readFileSync(f.destination, "utf8"), "preserve\n");
});
