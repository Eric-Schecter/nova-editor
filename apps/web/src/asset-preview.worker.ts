import { readGLB } from "../../../packages/asset-system/index";
import { localMatrix, multiply } from "../../../packages/scene-schema/transforms";
import { identity } from "../../../packages/scene-schema/index";

const width = 104, height = 64;
type Vertex = { x: number; y: number; z: number; u: number; v: number };
type Material = { color: number[]; metal: number; rough: number; emission: number[]; cutoff: number; texture?: ImageData };
type Mesh = { vertices: Vertex[]; indices: number[]; material: Material };
const encode = (v: number) => Math.round(255 * Math.sqrt(Math.max(0, Math.min(1, v))));

async function render(bytes: Uint8Array) {
  const { json, bin } = readGLB(bytes);
  const data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d")!;
  const output = context.createImageData(width, height);
  const textures = new Map<number, Promise<ImageData | undefined>>();
  async function texture(index: number): Promise<ImageData | undefined> {
    try {
      const image = json.images[json.textures[index].source];
      const view = json.bufferViews[image.bufferView];
      const start = view.byteOffset ?? 0;
      const bitmap = await createImageBitmap(new Blob([bin.slice(start, start + view.byteLength)], { type: image.mimeType }),
        { colorSpaceConversion: "none", premultiplyAlpha: "none" });
      try {
        const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
        const target = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
        const ctx = target.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0, target.width, target.height);
        return ctx.getImageData(0, 0, target.width, target.height);
      } finally { bitmap.close(); }
    } catch { return undefined; }
  }
  const materials: Material[] = await Promise.all((json.materials ?? []).map(async (m: any) => {
    const pbr = m.pbrMetallicRoughness ?? {};
    const index = pbr.baseColorTexture?.index;
    if (index !== undefined && !textures.has(index)) textures.set(index, texture(index));
    return {
      color: pbr.baseColorFactor ?? [1, 1, 1, 1], metal: pbr.metallicFactor ?? 1,
      rough: pbr.roughnessFactor ?? 1, emission: m.emissiveFactor ?? [0, 0, 0],
      cutoff: m.alphaMode === "MASK" ? (m.alphaCutoff ?? .5) : m.alphaMode === "BLEND" ? .12 : 0,
      texture: index === undefined ? undefined : await textures.get(index),
    };
  }));
  function accessor(index: number, components: number) {
    const a = json.accessors[index], view = json.bufferViews[a.bufferView];
    const size = ({ 5121: 1, 5123: 2, 5125: 4, 5126: 4 } as Record<number, number>)[a.componentType];
    const stride = view.byteStride ?? size * components;
    const offset = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    if (!size || a.sparse || a.count < 1 || !Number.isSafeInteger(a.count) || view.buffer !== 0 ||
        stride < size * components || offset < 0 || offset + (a.count - 1) * stride + size * components > bin.length)
      throw Error("Invalid preview accessor");
    return { count: a.count as number, get(i: number, c = 0) {
      if (i >= a.count) throw Error("Invalid preview index");
      const address = offset + i * stride + c * size;
      if (a.componentType === 5126) return data.getFloat32(address, true);
      const n = size === 1 ? data.getUint8(address) : size === 2 ? data.getUint16(address, true) : data.getUint32(address, true);
      return a.normalized ? n / (size === 1 ? 255 : 65535) : n;
    }};
  }
  const meshes: Mesh[] = [], active = new Set<number>();
  const low = [Infinity, Infinity], high = [-Infinity, -Infinity];
  let remaining = 1_200_000;
  function visit(index: number, parent: number[]) {
    if (active.has(index) || remaining <= 0 || active.size >= 128) return;
    active.add(index);
    const node = json.nodes[index];
    const world = multiply(parent, node.matrix ?? localMatrix({
      position: node.translation ?? [0, 0, 0], rotation: node.rotation ?? [0, 0, 0, 1], scale: node.scale ?? [1, 1, 1],
    }));
    for (const p of json.meshes?.[node.mesh]?.primitives ?? []) {
      if ((p.mode ?? 4) !== 4 || remaining <= 0) continue;
      const position = accessor(p.attributes.POSITION, 3);
      const indices = p.indices === undefined ? undefined : accessor(p.indices, 1);
      const count = indices?.count ?? position.count;
      if (count > remaining || position.count > remaining) continue;
      remaining -= count;
      const material = materials[p.material] ?? { color: [.75, .75, .75, 1], metal: 0, rough: .6, emission: [0, 0, 0], cutoff: 0 };
      const uvIndex = json.materials?.[p.material]?.pbrMetallicRoughness?.baseColorTexture?.texCoord ?? 0;
      const uv = material.texture && p.attributes[`TEXCOORD_${uvIndex}`] !== undefined
        ? accessor(p.attributes[`TEXCOORD_${uvIndex}`], 2) : undefined;
      const vertices = Array.from({ length: position.count }, (_, i): Vertex => {
        const a = position.get(i, 0), b = position.get(i, 1), c = position.get(i, 2);
        const x = a * world[0] + b * world[4] + c * world[8] + world[12];
        const y = a * world[1] + b * world[5] + c * world[9] + world[13];
        const z = a * world[2] + b * world[6] + c * world[10] + world[14];
        const point = { x: .866 * x - .5 * z, y: .22 * x - .898 * y + .381 * z,
          z: .449 * x + .44 * y + .778 * z, u: uv?.get(i, 0) ?? 0, v: uv?.get(i, 1) ?? 0 };
        if (![point.x, point.y, point.z].every(Number.isFinite)) throw Error("Invalid preview geometry");
        low[0] = Math.min(low[0], point.x); high[0] = Math.max(high[0], point.x);
        low[1] = Math.min(low[1], point.y); high[1] = Math.max(high[1], point.y);
        return point;
      });
      meshes.push({ vertices, indices: Array.from({ length: count }, (_, i) => indices?.get(i) ?? i), material });
    }
    for (const child of node.children ?? []) visit(child, world);
    active.delete(index);
  }
  for (const root of json.scenes?.[json.scene ?? 0]?.nodes ?? []) visit(root, localMatrix(identity()));
  if (!meshes.length) throw Error("Empty preview");
  const scale = Math.min((width - 14) / Math.max(1e-9, high[0] - low[0]), (height - 14) / Math.max(1e-9, high[1] - low[1]));
  const depth = new Float64Array(width * height).fill(-Infinity);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const shade = Math.round(33 + 21 * Math.max(0, 1 - Math.hypot((x - width / 2) / width, (y - height / 2) / height) * 1.8));
    output.data.set([shade, shade + 1, shade + 3, 255], (y * width + x) * 4);
  }
  for (const { vertices, indices, material } of meshes) {
    for (const p of vertices) {
      p.x = width / 2 + (p.x - (low[0] + high[0]) / 2) * scale;
      p.y = height / 2 + (p.y - (low[1] + high[1]) / 2) * scale;
      p.z *= scale;
    }
    const { color, metal, rough, emission, cutoff, texture } = material;
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const a = vertices[indices[i]], b = vertices[indices[i + 1]], c = vertices[indices[i + 2]];
      if (!a || !b || !c) continue;
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const ex = c.x - a.x, ey = c.y - a.y, ez = c.z - a.z;
      const area = dx * ey - dy * ex;
      if (Math.abs(area) < 1e-7) continue;
      const nx = dy * ez - dz * ey, ny = dz * ex - dx * ez;
      const sign = Math.sign(area) / Math.hypot(nx, ny, area);
      const key = Math.max(0, (-.42 * nx - .49 * ny + .76 * area) * sign);
      const rim = Math.max(0, (.7 * nx + .28 * ny + .66 * area) * sign);
      const light = .24 + .65 * key + .23 * rim;
      const gloss = (.06 + metal * .15) * key ** (5 + 22 * (1 - rough));
      for (let y = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y))); y < Math.min(height, Math.ceil(Math.max(a.y, b.y, c.y))); y++) {
        for (let x = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x))); x < Math.min(width, Math.ceil(Math.max(a.x, b.x, c.x))); x++) {
          const u = ((x + .5 - a.x) * ey - (y + .5 - a.y) * ex) / area;
          const v = (dx * (y + .5 - a.y) - dy * (x + .5 - a.x)) / area;
          const w = 1 - u - v;
          if (u < 0 || v < 0 || w < 0) continue;
          const z = w * a.z + u * b.z + v * c.z, pixel = y * width + x;
          if (z <= depth[pixel]) continue;
          let sample = 0;
          if (texture) {
            const s = w * a.u + u * b.u + v * c.u, t = w * a.v + u * b.v + v * c.v;
            sample = (Math.floor((t - Math.floor(t)) * texture.height) * texture.width + Math.floor((s - Math.floor(s)) * texture.width)) * 4;
          }
          if (cutoff && color[3] * (texture ? texture.data[sample + 3] / 255 : 1) < cutoff) continue;
          depth[pixel] = z;
          for (let k = 0; k < 3; k++) {
            const texel = texture ? texture.data[sample + k] / 255 : 1;
            output.data[pixel * 4 + k] = encode(color[k] * texel * texel * light + gloss + emission[k]);
          }
        }
      }
    }
  }
  context.putImageData(output, 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}

self.onmessage = async ({ data }: MessageEvent<{ bytes: Uint8Array }>) => {
  try {
    self.postMessage(await render(data.bytes));
  } catch {
    self.postMessage(null);
  }
};
