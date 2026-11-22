import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { prepareGLTFImport } from "../packages/asset-system/prepare-gltf-import";
import { exportGLB } from "../packages/asset-system/export-glb";
import {
  makePrimitive,
  defaultGeometry,
  readGLB,
  writeGLB,
} from "../packages/asset-system/index";
import { emptyScene, identity } from "../packages/scene-schema/index";

function fixture() {
  const s = emptyScene();
  s.name = "Export fixture";
  s.assets = {
    a: { path: "assets/a.glb", sourceSpace: true },
    b: { path: "assets/b.glb", sourceSpace: true },
  };
  const t = identity();
  t.position = [3, 2, 1];
  t.rotation = [0, 0, Math.sin(0.3), Math.cos(0.3)];
  t.scale = [2, 3, -1];
  s.nodes = [
    { id: "parent", parentId: null, name: "Parent", transform: t },
    {
      id: "left",
      parentId: "parent",
      name: "Left",
      transform: identity(),
      assetId: "a",
    },
    {
      id: "right",
      parentId: "parent",
      name: "Right",
      transform: { ...identity(), position: [4, 0, 0] },
      assetId: "a",
    },
    {
      id: "other",
      parentId: null,
      name: "Other",
      transform: identity(),
      assetId: "b",
    },
  ];
  const a = readGLB(makePrimitive(defaultGeometry("box")));
  // Real embedded PNG, separate sampler and second material slot.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4GQAAAAASUVORK5CYII=",
    "base64",
  );
  const start = a.bin.length,
    bin = new Uint8Array(start + png.length);
  bin.set(a.bin);
  bin.set(png, start);
  a.bin = bin;
  a.json.buffers[0].byteLength = bin.length;
  a.json.bufferViews.push({
    buffer: 0,
    byteOffset: start,
    byteLength: png.length,
  });
  a.json.images = [{ mimeType: "image/png", bufferView: 1 }];
  a.json.samplers = [{ wrapS: 33071, wrapT: 33648 }];
  a.json.textures = [{ source: 0, sampler: 0 }];
  a.json.materials[0].pbrMetallicRoughness.baseColorTexture = { index: 0 };
  a.json.materials.push({
    ...structuredClone(a.json.materials[0]),
    name: "Second",
  });
  a.json.meshes[0].primitives.push({
    ...structuredClone(a.json.meshes[0].primitives[0]),
    material: 1,
  });
  a.json.nodes[0].name = "Source mesh";
  a.json.nodes[0].translation = [0.5, 1, 0];
  const b = structuredClone(a);
  b.json.materials[0].name = "Other material";
  const files = { "assets/a.glb": writeGLB(a), "assets/b.glb": writeGLB(b) };
  return { s, files, png };
}
test("GLB export keeps hierarchy, local TRS, shared meshes, slots and embedded image bytes; subtree keeps ancestors", () => {
  const { s, files, png } = fixture();
  const before = JSON.stringify(s);
  const load = (p: string) => files[p as keyof typeof files];
  const full = readGLB(exportGLB(s, load));
  const j = full.json;
  assert.equal(j.meshes.length, 2);
  assert.equal(j.materials.length, 4);
  assert.equal(j.nodes.filter((n: any) => n.mesh === 0).length, 2);
  const parent = j.nodes.find((n: any) => n.name === "Parent");
  assert.deepEqual(parent.translation, [3, 2, 1]);
  assert.deepEqual(parent.scale, [2, 3, -1]);
  assert.equal(parent.children.length, 2);
  assert.equal(j.meshes[1].primitives[1].material, 3);
  assert.equal(j.materials[2].pbrMetallicRoughness.baseColorTexture.index, 1);
  assert.equal(j.textures[1].source, 1);
  assert.equal(j.textures[1].sampler, 1);
  for (const img of j.images) {
    const v = j.bufferViews[img.bufferView];
    assert.deepEqual(
      Buffer.from(full.bin.slice(v.byteOffset, v.byteOffset + v.byteLength)),
      png,
    );
  }
  const one = readGLB(exportGLB(s, load, ["left"]));
  assert(one.json.nodes.some((n: any) => n.name === "Parent"));
  assert(
    !one.json.nodes.some((n: any) => n.name === "Right" || n.name === "Other"),
  );
  assert.equal(one.json.meshes.length, 1);
  const overlap = readGLB(exportGLB(s, load, ["parent", "left"]));
  assert.equal(
    overlap.json.nodes.filter((n: any) => n.name === "Left").length,
    1,
  );
  assert.equal(JSON.stringify(s), before);
  assert.throws(() => exportGLB(s, load, []));
  assert.throws(() =>
    exportGLB(s, () => {
      throw Error("Missing");
    }),
  );
  mkdirSync("output/export-glb-contract/assets", { recursive: true });
  writeFileSync("output/export-glb-contract/project.json", JSON.stringify(s));
  for (const [p, b] of Object.entries(files))
    writeFileSync("output/export-glb-contract/" + p, b);
  writeFileSync("output/export-glb-contract/web.glb", exportGLB(s, load));
  writeFileSync(
    "output/export-glb-contract/web-selected.glb",
    exportGLB(s, load, ["left"]),
  );
});
test("legacy normalization and unsupported payloads fail explicitly", () => {
  const { s, files } = fixture();
  s.assets.a.sourceSpace = false;
  const doc = readGLB(
    exportGLB(s, (p) => files[p as keyof typeof files], ["left"]),
  );
  assert(doc.json.nodes.some((n: any) => n.name === "Source normalization"));
  const a = readGLB(files["assets/a.glb"]);
  a.extra.push({ type: 123, data: new Uint8Array(4) });
  assert.throws(() => exportGLB(s, () => writeGLB(a), ["left"]), /自定义/);
});

test("GLB export gives duplicated rigs distinct joints and clips while sharing accessors", () => {
  const { s, files } = fixture();
  // Put a different asset first so the animated accessors need a nonzero offset.
  s.nodes.unshift(s.nodes.pop()!);
  const rig = readGLB(files["assets/a.glb"]);
  rig.json.nodes.push({name: "Joint"});
  rig.json.nodes[0].children = [1];
  rig.json.nodes[0].skin = 0;
  rig.json.skins = [{joints: [1], skeleton: 1, inverseBindMatrices: 0}];
  rig.json.animations = [{
    name: "Clip",
    samplers: [{input: 0, output: 1}],
    channels: [{sampler: 0, target: {node: 1, path: "translation"}}],
  }];
  files["assets/a.glb"] = writeGLB(rig);
  const load = (p: string) => files[p as keyof typeof files];
  const {json} = readGLB(exportGLB(s, load));
  const shift = readGLB(files["assets/b.glb"]).json.accessors.length;
  assert.equal(json.skins.length, 2);
  assert.equal(json.animations.length, 2);
  const [left, right] = json.skins.map((skin: any) => skin.joints[0]);
  assert.notEqual(left, right);
  for (const [i,joint] of [left,right].entries()) {
    const skin = json.skins[i], clip = json.animations[i];
    const mesh = json.nodes.find((n: any) => n.skin === i);
    assert.equal(json.nodes[joint].name, "Joint");
    assert.equal(skin.skeleton, joint);
    assert.equal(skin.inverseBindMatrices, shift);
    assert.deepEqual(mesh.children, [joint]);
    assert.deepEqual(clip.samplers, [{input: shift, output: shift + 1}]);
    assert.equal(clip.channels[0].target.node, joint);
  }
  const selected = readGLB(exportGLB(s, load, ["right"])).json;
  assert.equal(selected.skins.length, 1);
  assert.equal(selected.animations.length, 1);
  assert.equal(selected.nodes[selected.skins[0].joints[0]].name, "Joint");
  assert.equal(selected.nodes[selected.scenes[0].nodes[0]].name, "Parent");
});

test("empty scenes, cameras, punctual lights and required material extensions export as standard glTF", () => {
  const empty = readGLB(
    exportGLB(emptyScene(), () => {
      throw Error("unexpected load");
    }),
  );
  assert.equal(empty.json.nodes.length, 0);
  const { s, files } = fixture();
  s.schemaVersion = 7;
  s.nodes.push({
    id: "camera",
    parentId: "parent",
    name: "Camera",
    transform: identity(),
    camera: {
      projection: "perspective",
      focusDistance: 5,
      orthographicSize: 10,
      exposure: 1,
      primary: true,
      verticalFov: 60,
      nearPlane: 0.5,
      farPlane: 80,
    },
  });
  s.nodes.push({
    id: "lamp",
    parentId: null,
    name: "Spot",
    transform: identity(),
    light: {
      type: "spot",
      active: true,
      color: [1, 0.5, 0],
      intensity: 12,
      range: 10,
      innerConeAngle: 0.2,
      outerConeAngle: 0.6,
      shadows: true,
      softness: 1,
    },
  });
  const a = readGLB(files["assets/a.glb"]);
  a.json.extensionsUsed = ["KHR_materials_unlit"];
  a.json.extensionsRequired = ["KHR_materials_unlit"];
  a.json.materials[0].extensions = { KHR_materials_unlit: {} };
  const doc = readGLB(
    exportGLB(s, (p) =>
      p === "assets/a.glb" ? writeGLB(a) : files[p as keyof typeof files],
    ),
  );
  assert.equal(doc.json.cameras[0].perspective.yfov, Math.PI / 3);
  assert.equal(
    doc.json.extensions.KHR_lights_punctual.lights[0].spot.outerConeAngle,
    0.6,
  );
  assert.deepEqual(doc.json.extensionsRequired, ["KHR_materials_unlit"]);
  assert.throws(
    () =>
      exportGLB(s, () => {
        a.json.extensionsUsed = ["KHR_draco_mesh_compression"];
        return writeGLB(a);
      }),
    /扩展/,
  );
});

test("light extraction restores a parented spotlight without changing rig references", () => {
  const extension = "KHR_lights_punctual";
  const json = {
    scene: 0,
    scenes: [{ nodes: [0] }],
    extensionsUsed: [extension, "KHR_materials_specular"],
    extensionsRequired: [extension],
    extensions: {
      [extension]: { lights: [{
        type: "spot", color: [1, .8, .5], intensity: 0, range: 7,
        spot: { innerConeAngle: .2, outerConeAngle: .5 },
        extras: { novaEditor: { active: false, intensity: 35, shadows: true, softness: 1.5 } },
      }]},
    },
    nodes: [{name: "Group", translation: [2, 0, 0], children: [1, 2]},
      {name: "Armature", skin: 0}, {name: "Key", extensions: {[extension]: {light: 0}}}],
    animations: [{channels: [{target: {node: 1, path: "translation"}}]}],
    skins: [{joints: [1]}],
  };
  let id = 0;
  const result = prepareGLTFImport({json, bin: new Uint8Array(), extra: []}, "root", () => String(++id));
  assert.equal(result.changed, true);
  assert.equal(result.nodes.length, 2);
  assert.deepEqual(result.nodes[0].transform.position, [2, 0, 0]);
  assert.equal(result.nodes[1].parentId, result.nodes[0].id);
  assert.deepEqual(result.nodes[1].light, {
    type: "spot", color: [1, .8, .5], active: false, intensity: 35, range: 7,
    shadows: true, softness: 1.5, innerConeAngle: .2, outerConeAngle: .5,
  });
  assert.deepEqual(json.extensionsUsed, ["KHR_materials_specular"]);
  assert.equal(json.extensionsRequired, undefined);
  assert.deepEqual(json.skins[0].joints, [1]);
  assert.equal(json.animations[0].channels[0].target.node, 1);
});

test("glTF import restores camera lenses and supplies a shared default material", () => {
  const json: any = {
    scenes: [{ nodes: [0] }],
    nodes: [{ children: [1, 2], translation: [1, 2, 3] }, { camera: 0 }, { camera: 1 }],
    cameras: [
      { type: "perspective", perspective: { yfov: Math.PI / 3, znear: .2 } },
      { type: "orthographic", orthographic: { xmag: 4, ymag: 3, znear: .1, zfar: 90 } },
    ],
    materials: [{ name: "Original" }],
    meshes: [{ primitives: [{}, { material: 0 }, {}] }],
  };
  let id = 0;
  const imported = prepareGLTFImport({ json, bin: new Uint8Array(), extra: [] }, "root", () => String(++id));
  const [group, perspective, orthographic] = imported.nodes;
  assert.deepEqual(group.transform.position, [1, 2, 3]);
  assert.equal(perspective.parentId, group.id);
  assert.ok(Math.abs(perspective.camera!.verticalFov! - 60) < 1e-6);
  assert.equal(perspective.camera!.nearPlane, .2);
  assert.equal(perspective.camera!.farPlane, 200);
  assert.equal(orthographic.camera!.orthographicSize, 6);
  assert.equal(orthographic.camera!.farPlane, 90);
  assert.equal(json.cameras, undefined);
  assert.equal(json.nodes[1].camera, undefined);
  assert.deepEqual(json.meshes[0].primitives.map((p: any) => p.material), [1, 0, 1]);
  assert.deepEqual(json.materials, [{ name: "Original" }, {}]);
});

test("sparse accessors retain zero bases, strided bases and replacement bytes", () => {
  const sparse = () => ({
    count: 1, indices: { bufferView: 0, componentType: 5121 }, values: { bufferView: 1 },
  });
  const doc = {
    bin: Uint8Array.of(1, 0, 0, 0, 9, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0, 5, 0, 0, 0),
    extra: [],
    json: {
      buffers: [{ byteLength: 20 }],
      bufferViews: [
        { buffer: 0, byteLength: 1 },
        { buffer: 0, byteOffset: 4, byteLength: 1 },
        { buffer: 0, byteOffset: 8, byteLength: 12, byteStride: 4 },
      ],
      accessors: [
        { count: 3, type: "SCALAR", componentType: 5121, sparse: sparse() },
        { count: 3, type: "SCALAR", componentType: 5121, bufferView: 2, sparse: sparse() },
      ],
    },
  };
  const prepared = prepareGLTFImport(doc, "root", () => assert.fail("unexpected scene node"));
  assert.equal(prepared.changed, true);
  for (const [i, expected] of [[0, [0, 9, 0]], [1, [3, 9, 5]]] as const) {
    const accessor = doc.json.accessors[i];
    assert.equal(accessor.sparse, undefined);
    const view = doc.json.bufferViews[accessor.bufferView!];
    assert.deepEqual([...doc.bin.subarray(view.byteOffset, view.byteOffset! + view.byteLength)], expected);
  }
});
