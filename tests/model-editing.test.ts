import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeModel, expandModel } from "../packages/asset-system/model";
import {
  readGLB,
  writeGLB,
  materialData,
  applyMaterial,
  hasTexture,
} from "../packages/asset-system/index";
import {
  emptyScene,
  identity,
  validateScene,
} from "../packages/scene-schema/index";
import {
  localMatrix,
  worldMatrices,
  eulerQuaternion,
  multiply,
} from "../packages/scene-schema/transforms";
import { EditorHistory } from "../packages/editor-core/src/index";
import {
  packProject,
  unpackProject,
} from "../packages/editor-core/src/project";
import { loadGLB } from "../deps/nova/web/src/ModelData.js";
const bytes = new Uint8Array(readFileSync("tests/fixtures/model-parts.glb"));
const allocator = () => {
  let i = 0;
  return () => `generated-${++i}`;
};
function scene(sourceSpace = true) {
  const s = emptyScene();
  s.assets.model = { path: "assets/model.glb", sourceSpace };
  s.nodes.push({
    id: "model",
    name: "Model",
    parentId: null,
    assetId: "model",
    transform: identity(),
  });
  return s;
}
function close(a: number[], b: number[]) {
  a.forEach((x, k) =>
    assert.ok(Math.abs(x - b[k]) < 1e-5, `${k}: ${x} != ${b[k]}`),
  );
}
test("internal node and primitive slots preserve hierarchy, local units, shared mesh instances, and independent PBR / embedded images", async () => {
  const model = decodeModel(bytes);
  assert.equal(model.nodes.length, 8);
  assert.equal(model.parts.length, 3);
  const s = scene(),
    files = expandModel(s, "model", model, allocator());
  validateScene(s);
  assert.equal(s.nodes.length, 9);
  assert.equal(Object.keys(s.assets).length, 3);
  assert.equal(s.nodes[0].assetId, undefined);
  const slots = s.nodes.filter((n) => n.assetId);
  assert.equal(slots.length, 4);
  const body = s.nodes.find((n) => n.name === "Body")!,
    top = s.nodes.find((n) => n.name === "Top")!,
    base = s.nodes.find((n) => n.name === "Base")!;
  assert.equal(top.parentId, body.id);
  assert.equal(
    slots.find((n) => n.parentId === base.id)!.assetId,
    slots.find((n) => n.parentId === top.id)!.assetId,
  );
  const worlds = worldMatrices(s);
  close(worlds.get(body.id)!.slice(12, 15), [0, 1.25, 0]);
  close(worlds.get(top.id)!.slice(12, 15), [0, 2.4, 0]);
  const docs = model.parts.map((p) => readGLB(p.bytes));
  assert.deepEqual(
    docs.slice(0, 2).map((d) => materialData(d).name),
    ["Terracotta", "Ocean blue"],
  );
  assert.equal(hasTexture(docs[2], "baseColor"), true);
  assert.equal(hasTexture(docs[0], "baseColor"), false);
  const material = materialData(docs[0]);
  material.color = [0.05, 0.8, 0.1];
  material.roughness = 0.15;
  const edited = applyMaterial(docs[0], material);
  assert.notDeepEqual(materialData(edited), materialData(docs[0]));
  assert.equal(materialData(docs[1]).name, "Ocean blue");
  for (const doc of docs.slice(0, 2)) {
    const url = URL.createObjectURL(new Blob([new Uint8Array(writeGLB(doc))]));
    try {
      const loaded = await loadGLB(url);
      assert.equal(loaded.vertices.length / 36, 12);
      close(
        loaded.baseColor,
        doc.json.materials[0].pbrMetallicRoughness.baseColorFactor,
      );
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const reopened = unpackProject(packProject({ scene: s, assets: files }));
  assert.deepEqual(reopened.scene, s);
  assert.equal(
    hasTexture(
      readGLB(
        reopened.assets[
          s.assets[slots.find((n) => n.parentId === base.id)!.assetId!].path
        ],
      ),
      "baseColor",
    ),
    true,
  );
});
test("expansion is one undo, preserves mirrored matrix nodes and legacy normalization, and can be repeated after undo", () => {
  const original = readGLB(bytes);
  original.json.nodes[1] = {
    ...original.json.nodes[1],
    matrix: localMatrix({
      position: [2, 3, -1],
      rotation: eulerQuaternion([20, 35, -10]),
      scale: [-2, 1, 3],
    }),
  };
  delete original.json.nodes[1].translation;
  const model = decodeModel(writeGLB(original)),
    initial = scene(false);
  initial.nodes[0].transform.position = [10, 1, 2];
  const h = new EditorHistory(initial);
  h.commit((s) => expandModel(s, "model", model, allocator()));
  const expanded = h.scene,
    worlds = worldMatrices(expanded),
    node = expanded.nodes.find((n) => n.name === "Body")!;
  close(
    worlds.get(node.id)!,
    multiply(
      multiply(
        localMatrix(initial.nodes[0].transform),
        localMatrix(model.normalization),
      ),
      original.json.nodes[1].matrix,
    ),
  );
  h.undo();
  assert.deepEqual(h.scene, initial);
  h.redo();
  assert.deepEqual(h.scene, expanded);
  const locked = scene();
  locked.nodes[0].locked = true;
  assert.throws(() => expandModel(locked, "model", model, allocator()));
  assert.equal(locked.nodes.length, 1);
});
test("unsupported or malformed model structures reject before publishing a partial hierarchy", () => {
  for (const change of [
    (j: any) => j.nodes[0].children.push(0),
    (j: any) => j.nodes[0].children.push(1),
    (j: any) => (j.nodes[1].scale = [0, 1, 1]),
    (j: any) =>
      (j.nodes[1].matrix = [1, 0, 0, 0, 0.5, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    (j: any) => (j.animations = [{}]),
    (j: any) => (j.meshes[0].primitives[0].targets = [{}]),
    (j: any) => (j.materials[0].alphaMode = "INVALID"),
    (j: any) => (j.images[0].uri = "external.png"),
    (j: any) => (j.accessors[0].count = 2 ** 32),
  ]) {
    const doc = readGLB(bytes);
    change(doc.json);
    assert.throws(() => decodeModel(writeGLB(doc)));
  }
});
