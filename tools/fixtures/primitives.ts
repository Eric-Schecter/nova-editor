import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  defaultGeometry,
  makePrimitive,
  readGLB,
  writeGLB,
  applyMaterial,
  materialData,
  applyTexture,
  groundOffset,
  type PrimitiveType,
} from "../../packages/asset-system/index";
import { emptyScene, identity } from "../../packages/scene-schema/index";
import { eulerQuaternion } from "../../packages/scene-schema/transforms";
import { packProject } from "../../packages/editor-core/src/project";
import { linearColor } from "../../packages/editor-core/src/lighting";
const root = new URL("../../", import.meta.url),
  scene = emptyScene(),
  assets: Record<string, Uint8Array> = {};
scene.name = "Geometry & PBR";
const checker = new Uint8Array(
  await readFile(new URL("resources/materials/checker.png", root)),
);
const layout: [PrimitiveType, string, string, number, number][] = [
  ["box", "Box", "#d85f3d", -4, 0],
  ["sphere", "Sphere", "#387db8", 0, 0],
  ["cylinder", "Cylinder", "#d4ae50", 4, 0],
  ["cone", "Cone", "#599767", -4, 4],
  ["torus", "Torus", "#a376b3", 0, 4],
  ["plane", "Textured plane", "#ffffff", 4, 4],
];
for (const [type, name, color, x, z] of layout) {
  const g = defaultGeometry(type);
  if (type === "box") {
    g.parameters.width = 2;
    g.parameters.height = 1.5;
    g.parameters.depth = 1.5;
  }
  if (type === "plane") {
    g.parameters.width = 3;
    g.parameters.depth = 3;
  }
  let doc = readGLB(makePrimitive(g));
  if (type === "plane") doc = applyTexture(doc, "baseColor", checker);
  const m = materialData(doc);
  m.color = linearColor(color);
  m.metallic = type === "sphere" ? 0.65 : 0.1;
  m.roughness = type === "sphere" ? 0.25 : 0.55;
  doc = applyMaterial(doc, m);
  const path = `assets/${type}.glb`;
  assets[path] = writeGLB(doc);
  scene.assets[type] = { path, sourceSpace: true, name };
  const transform = identity();
  transform.position = [x, groundOffset(g), z];
  if (type === "torus") {
    transform.rotation = eulerQuaternion([90, 0, 0]);
    transform.position[1] = 1.25;
  }
  scene.nodes.push({
    id: type,
    parentId: null,
    name,
    assetId: type,
    transform,
  });
}
const output = new URL("output/primitives-study/", root);
await mkdir(new URL("assets/", output), { recursive: true });
await writeFile(
  new URL("project.json", output),
  JSON.stringify(scene, null, 2),
);
for (const [path, bytes] of Object.entries(assets))
  await writeFile(new URL(path, output), bytes);
const web = new URL("apps/web/public/examples/", root);
await mkdir(web, { recursive: true });
await writeFile(new URL("primitives.zip", web), packProject({ scene, assets }));
console.log("Generated editable geometry / PBR example");
