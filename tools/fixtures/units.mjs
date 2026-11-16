// Small deterministic scene to verify source units, authored roots and desktop/web roundtrips.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { zipSync, strToU8 } from "fflate";
const root = new URL("../../", import.meta.url),
  seed = await readFile(new URL("resources/viewport/axis-0.glb", root));
const oldLength = seed.readUInt32LE(12),
  original = JSON.parse(seed.subarray(20, 20 + oldLength).toString()),
  bin = seed.subarray(28 + oldLength);
async function box(name, size, translation, color) {
  const json = structuredClone(original);
  json.asset.generator = "Nova Editor source-unit fixture";
  json.nodes[0].scale = [size[0] / 40, size[1] / 0.018, size[2] / 0.018];
  json.nodes[0].translation = translation;
  json.materials[0].pbrMetallicRoughness.baseColorFactor = [...color, 1];
  json.materials[0].emissiveFactor = [0, 0, 0];
  let text = Buffer.from(JSON.stringify(json));
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 32)]);
  const out = Buffer.alloc(28 + text.length + bin.length);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(text.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  text.copy(out, 20);
  out.writeUInt32LE(bin.length, 20 + text.length);
  out.writeUInt32LE(0x004e4942, 24 + text.length);
  bin.copy(out, 28 + text.length);
  await writeFile(new URL(`tests/fixtures/${name}.glb`, root), out);
  return out;
}
const small = await box(
  "units-small",
  [1, 1, 1],
  [0.75, 0.5, 0.5],
  [0.8, 0.36, 0.16],
);
const tall = await box(
  "units-tall",
  [2, 3, 1.5],
  [0, 1.5, 0],
  [0.2, 0.46, 0.7],
);
const identity = () => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
});
const scene = {
  schemaVersion: 2,
  name: "Source units study",
  assets: {
    small: { path: "assets/units-small.glb", sourceSpace: true },
    tall: { path: "assets/units-tall.glb", sourceSpace: true },
  },
  nodes: [
    {
      id: "small",
      name: "1 m cube",
      parentId: null,
      assetId: "small",
      transform: { ...identity(), position: [-2, 0, 0] },
    },
    {
      id: "tall",
      name: "3 m column",
      parentId: null,
      assetId: "tall",
      transform: { ...identity(), position: [1.5, 0, 0] },
    },
  ],
};
await writeFile(
  new URL("tests/fixtures/units.scene.json", root),
  JSON.stringify(scene, null, 2) + "\n",
);
const files = {
  "project.json": strToU8(JSON.stringify(scene, null, 2)),
  "assets/units-small.glb": small,
  "assets/units-tall.glb": tall,
};
const outDir = new URL("output/units-study/", root);
await mkdir(new URL("assets/", outDir), { recursive: true });
for (const [name, bytes] of Object.entries(files))
  await writeFile(new URL(name, outDir), bytes);
await writeFile(
  new URL("apps/web/public/demo/units-project.zip", root),
  zipSync(files),
);
