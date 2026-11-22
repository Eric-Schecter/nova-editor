import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  readGLB,
  writeGLB,
  materialData,
  applyMaterial,
  defaultGeometry,
  makePrimitive,
} from "../packages/asset-system/index";
import { decodeModel } from "../packages/asset-system/model";
import { emptyScene, identity } from "../packages/scene-schema/index";
import {
  packProject,
  unpackProject,
} from "../packages/editor-core/src/project";
import { loadGLB } from "../deps/nova/web/src/ModelData.js";
test("alpha DTO defaults, validation and immutable GLB/project persistence", async () => {
  const doc = readGLB(makePrimitive(defaultGeometry("box"))),
    original = writeGLB(doc),
    defaults = materialData(doc);
  assert.equal(defaults.opacity, 1);
  assert.equal(defaults.alphaMode, "OPAQUE");
  assert.equal(defaults.alphaCutoff, 0.5);
  assert.equal(defaults.doubleSided, false);
  for (const alphaMode of ["OPAQUE", "MASK", "BLEND"] as const) {
    const value = {
        ...defaults,
        opacity: 0.45,
        alphaMode,
        alphaCutoff: 0.35,
        doubleSided: true,
      },
      bytes = writeGLB(applyMaterial(doc, value));
    assert.deepEqual(materialData(readGLB(bytes)), value);
    assert.deepEqual(writeGLB(doc), original);
    const scene = emptyScene();
    scene.assets.a = { path: "assets/alpha.glb", sourceSpace: true };
    scene.nodes.push({
      id: "a",
      name: "Alpha",
      parentId: null,
      assetId: "a",
      transform: identity(),
    });
    const reopened = unpackProject(
      packProject({ scene, assets: { "assets/alpha.glb": bytes } }),
    );
    assert.deepEqual(
      materialData(readGLB(reopened.assets["assets/alpha.glb"])),
      value,
    );
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
    try {
      const loaded = await loadGLB(url);
      assert.equal(loaded.materials[0].alphaMode, alphaMode);
      assert.equal(loaded.materials[0].doubleSided, true);
      assert.ok(Math.abs(loaded.materials[0].baseColor[3] - 0.45) < 1e-6);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  for (const bad of [
    { opacity: -1 },
    { opacity: NaN },
    { alphaCutoff: 2 },
    { alphaMode: "INVALID" },
    { doubleSided: 1 },
  ])
    assert.throws(() => applyMaterial(doc, { ...defaults, ...bad } as any));
  assert.deepEqual(writeGLB(doc), original);
});
test("alpha GLB expansion preserves per-slot modes, textures, mirror and sidedness", () => {
  const bytes = new Uint8Array(
      readFileSync("tests/fixtures/material-alpha/Layers.glb"),
    ),
    model = decodeModel(bytes);
  assert.equal(model.parts.length, 4);
  assert.deepEqual(
    model.parts.map((p) => materialData(readGLB(p.bytes)).alphaMode),
    ["OPAQUE", "BLEND", "BLEND", "MASK"],
  );
  const mask = readGLB(model.parts[3].bytes);
  assert.equal(mask.json.images.length, 1);
  assert.equal(mask.json.materials[0].doubleSided, true);
  assert.equal(
    decodeModel(
      new Uint8Array(
        readFileSync("tests/fixtures/material-alpha/Mirrored.glb"),
      ),
    ).nodes[0].transform.scale[0],
    -1,
  );
});

test("alpha recovery and scene/selection GLB export reopen preserve all slots and images", async () => {
  const { exportGLB } = await import("../packages/asset-system/export-glb");
  const { validateRecovery } = await import(
    "../packages/editor-core/src/project"
  );
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const bytes = new Uint8Array(
    readFileSync("tests/fixtures/material-alpha/Layers.glb"),
  );
  const scene = emptyScene();
  scene.name = "Alpha roundtrip";
  scene.assets.a = { path: "assets/layers.glb", sourceSpace: true };
  scene.nodes = [
    {
      id: "alpha",
      parentId: null,
      name: "Alpha layers",
      assetId: "a",
      transform: identity(),
    },
  ];
  const restored = validateRecovery({
    scene,
    assets: { "assets/layers.glb": bytes },
    id: "alpha-test",
    updated: Date.now(),
    savedSnapshot: JSON.stringify(emptyScene()),
  });
  const reopened = unpackProject(packProject(restored));
  const source = readGLB(bytes);
  for (const selected of [undefined, ["alpha"]]) {
    const output = readGLB(
      exportGLB(reopened.scene, (p) => reopened.assets[p], selected),
    );
    assert.deepEqual(output.json.materials, source.json.materials);
    for (let i = 0; i < source.json.images.length; i++) {
      const a = source.json.bufferViews[source.json.images[i].bufferView],
        b = output.json.bufferViews[output.json.images[i].bufferView];
      assert.deepEqual(
        output.bin.slice(b.byteOffset ?? 0, (b.byteOffset ?? 0) + b.byteLength),
        source.bin.slice(a.byteOffset ?? 0, (a.byteOffset ?? 0) + a.byteLength),
      );
    }
  }
  mkdirSync("output/alpha-roundtrip/assets", { recursive: true });
  writeFileSync("output/alpha-roundtrip/assets/layers.glb", bytes);
  writeFileSync("output/alpha-roundtrip/project.json", JSON.stringify(scene));
  writeFileSync(
    "output/alpha-roundtrip/web.glb",
    exportGLB(scene, (p) => reopened.assets[p]),
  );
});
