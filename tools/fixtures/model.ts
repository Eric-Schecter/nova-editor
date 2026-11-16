import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import {
  defaultGeometry,
  makePrimitive,
  readGLB,
  writeGLB,
  applyTexture,
} from "../../packages/asset-system/index";
import { decodeModel, expandModel } from "../../packages/asset-system/model";
import { emptyScene, identity } from "../../packages/scene-schema/index";
import { packProject } from "../../packages/editor-core/src/project";
const g = defaultGeometry("box");
g.parameters.width = 1.2;
g.parameters.height = 1.8;
g.parameters.depth = 1.2;
const parts = [-0.65, 0.65, 0].map((x, i) => {
  const d = readGLB(makePrimitive(g));
  if (i === 2) {
    g.parameters.width = 2.8;
    g.parameters.height = 0.35;
    g.parameters.depth = 1.8;
    return readGLB(makePrimitive(g));
  }
  const v = new DataView(d.bin.buffer);
  for (let k = 0; k < d.bin.length; k += 32)
    v.setFloat32(k, v.getFloat32(k, true) + x, true);
  d.json.accessors[0].min[0] += x;
  d.json.accessors[0].max[0] += x;
  return d;
});
const j = structuredClone(parts[0].json);
j.bufferViews = [];
j.accessors = [];
j.meshes = [];
j.materials = [];
let bin = new Uint8Array();
const prims: any[] = [];
parts.forEach((d, i) => {
  const offset = bin.length,
    next = new Uint8Array(offset + d.bin.length);
  next.set(bin);
  next.set(d.bin, offset);
  bin = next;
  const vi = j.bufferViews.length,
    ai = j.accessors.length;
  j.bufferViews.push(
    ...d.json.bufferViews.map((v: any) => ({
      ...v,
      byteOffset: (v.byteOffset ?? 0) + offset,
    })),
  );
  j.accessors.push(
    ...d.json.accessors.map((a: any) => ({
      ...a,
      bufferView: a.bufferView + vi,
    })),
  );
  const p = structuredClone(d.json.meshes[0].primitives[0]);
  for (const k of Object.keys(p.attributes)) p.attributes[k] += ai;
  p.material = i;
  prims.push(p);
  const m = structuredClone(d.json.materials[0]);
  m.name = ["Terracotta", "Ocean blue", "Checker base"][i];
  m.pbrMetallicRoughness.baseColorFactor = [
    [0.65, 0.16, 0.07, 1],
    [0.04, 0.22, 0.55, 1],
    [1, 1, 1, 1],
  ][i];
  m.pbrMetallicRoughness.roughnessFactor = [0.6, 0.25, 0.55][i];
  j.materials.push(m);
});
j.meshes = [
  { name: "Two panels", primitives: prims.slice(0, 2) },
  { name: "Plinth", primitives: [prims[2]] },
];
j.nodes = [
  { name: "Assembly", children: [1, 2] },
  { name: "Body", translation: [0, 1.25, 0], mesh: 0, children: [3] },
  { name: "Base", translation: [0, 0.175, 0], mesh: 1 },
  { name: "Top", translation: [0, 1.15, 0], scale: [0.85, 1, 0.85], mesh: 1 },
];
j.scenes = [{ nodes: [0] }];
j.scene = 0;
j.buffers = [{ byteLength: bin.length }];
delete j.extras;
// Add a shared embedded texture only to material slot 2.
let doc = { json: j, bin, extra: [] };
const all = applyTexture(
  doc,
  "baseColor",
  new Uint8Array(readFileSync("resources/materials/checker.png")),
);
delete all.json.materials[0].pbrMetallicRoughness.baseColorTexture;
delete all.json.materials[1].pbrMetallicRoughness.baseColorTexture;
const bytes = writeGLB(all);
writeFileSync("tests/fixtures/model-parts.glb", bytes);
const scene = emptyScene();
scene.name = "Model nodes & material slots";
scene.nodes.push({
  id: "assembly",
  name: "Assembly model",
  parentId: null,
  transform: identity(),
});
let count = 0;
const files = expandModel(
  scene,
  "assembly",
  decodeModel(bytes),
  () => `part-${++count}`,
);
mkdirSync("output/model-study/assets", { recursive: true });
writeFileSync(
  "output/model-study/project.json",
  JSON.stringify(scene, null, 2),
);
for (const [path, data] of Object.entries(files))
  writeFileSync("output/model-study/" + path, data);
mkdirSync("apps/web/public/examples", { recursive: true });
writeFileSync("apps/web/public/examples/model.glb", bytes);
writeFileSync(
  "apps/web/public/examples/model.zip",
  packProject({ scene, assets: files }),
);
console.log("Generated editable internal-node / multi-material fixture");
