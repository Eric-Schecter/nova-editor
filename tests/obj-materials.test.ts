import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { glbToOBJ, objToGLB } from "../packages/asset-system/obj-materials";
import { readGLB } from "../packages/asset-system/index";

test("OBJ bundle preserves textured slots, UV, normals and alpha on GLB reimport", () => {
  const fixture = new Uint8Array(readFileSync("tests/fixtures/material-alpha/Layers.glb"));
  const files = glbToOBJ(fixture);
  const read = (path: string) => {
    if (!files[path]) throw Error("Missing " + path);
    return files[path];
  };
  const glb = objToGLB(read("model.obj"), read);
  const doc = readGLB(glb);
  const second = glbToOBJ(glb);
  assert.match(new TextDecoder().decode(read("model.obj")), /^vt /m);
  assert.match(new TextDecoder().decode(read("model.obj")), /^vn /m);
  assert.match(new TextDecoder().decode(read("model.mtl")), /^map_Kd /m);
  assert.deepEqual(second["texture-1.png"], read("texture-1.png"));
  assert.ok(doc.json.materials.some((m: any) => m.alphaMode === "MASK" && m.doubleSided));
  assert.ok(doc.json.materials.some((m: any) => m.alphaMode === "BLEND"));
  assert.throws(() => objToGLB(read("model.obj"), () => {throw Error("Missing dependency");}), /Missing dependency/);
});
