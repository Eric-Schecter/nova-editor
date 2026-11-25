export type PrimitiveType =
  | "box"
  | "plane"
  | "sphere"
  | "cylinder"
  | "cone"
  | "torus";
export type Geometry = {
  type: PrimitiveType;
  parameters: Record<string, number>;
};
export type Parameter = {
  key: string;
  label: string;
  value: number;
  min: number;
  max: number;
  integer?: boolean;
};
const size = (key: string, label: string, value = 1): Parameter => ({
  key,
  label,
  value,
  min: 0.001,
  max: 1000,
});
const segments = (
  key: string,
  label: string,
  value: number,
  min = 1,
  max = 64,
): Parameter => ({ key, label, value, min, max, integer: true });
export const primitives: Record<
  PrimitiveType,
  { name: string; parameters: Parameter[] }
> = {
  box: {
    name: "立方体",
    parameters: [
      size("width", "宽度"),
      size("height", "高度"),
      size("depth", "深度"),
      segments("widthSegments", "宽分段", 1),
      segments("heightSegments", "高分段", 1),
      segments("depthSegments", "深分段", 1),
    ],
  },
  plane: {
    name: "平面",
    parameters: [
      size("width", "宽度", 2),
      size("depth", "深度", 2),
      segments("widthSegments", "宽分段", 1),
      segments("depthSegments", "深分段", 1),
    ],
  },
  sphere: {
    name: "球体",
    parameters: [
      size("radius", "半径"),
      segments("widthSegments", "水平分段", 32, 8, 128),
      segments("heightSegments", "垂直分段", 16, 4),
    ],
  },
  cylinder: {
    name: "圆柱",
    parameters: [
      size("radius", "底半径"),
      { ...size("radiusTop", "顶半径"), min: 0 },
      size("height", "高度", 2),
      segments("radialSegments", "圆周分段", 32, 3, 128),
      segments("heightSegments", "高度分段", 1),
    ],
  },
  cone: {
    name: "圆锥",
    parameters: [
      size("radius", "半径"),
      size("height", "高度", 2),
      segments("radialSegments", "圆周分段", 32, 3, 128),
      segments("heightSegments", "高度分段", 1),
    ],
  },
  torus: {
    name: "圆环",
    parameters: [
      size("radius", "主半径"),
      size("tube", "管半径", 0.25),
      segments("radialSegments", "管分段", 12, 3),
      segments("tubularSegments", "环分段", 32, 3, 128),
    ],
  },
};
export function defaultGeometry(type: PrimitiveType): Geometry {
  return {
    type,
    parameters: Object.fromEntries(
      primitives[type].parameters.map((p) => [p.key, p.value]),
    ),
  };
}
export function validateGeometry(value: unknown): Geometry {
  const g = value as Geometry;
  if (
    !g ||
    !Object.hasOwn(primitives, g.type) ||
    !g.parameters ||
    typeof g.parameters !== "object" ||
    Array.isArray(g.parameters)
  )
    throw Error("无效几何体类型");
  const specs = primitives[g.type].parameters;
  if (Object.keys(g.parameters).length !== specs.length)
    throw Error("几何体参数不完整");
  for (const p of specs) {
    const v = g.parameters[p.key];
    if (
      !Number.isFinite(v) ||
      v < p.min ||
      v > p.max ||
      (p.integer && !Number.isInteger(v))
    )
      throw Error(`${p.label}范围 ${p.min}–${p.max}`);
  }
  if (g.type === "torus" && g.parameters.tube >= g.parameters.radius)
    throw Error("管半径必须小于主半径");
  return structuredClone(g);
}
export type GLB = {
  json: any;
  bin: Uint8Array;
  extra: { type: number; data: Uint8Array }[];
};
const JSON_CHUNK = 0x4e4f534a,
  BIN_CHUNK = 0x004e4942,
  MAX = 128 * 1024 * 1024;
export function readGLB(bytes: Uint8Array): GLB {
  if (bytes.byteLength < 20 || bytes.byteLength > MAX)
    throw Error("GLB 大小无效");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    v.getUint32(0, true) !== 0x46546c67 ||
    v.getUint32(4, true) !== 2 ||
    v.getUint32(8, true) !== bytes.length
  )
    throw Error("无效 GLB 头");
  let json: any,
    bin = new Uint8Array(),
    offset = 12;
  const extra: GLB["extra"] = [];
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw Error("GLB 分块损坏");
    const length = v.getUint32(offset, true),
      type = v.getUint32(offset + 4, true);
    offset += 8;
    if (length % 4 || offset + length > bytes.length)
      throw Error("GLB 分块越界");
    const data = bytes.slice(offset, offset + length);
    if (type === JSON_CHUNK) {
      if (json !== undefined || offset !== 20) throw Error("GLB JSON 顺序错误");
      json = JSON.parse(new TextDecoder().decode(data));
    } else if (type === BIN_CHUNK) {
      if (bin.length) throw Error("重复 BIN");
      bin = data;
    } else extra.push({ type, data });
    offset += length;
  }
  if (
    !json ||
    json.asset?.version !== "2.0" ||
    json.buffers?.some((b: any) => b.uri) ||
    json.buffers?.length > 1
  )
    throw Error("需要自包含 GLB 2.0");
  if (json.buffers?.[0]?.byteLength > bin.length) throw Error("GLB BIN 缺失");
  return { json, bin, extra };
}
export function writeGLB(doc: GLB): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(doc.json)),
    chunks = [
      { type: JSON_CHUNK, data: text },
      ...(doc.bin.length ? [{ type: BIN_CHUNK, data: doc.bin }] : []),
      ...doc.extra,
    ];
  const length =
    12 + chunks.reduce((s, c) => s + 8 + Math.ceil(c.data.length / 4) * 4, 0);
  if (length > MAX) throw Error("GLB 超过 128 MiB");
  const out = new Uint8Array(length),
    view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, length, true);
  let offset = 12;
  for (const c of chunks) {
    const size = Math.ceil(c.data.length / 4) * 4;
    view.setUint32(offset, size, true);
    view.setUint32(offset + 4, c.type, true);
    if (c.type === JSON_CHUNK) out.fill(32, offset + 8, offset + 8 + size);
    out.set(c.data, offset + 8);
    offset += 8 + size;
  }
  return out;
}
const dot = (a: number[], b: number[]) =>
    a.reduce((s, v, i) => s + v * b[i], 0),
  sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
const cross = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
type Vertex = { p: number[]; n: number[]; uv: number[] };
export function geometryVertices(input: Geometry): number[] {
  const { type, parameters: p } = validateGeometry(input),
    out: number[] = [];
  const vertex = (
    position: number[],
    normal: number[],
    uv: number[],
  ): Vertex => ({ p: position, n: normal, uv });
  const tri = (a: Vertex, b: Vertex, c: Vertex) => {
    const normal = cross(sub(b.p, a.p), sub(c.p, a.p));
    if (dot(normal, normal) < 1e-24) return;
    if (
      dot(
        normal,
        a.n.map((v, i) => v + b.n[i] + c.n[i]),
      ) < 0
    )
      [b, c] = [c, b];
    for (const v of [a, b, c]) out.push(...v.p, ...v.n, ...v.uv);
  };
  const grid = (
    nx: number,
    ny: number,
    at: (u: number, v: number) => Vertex,
  ) => {
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const a = at(x / nx, y / ny),
          b = at((x + 1) / nx, y / ny),
          c = at((x + 1) / nx, (y + 1) / ny),
          d = at(x / nx, (y + 1) / ny);
        tri(a, b, c);
        tri(a, c, d);
      }
  };
  if (type === "box") {
    const dims = [p.width, p.height, p.depth],
      segments = [p.widthSegments, p.heightSegments, p.depthSegments];
    for (let axis = 0; axis < 3; axis++)
      for (const sign of [-1, 1]) {
        const u = (axis + 1) % 3,
          v = (axis + 2) % 3;
        grid(segments[u], segments[v], (a, b) => {
          const pos = [0, 0, 0],
            n = [0, 0, 0];
          pos[axis] = (sign * dims[axis]) / 2;
          pos[u] = (a - 0.5) * dims[u];
          pos[v] = (b - 0.5) * dims[v];
          n[axis] = sign;
          return vertex(pos, n, [a, b]);
        });
      }
  } else if (type === "plane")
    grid(p.widthSegments, p.depthSegments, (u, v) =>
      vertex([(u - 0.5) * p.width, 0, (v - 0.5) * p.depth], [0, 1, 0], [u, v]),
    );
  else if (type === "sphere")
    grid(p.widthSegments, p.heightSegments, (u, v) => {
      const a = u * Math.PI * 2,
        b = v * Math.PI,
        n = [Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)];
      return vertex(
        n.map((v) => v * p.radius),
        n,
        [u, 1 - v],
      );
    });
  else if (type === "torus")
    grid(p.tubularSegments, p.radialSegments, (u, v) => {
      const a = u * 2 * Math.PI,
        b = v * 2 * Math.PI,
        c = Math.cos(b),
        s = Math.sin(b);
      return vertex(
        [
          (p.radius + p.tube * c) * Math.cos(a),
          p.tube * s,
          (p.radius + p.tube * c) * Math.sin(a),
        ],
        [c * Math.cos(a), s, c * Math.sin(a)],
        [u, v],
      );
    });
  else {
    const top = type === "cone" ? 0 : p.radiusTop,
      slope = (p.radius - top) / p.height,
      length = Math.hypot(1, slope);
    grid(p.radialSegments, p.heightSegments, (u, v) => {
      const a = u * 2 * Math.PI,
        r = p.radius + (top - p.radius) * v;
      return vertex(
        [r * Math.cos(a), (v - 0.5) * p.height, r * Math.sin(a)],
        [Math.cos(a) / length, slope / length, Math.sin(a) / length],
        [u, v],
      );
    });
    for (const [radius, sign] of [
      [p.radius, -1],
      [top, 1],
    ])
      if (radius > 0)
        for (let x = 0; x < p.radialSegments; x++) {
          const at = (u: number) => {
            const a = u * 2 * Math.PI;
            return vertex(
              [
                radius * Math.cos(a),
                (sign * p.height) / 2,
                radius * Math.sin(a),
              ],
              [0, sign, 0],
              [0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)],
            );
          };
          tri(
            vertex([0, (sign * p.height) / 2, 0], [0, sign, 0], [0.5, 0.5]),
            at(x / p.radialSegments),
            at((x + 1) / p.radialSegments),
          );
        }
  }
  return out;
}
export function makePrimitive(geometry: Geometry): Uint8Array {
  const g = validateGeometry(geometry),
    data = geometryVertices(g),
    count = data.length / 8,
    bin = new Uint8Array(data.length * 4),
    view = new DataView(bin.buffer);
  data.forEach((v, i) => view.setFloat32(i * 4, v, true));
  const minimum = [Infinity, Infinity, Infinity],
    maximum = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < data.length; i += 8)
    for (let k = 0; k < 3; k++) {
      minimum[k] = Math.min(minimum[k], Math.fround(data[i + k]));
      maximum[k] = Math.max(maximum[k], Math.fround(data[i + k]));
    }
  const json = {
    asset: { version: "2.0", generator: "Nova Editor primitives" },
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
        name: "Material",
        pbrMetallicRoughness: {
          baseColorFactor: [0.5, 0.5, 0.5, 1],
          metallicFactor: 0,
          roughnessFactor: 0.7,
        },
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
        count,
        type: "VEC3",
        min: minimum,
        max: maximum,
      },
      {
        bufferView: 0,
        byteOffset: 12,
        componentType: 5126,
        count,
        type: "VEC3",
      },
      {
        bufferView: 0,
        byteOffset: 24,
        componentType: 5126,
        count,
        type: "VEC2",
      },
    ],
    extras: { novaEditor: { version: 1, geometry: g } },
  };
  return writeGLB({ json, bin, extra: [] });
}
export type Material = {
  name: string;
  color: number[];
  opacity: number;
  alphaMode: "OPAQUE" | "MASK" | "BLEND";
  alphaCutoff: number;
  doubleSided: boolean;
  metallic: number;
  roughness: number;
  emissive: number[];
  normalScale: number;
  occlusion: number;
};
export const textureSlots = [
  { key: "baseColor", label: "基础色贴图" },
  { key: "normal", label: "法线贴图" },
  { key: "metallicRoughness", label: "金属度 / 粗糙度贴图" },
  { key: "occlusion", label: "遮蔽贴图" },
  { key: "emissive", label: "自发光贴图" },
  { key: "clearcoat", label: "清漆贴图", extension: "KHR_materials_clearcoat" },
  { key: "clearcoatRoughness", label: "清漆粗糙度贴图", extension: "KHR_materials_clearcoat" },
  { key: "clearcoatNormal", label: "清漆法线贴图", extension: "KHR_materials_clearcoat" },
  { key: "specular", label: "镜面反射贴图", extension: "KHR_materials_specular" },
  { key: "specularColor", label: "镜面反射颜色贴图", extension: "KHR_materials_specular" },
  { key: "sheenColor", label: "织物光泽颜色贴图", extension: "KHR_materials_sheen" },
  { key: "sheenRoughness", label: "织物光泽粗糙度贴图", extension: "KHR_materials_sheen" },
  { key: "iridescence", label: "虹彩贴图", extension: "KHR_materials_iridescence" },
  { key: "iridescenceThickness", label: "虹彩厚度贴图", extension: "KHR_materials_iridescence" },
  { key: "anisotropy", label: "各向异性贴图", extension: "KHR_materials_anisotropy" },
  { key: "transmission", label: "透射贴图", extension: "KHR_materials_transmission" },
  { key: "thickness", label: "体积厚度贴图", extension: "KHR_materials_volume" },
] as const;
export type TextureSlot = (typeof textureSlots)[number]["key"];
function materials(doc: GLB): any[] {
  const ids = new Set<number>();
  for (const mesh of doc.json.meshes ?? [])
    for (const p of mesh.primitives ?? [])
      if (p.material !== undefined) ids.add(p.material);
  if (!ids.size) throw Error("模型没有材质");
  return [...ids].map((id) => {
    const m = doc.json.materials?.[id];
    if (!m || typeof m !== "object") throw Error("缺少材质");
    return m;
  });
}
export function materialData(doc: GLB): Material {
  const m = materials(doc)[0],
    p = m.pbrMetallicRoughness ?? {};
  return {
    name: m.name ?? "Material",
    color: (p.baseColorFactor ?? [1, 1, 1, 1]).slice(0, 3),
    opacity: p.baseColorFactor?.[3] ?? 1,
    alphaMode: m.alphaMode ?? "OPAQUE",
    alphaCutoff: m.alphaCutoff ?? 0.5,
    doubleSided: m.doubleSided ?? false,
    metallic: p.metallicFactor ?? 1,
    roughness: p.roughnessFactor ?? 1,
    emissive: m.emissiveFactor ?? [0, 0, 0],
    normalScale: m.normalTexture?.scale ?? 1,
    occlusion: m.occlusionTexture?.strength ?? 1,
  };
}
export function applyMaterial(doc: GLB, value: Material): GLB {
  if (
    typeof value.name !== "string" ||
    !["OPAQUE", "MASK", "BLEND"].includes(value.alphaMode) ||
    typeof value.doubleSided !== "boolean" ||
    ![
      value.opacity,
      value.alphaCutoff,
      value.metallic,
      value.roughness,
      value.occlusion,
      ...value.color,
      ...value.emissive,
    ].every((v) => Number.isFinite(v) && v >= 0 && v <= 1) ||
    value.color.length !== 3 ||
    value.emissive.length !== 3 ||
    !Number.isFinite(value.normalScale) ||
    value.normalScale < 0 ||
    value.normalScale > 4
  )
    throw Error("无效材质参数");
  const next = structuredClone(doc);
  for (const m of materials(next)) {
    m.name = value.name;
    m.pbrMetallicRoughness ??= {};
    m.pbrMetallicRoughness.baseColorFactor = [...value.color, value.opacity];
    m.alphaMode = value.alphaMode;
    m.alphaCutoff = value.alphaCutoff;
    m.doubleSided = value.doubleSided;
    m.pbrMetallicRoughness.metallicFactor = value.metallic;
    m.pbrMetallicRoughness.roughnessFactor = value.roughness;
    m.emissiveFactor = [...value.emissive];
    if (m.normalTexture) m.normalTexture.scale = value.normalScale;
    if (m.occlusionTexture) m.occlusionTexture.strength = value.occlusion;
  }
  return next;
}
function textureParent(m: any, slot: TextureSlot): [any, string] {
  const definition = textureSlots.find((item) => item.key === slot);
  const parent = definition && "extension" in definition
    ? m.extensions?.[definition.extension]
    : slot === "baseColor" || slot === "metallicRoughness"
      ? m.pbrMetallicRoughness : m;
  return [parent, slot + "Texture"];
}
export function hasTexture(doc: GLB, slot: TextureSlot) {
  const [p, k] = textureParent(materials(doc)[0], slot);
  return !!p?.[k];
}
export function materialUsesExtension(doc: GLB, extension: string) {
  return materials(doc).some((material) => Object.hasOwn(material.extensions ?? {}, extension));
}
export function materialTextureImage(doc: GLB, slot: TextureSlot) {
  const [parent, key] = textureParent(materials(doc)[0], slot);
  const texture = doc.json.textures?.[parent?.[key]?.index];
  const image = doc.json.images?.[texture?.extensions?.EXT_texture_webp?.source ??
    texture?.source ?? texture?.extensions?.KHR_texture_basisu?.source];
  const view = doc.json.bufferViews?.[image?.bufferView];
  if (typeof image?.uri === "string" && !view) {
    const embedded = /^data:(image\/(?:png|jpeg|webp));base64,([\s\S]+)$/.exec(image.uri);
    if (embedded) return {
      bytes: Uint8Array.from(atob(embedded[2]), (character) => character.charCodeAt(0)),
      mimeType: embedded[1],
    };
  }
  if (!view || (view.buffer ?? 0) !== 0 || !image.mimeType) return null;
  const offset = view.byteOffset ?? 0;
  return { bytes: doc.bin.slice(offset, offset + view.byteLength), mimeType: image.mimeType };
}
export function imageType(bytes: Uint8Array): string {
  if (bytes.length < 4 || bytes.length > 16 * 1024 * 1024)
    throw Error("贴图需小于 16 MiB");
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71)
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  throw Error("只支持 PNG / JPEG");
}
function appendBin(doc: GLB, data: Uint8Array) {
  const offset = Math.ceil(doc.bin.length / 4) * 4,
    bin = new Uint8Array(offset + data.length);
  bin.set(doc.bin);
  bin.set(data, offset);
  if (bin.length > MAX) throw Error("GLB 超过 128 MiB");
  doc.bin = bin;
  doc.json.buffers = [{ byteLength: bin.length }];
  return offset;
}
export function applyTexture(
  doc: GLB,
  slot: TextureSlot,
  bytes: Uint8Array | null,
): GLB {
  const next = structuredClone(doc);
  let index: number | undefined;
  if (bytes) {
    for (const mesh of next.json.meshes ?? [])
      for (const primitive of mesh.primitives ?? []) {
        const material = next.json.materials?.[primitive.material];
        if (!material) continue;
        const [parent, key] = textureParent(material, slot);
        if (!parent && slot !== "baseColor" && slot !== "metallicRoughness") continue;
        const info = parent?.[key];
        const uv = info?.extensions?.KHR_texture_transform?.texCoord ?? info?.texCoord ?? 0;
        if (primitive.attributes?.[`TEXCOORD_${uv}`] === undefined)
          throw Error(`模型缺少 TEXCOORD_${uv}，无法添加贴图`);
      }
    const mimeType = imageType(bytes),
      offset = appendBin(next, bytes);
    next.json.bufferViews ??= [];
    const view =
      next.json.bufferViews.push({
        buffer: 0,
        byteOffset: offset,
        byteLength: bytes.length,
      }) - 1;
    next.json.images ??= [];
    const image = next.json.images.push({ bufferView: view, mimeType }) - 1;
    next.json.textures ??= [];
    index = next.json.textures.push({ source: image }) - 1;
  }
  for (const m of materials(next)) {
    if (index !== undefined && (slot === "baseColor" || slot === "metallicRoughness"))
      m.pbrMetallicRoughness ??= {};
    const [p, k] = textureParent(m, slot);
    if (!p) continue;
    if (index === undefined) delete p[k];
    else {
      const sampler = next.json.textures[p[k]?.index]?.sampler;
      const textureIndex = sampler === undefined ? index :
        next.json.textures.push({ ...next.json.textures[index], sampler }) - 1;
      p[k] = { ...p[k], index: textureIndex };
    }
  }
  return next;
}
export function geometryData(doc: GLB): Geometry | null {
  const meta = doc.json.extras?.novaEditor;
  if (meta?.version !== 1 || !meta.geometry) return null;
  return validateGeometry(meta.geometry);
}
export function regenerateGeometry(doc: GLB, g: Geometry): GLB {
  if (!geometryData(doc)) throw Error("导入模型的网格参数不可编辑");
  const next = readGLB(makePrimitive(g));
  next.json.materials = structuredClone(doc.json.materials);
  next.json.textures = structuredClone(doc.json.textures ?? []);
  next.json.samplers = structuredClone(doc.json.samplers ?? []);
  next.json.images = [];
  for (const image of doc.json.images ?? []) {
    if (image.bufferView === undefined) throw Error("需要内嵌贴图");
    const view = doc.json.bufferViews?.[image.bufferView],
      offset = view?.byteOffset ?? 0;
    if (!view || offset + view.byteLength > doc.bin.length)
      throw Error("贴图数据损坏");
    const at = appendBin(next, doc.bin.slice(offset, offset + view.byteLength));
    const id =
      next.json.bufferViews.push({
        buffer: 0,
        byteOffset: at,
        byteLength: view.byteLength,
      }) - 1;
    next.json.images.push({ ...image, bufferView: id });
  }
  return next;
}
export function groundOffset(g: Geometry) {
  const p = g.parameters;
  return g.type === "plane"
    ? 0
    : g.type === "sphere"
      ? p.radius
      : g.type === "torus"
        ? p.tube
        : p.height / 2;
}
export function colorHex(color: number[]) {
  return (
    "#" +
    color
      .map((v) => {
        const c = Math.max(0, Math.min(1, v));
        return Math.round(
          (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255,
        )
          .toString(16)
          .padStart(2, "0");
      })
      .join("")
  );
}
