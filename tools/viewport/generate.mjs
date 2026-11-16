// Deterministic editor-only geometry. No runtime dependencies or project assets.
import { mkdir, writeFile, copyFile } from "node:fs/promises";
const root = new URL("../../resources/viewport/", import.meta.url);
await mkdir(root, { recursive: true });
const manifest = [];
function box(vertices, lo, hi) {
  for (const [axis, sign] of [
    [0, -1],
    [0, 1],
    [1, -1],
    [1, 1],
    [2, -1],
    [2, 1],
  ]) {
    const u = (axis + 1) % 3,
      v = (axis + 2) % 3;
    const corners = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ].map(([a, b]) => {
      const p = [0, 0, 0];
      p[axis] = sign > 0 ? hi[axis] : lo[axis];
      p[u] = a ? hi[u] : lo[u];
      p[v] = b ? hi[v] : lo[v];
      return p;
    });
    const indices = sign > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (const i of indices) {
      const n = [0, 0, 0];
      n[axis] = sign;
      vertices.push(...corners[i], ...n, 0, 0);
    }
  }
}
async function asset(name, color, build, emission = 0.25) {
  const data = [];
  build(data);
  const min = [0, 1, 2].map((k) =>
    Math.min(...data.filter((_, i) => i % 8 === k)),
  );
  const max = [0, 1, 2].map((k) =>
    Math.max(...data.filter((_, i) => i % 8 === k)),
  );
  const scale = Math.max(...max.map((v, k) => v - min[k])) / 2;
  const center = max.map((v, k) => (v + min[k]) / 2);
  const bin = Buffer.from(new Float32Array(data).buffer);
  const json = {
    asset: { version: "2.0", generator: "Nova Editor viewport helpers" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
            material: 0,
          },
        ],
      },
    ],
    materials: [
      {
        doubleSided: true,
        pbrMetallicRoughness: {
          baseColorFactor: [...color, 1],
          metallicFactor: 0,
          roughnessFactor: 1,
        },
        emissiveFactor: color.map((x) => x * emission),
      },
    ],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      {
        buffer: 0,
        byteOffset: 0,
        byteLength: bin.length,
        byteStride: 32,
        target: 34962,
      },
    ],
    accessors: [
      {
        bufferView: 0,
        byteOffset: 0,
        componentType: 5126,
        count: data.length / 8,
        type: "VEC3",
        min,
        max,
      },
      {
        bufferView: 0,
        byteOffset: 12,
        componentType: 5126,
        count: data.length / 8,
        type: "VEC3",
      },
      {
        bufferView: 0,
        byteOffset: 24,
        componentType: 5126,
        count: data.length / 8,
        type: "VEC2",
      },
    ],
  };
  let j = Buffer.from(JSON.stringify(json));
  j = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 32)]);
  const out = Buffer.alloc(12 + 8 + j.length + 8 + bin.length);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(j.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  j.copy(out, 20);
  out.writeUInt32LE(bin.length, 20 + j.length);
  out.writeUInt32LE(0x004e4942, 24 + j.length);
  bin.copy(out, 28 + j.length);
  await writeFile(new URL(name + ".glb", root), out);
  manifest.push({
    name,
    world: [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, ...center, 1],
  });
}
await asset(
  "ground",
  [0.28, 0.28, 0.28],
  (v) => {
    for (const p of [
      [-20, -0.005, -20],
      [-20, -0.005, 20],
      [20, -0.005, 20],
      [-20, -0.005, -20],
      [20, -0.005, 20],
      [20, -0.005, -20],
    ])
      v.push(...p, 0, 1, 0, 0, 0);
  },
  0,
);
await asset("grid", [0.64, 0.67, 0.71], (v) => {
  for (let i = -20; i <= 20; i++) {
    if (i === 0) continue;
    const w = i % 5 === 0 ? 0.014 : 0.006;
    box(v, [-20, -0.004, i - w], [20, -0.002, i + w]);
    box(v, [i - w, -0.004, -20], [i + w, -0.002, 20]);
  }
});
for (const [axis, color] of [
  [0, [0.68, 0.08, 0.1]],
  [1, [0.08, 0.48, 0.2]],
  [2, [0.08, 0.25, 0.72]],
])
  await asset("axis-" + axis, color, (v) => {
    const lo = [-0.009, -0.009, -0.009],
      hi = [0.009, 0.009, 0.009];
    lo[axis] = axis === 1 ? -3 : -20;
    hi[axis] = axis === 1 ? 3 : 20;
    box(v, lo, hi);
  });
await writeFile(
  new URL("manifest.json", root),
  JSON.stringify(manifest, null, 2) + "\n",
);
const web = new URL("../../apps/web/public/viewport/", import.meta.url);
await mkdir(web, { recursive: true });
for (const file of ["manifest.json", ...manifest.map((x) => x.name + ".glb")])
  await copyFile(new URL(file, root), new URL(file, web));
