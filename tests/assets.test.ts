import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  defaultGeometry,
  makePrimitive,
  geometryVertices,
  readGLB,
  writeGLB,
  geometryData,
  regenerateGeometry,
  materialData,
  applyMaterial,
  applyTexture,
  hasTexture,
  type PrimitiveType,
} from "../packages/asset-system/index";
import { loadGLB } from "../deps/nova/web/src/ModelData.js";
import { modelTriangleFloats } from "../deps/nova/web/src/ModelVertex.js";
import { emptyScene, identity } from "../packages/scene-schema/index";
import {
  packProject,
  unpackProject,
} from "../packages/editor-core/src/project";
const fixture = JSON.parse(
  readFileSync("tests/fixtures/primitives.json", "utf8"),
) as {
  type: PrimitiveType;
  triangles: number;
  minimum: number[];
  maximum: number[];
}[];
const checker = new Uint8Array(readFileSync("tests/fixtures/checker.png"));
function close(a: number[], b: number[], epsilon = 1e-5) {
  a.forEach((v, i) =>
    assert.ok(Math.abs(v - b[i]) < epsilon, `${i}: ${v} != ${b[i]}`),
  );
}
test("six primitive GLBs: actual SDK loading, bounds, winding, normals, UVs and editable metadata", async () => {
  for (const spec of fixture) {
    const g = defaultGeometry(spec.type),
      bytes = makePrimitive(g),
      doc = readGLB(bytes),
      data = geometryVertices(g);
    assert.equal(data.length / 24, spec.triangles, spec.type);
    assert.deepEqual(geometryData(doc), g);
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
    try {
      const loaded = await loadGLB(url);
      close(loaded.sourceMinimum, spec.minimum);
      close(loaded.sourceMaximum, spec.maximum);
      assert.equal(loaded.vertices.length / modelTriangleFloats, spec.triangles);
    } finally {
      URL.revokeObjectURL(url);
    }
    for (let i = 0; i < data.length; i += 24) {
      const a = data.slice(i, i + 3),
        b = data.slice(i + 8, i + 11),
        c = data.slice(i + 16, i + 19),
        u = b.map((v, k) => v - a[k]),
        v = c.map((x, k) => x - a[k]),
        n = [
          u[1] * v[2] - u[2] * v[1],
          u[2] * v[0] - u[0] * v[2],
          u[0] * v[1] - u[1] * v[0],
        ];
      assert.ok(
        n.reduce((s, v, k) => s + v * data[i + 3 + k], 0) >= -1e-8,
        `${spec.type}: reversed face`,
      );
    }
    for (let i = 0; i < data.length; i += 8) {
      assert.ok(Math.abs(Math.hypot(...data.slice(i + 3, i + 6)) - 1) < 1e-6);
      assert.ok(
        data[i + 6] >= 0 &&
          data[i + 6] <= 1 &&
          data[i + 7] >= 0 &&
          data[i + 7] <= 1,
      );
    }
  }
});
test("parameter edits rebuild geometry while retaining PBR factors and embedded texture bytes", () => {
  const doc = readGLB(makePrimitive(defaultGeometry("sphere"))),
    m = materialData(doc);
  m.color = [0.8, 0.1, 0.05];
  m.metallic = 0.75;
  m.roughness = 0.2;
  m.normalScale = 1.5;
  const textured = applyMaterial(
      applyTexture(applyTexture(doc, "baseColor", checker), "normal", checker),
      m,
    ),
    g = defaultGeometry("sphere");
  g.parameters.radius = 2;
  g.parameters.widthSegments = 24;
  const next = readGLB(writeGLB(regenerateGeometry(textured, g)));
  assert.deepEqual(materialData(next), m);
  assert.deepEqual(geometryData(next), g);
  for (const img of next.json.images) {
    const view = next.json.bufferViews[img.bufferView];
    assert.deepEqual(
      next.bin.slice(view.byteOffset, view.byteOffset + view.byteLength),
      checker,
    );
  }
  assert.equal(hasTexture(next, "baseColor"), true);
  assert.equal(
    hasTexture(applyTexture(next, "baseColor", null), "baseColor"),
    false,
  );
  assert.deepEqual(
    doc.json.materials[0].pbrMetallicRoughness.baseColorFactor,
    [0.5, 0.5, 0.5, 1],
  );
});
test("project archive contains authoritative edited GLBs and does not depend on generator or external files", () => {
  const geometry = defaultGeometry("box");
  geometry.parameters.width = 3;
  const doc = readGLB(makePrimitive(geometry)),
    material = materialData(doc);
  material.roughness = 0.1;
  const bytes = writeGLB(
    applyMaterial(applyTexture(doc, "baseColor", checker), material),
  );
  const scene = emptyScene();
  scene.assets.mesh = { path: "assets/edited.glb", sourceSpace: true };
  scene.nodes.push({
    id: "mesh",
    name: "Box",
    parentId: null,
    assetId: "mesh",
    transform: identity(),
  });
  const reopened = unpackProject(
    packProject({ scene, assets: { "assets/edited.glb": bytes } }),
  );
  assert.deepEqual(
    geometryData(readGLB(reopened.assets["assets/edited.glb"])),
    geometry,
  );
  assert.deepEqual(
    materialData(readGLB(reopened.assets["assets/edited.glb"])),
    material,
  );
});
test("invalid or excessive geometry, corrupt GLBs, invalid materials and textures without UVs reject safely", () => {
  for (const [type, key, value] of [
    ["box", "width", 0],
    ["box", "widthSegments", 1000],
    ["sphere", "widthSegments", 3],
    ["cone", "height", Infinity],
    ["torus", "tube", 2],
  ] as const) {
    const g = defaultGeometry(type);
    g.parameters[key] = value;
    assert.throws(() => makePrimitive(g));
  }
  const bytes = makePrimitive(defaultGeometry("box"));
  assert.throws(() => readGLB(bytes.slice(0, -1)));
  const bad = bytes.slice();
  new DataView(bad.buffer).setUint32(12, 0xfffffff0, true);
  assert.throws(() => readGLB(bad));
  const doc = readGLB(bytes),
    original = writeGLB(doc);
  const material = materialData(doc);
  material.metallic = 2;
  assert.throws(() => applyMaterial(doc, material));
  delete doc.json.meshes[0].primitives[0].attributes.TEXCOORD_0;
  assert.throws(() => applyTexture(doc, "baseColor", checker));
  assert.deepEqual(writeGLB(readGLB(original)), original);
});
