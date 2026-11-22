import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { packGLTF, splitGLB } from "../packages/asset-system/convert-gltf";
import { readGLB } from "../packages/asset-system/index";

test("textured GLB splits into files and repacks with relocated external buffers", () => {
  const original = readFileSync("tests/fixtures/material-alpha/Layers.glb");
  const source = readGLB(original);
  const files = splitGLB(original);
  const json = JSON.parse(new TextDecoder().decode(files["model.gltf"]));
  const image = json.images[0];
  assert.equal(image.uri, "image-1.png");
  assert.ok(files[image.uri].length > 8);
  json.buffers.push({ uri: "./nested/./second%20buffer.bin", byteLength: 4 });
  json.bufferViews.push({ buffer: 1, byteLength: 4 });
  const secondIndex = json.bufferViews.length - 1;
  files["nested/second buffer.bin"] = Uint8Array.of(1, 2, 3, 4);
  const input = new TextEncoder().encode(JSON.stringify(json));
  const packed = packGLTF(input, path => {
    assert.ok(files[path], path);
    return files[path];
  });
  const reopened = readGLB(packed);
  assert.deepEqual(reopened.json.materials, source.json.materials);
  const second = reopened.json.bufferViews[secondIndex];
  assert.equal(second.buffer, 0);
  assert.equal(second.byteOffset % 4, 0);
  assert.deepEqual(reopened.bin.slice(second.byteOffset, second.byteOffset + 4), Uint8Array.of(1, 2, 3, 4));
  assert.deepEqual(splitGLB(packed)["image-1.png"], new Uint8Array(files["image-1.png"]));
  json.buffers[1].uri = "%2e%2e/private.bin";
  assert.throws(() => packGLTF(new TextEncoder().encode(JSON.stringify(json)), path => files[path]), /相对路径/);
});

test("inline Base64 buffers pack without external reads", () => {
  const doc = {asset:{version:"2.0"},buffers:[{uri:"data:application/octet-stream;base64,AQIDBA==",byteLength:4}]};
  const packed = packGLTF(new TextEncoder().encode(JSON.stringify(doc)), () => assert.fail("unexpected file read"));
  assert.deepEqual(readGLB(packed).bin, Uint8Array.of(1,2,3,4));
});

test("repeated GLB roundtrips keep one copy of texture bytes", () => {
  const original = new Uint8Array(readFileSync("tests/fixtures/material-alpha/Layers.glb"));
  let glb: Uint8Array = original;
  let expected: Uint8Array | undefined;
  for (let i = 0; i < 5; i++) {
    const files = splitGLB(glb);
    assert.ok(files["model.bin"].length < readGLB(glb).json.buffers[0].byteLength);
    assert.equal(Buffer.from(files["model.bin"]).indexOf(Buffer.from(files["image-1.png"])), -1);
    glb = packGLTF(files["model.gltf"], path => files[path]);
    if (expected) assert.deepEqual(glb, expected);
    expected = glb;
  }
});
