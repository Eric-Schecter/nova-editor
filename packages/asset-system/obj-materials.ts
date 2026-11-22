import { readGLB, writeGLB } from "./index";
import { resourcePath } from "./convert-gltf";
import {
  glbToMesh,
  normal,
  triangulateFace,
  type ObjCorner,
  type Triangle,
} from "./mesh-formats";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const limit = 128 * 1024 * 1024;
const maps = [
  ["map_Kd", "baseColorTexture"],
  ["map_Ke", "emissiveTexture"],
  ["norm", "normalTexture"],
  ["map_Bump", "normalTexture"],
  ["bump", "normalTexture"],
] as const;
function rows(bytes: Uint8Array) {
  return decoder
    .decode(bytes)
    .replace(/\\\r?\n/g, " ")
    .split(/\r?\n/)
    .map((line) => {
      const raw = line.trim();
      const clean = raw.startsWith("# nova_")
        ? raw.slice(2)
        : raw.split("#", 1)[0].trim();
      const match = /^(\S+)\s*(.*)$/.exec(clean);
      return [match?.[1] ?? "", match?.[2] ?? ""] as const;
    });
}
function numbers(value: string, count: number) {
  const out = value.trim().split(/\s+/).slice(0, count).map(Number);
  if (
    !value ||
    out.length !== count ||
    out.some((x) => !Number.isFinite(Math.fround(x)))
  )
    throw Error("无效的 OBJ / MTL 数值");
  return out;
}
const clamp = (n: number) => Math.min(1, Math.max(0, n));
function localPath(value: string, prefix = "") {
  return prefix + resourcePath(value.replace(/^"(.*)"$/, "$1"));
}

export function objToGLB(
  source: Uint8Array,
  load: (path: string) => Uint8Array,
) {
  const positions: number[][] = [],
    uvs: number[][] = [],
    normals: number[][] = [];
  const materials: any[] = [
    {
      name: "Default",
      pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.8 },
    },
  ];
  const names = new Map<string, number>(),
    textures: any[] = [],
    images: any[] = [],
    views: any[] = [],
    accessors: any[] = [];
  const imageIds = new Map<string, number>(),
    chunks: { offset: number; bytes: Uint8Array }[] = [];
  let length = 0;
  const append = (bytes: Uint8Array) => {
    const offset = Math.ceil(length / 4) * 4;
    length = offset + bytes.length;
    if (length > limit) throw Error("模型超过 128 MiB");
    chunks.push({ bytes, offset });
    return (
      views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length }) -
      1
    );
  };
  function texture(path: string) {
    const existing = imageIds.get(path);
    if (existing !== undefined) return { index: existing };
    const ext = path.split(".").pop()?.toLowerCase();
    const mime =
      ext === "png"
        ? "image/png"
        : ext === "jpg" || ext === "jpeg"
          ? "image/jpeg"
          : null;
    if (!mime) throw Error("OBJ 贴图需要 PNG 或 JPEG：" + path);
    const bytes = load(path);
    if (!bytes?.length) throw Error("缺少贴图：" + path);
    const bufferView = append(bytes);
    const index = textures.length;
    textures.push({ source: images.length });
    images.push({ bufferView, mimeType: mime });
    imageIds.set(path, index);
    return { index };
  }
  const obj = rows(source);
  for (const [tag, value] of obj)
    if (tag === "mtllib") {
      const path = localPath(value),
        prefix = path.slice(0, path.lastIndexOf("/") + 1);
      let m: any;
      for (const [key, v] of rows(load(path))) {
        if (key === "newmtl") {
          m = {
            name: v,
            pbrMetallicRoughness: {
              baseColorFactor: [1, 1, 1, 1],
              metallicFactor: 0,
              roughnessFactor: 0.8,
            },
          };
          names.set(v, materials.push(m) - 1);
          continue;
        }
        if (!m) continue;
        const p = m.pbrMetallicRoughness;
        if (key === "Kd")
          p.baseColorFactor.splice(0, 3, ...numbers(v, 3).map(clamp));
        if (key === "Ke") m.emissiveFactor = numbers(v, 3).map(clamp);
        if (key === "d" || key === "Tr") {
          const a = clamp(numbers(v, 1)[0]);
          p.baseColorFactor[3] = key === "Tr" ? 1 - a : a;
        }
        if (key === "Pm") p.metallicFactor = clamp(numbers(v, 1)[0]);
        if (key === "Pr") p.roughnessFactor = clamp(numbers(v, 1)[0]);
        if (key === "Ns")
          p.roughnessFactor = Math.sqrt(
            2 / (Math.max(0, numbers(v, 1)[0]) + 2),
          );
        if (key === "nova_map_orm")
          p.metallicRoughnessTexture = texture(localPath(v, prefix));
        if (key === "nova_map_ao")
          m.occlusionTexture = texture(localPath(v, prefix));
        if (key === "nova_alpha" && ["OPAQUE", "MASK", "BLEND"].includes(v))
          m.alphaMode = v;
        if (key === "nova_cutoff") m.alphaCutoff = clamp(numbers(v, 1)[0]);
        if (key === "nova_double_sided") m.doubleSided = v === "1";
        if (key === "nova_normal_scale" && m.normalTexture)
          m.normalTexture.scale = numbers(v, 1)[0];
        if (key === "nova_occlusion_strength" && m.occlusionTexture)
          m.occlusionTexture.strength = clamp(numbers(v, 1)[0]);
        const map = maps.find((entry) => entry[0] === key);
        if (map) {
          if (v.startsWith("-")) throw Error("暂不支持 MTL 贴图选项：" + v);
          const info = texture(localPath(v, prefix));
          if (map[1] === "baseColorTexture") p.baseColorTexture = info;
          else m[map[1]] = info;
        }
      }
    }
  for (const m of materials) {
    if (!m.alphaMode && (m.pbrMetallicRoughness.baseColorFactor?.[3] ?? 1) < 1)
      m.alphaMode = "BLEND";
    if (m.emissiveTexture && !m.emissiveFactor) m.emissiveFactor = [1, 1, 1];
  }
  const groups = new Map<number, ObjCorner[]>();
  let slot = 0,
    total = 0;
  const resolve = (index: string | undefined, list: number[][]) => {
    if (!index) return undefined;
    const value = Number(index),
      i = value < 0 ? list.length + value : value - 1;
    if (!Number.isSafeInteger(value) || !list[i]) throw Error("OBJ 面索引越界");
    return list[i];
  };
  for (const [tag, value] of obj) {
    if (tag === "v") positions.push(numbers(value, 3));
    if (tag === "vt") uvs.push(numbers(value, 2));
    if (tag === "vn") normals.push(numbers(value, 3));
    if (tag === "usemtl") {
      const id = names.get(value);
      if (id === undefined) throw Error("找不到 MTL 材质：" + value);
      slot = id;
    }
    if (tag !== "f") continue;
    const corners = new Map<number[], ObjCorner>();
    const polygon = value.split(/\s+/).map((token) => {
      const [p, t, n] = token.split("/");
      const position = resolve(p, positions)?.slice();
      if (!position) throw Error("OBJ 面缺少顶点");
      const uv = resolve(t, uvs);
      corners.set(position, {
        position,
        uv: uv && [uv[0], 1 - uv[1]],
        normal: resolve(n, normals),
      });
      return position;
    });
    if (polygon.length < 3) throw Error("OBJ 面至少需要三个顶点");
    let group = groups.get(slot);
    if (!group) {
      group = [];
      groups.set(slot, group);
    }
    triangulateFace(polygon, (triangle) => {
      if (++total > 1_000_000) throw Error("模型超过 100 万三角面");
      const fallback = normal(triangle);
      group!.push(
        ...triangle.map((p) => {
          const c = corners.get(p)!;
          return { ...c, normal: c.normal ?? fallback };
        }),
      );
    });
  }
  if (!total) throw Error("模型没有三角面");
  const primitives = [];
  for (const [material, corners] of groups) {
    const hasUV = corners.some((c) => c.uv);
    const mat = materials[material];
    if (
      (mat.pbrMetallicRoughness.baseColorTexture ||
        mat.normalTexture ||
        mat.emissiveTexture ||
        mat.occlusionTexture ||
        mat.pbrMetallicRoughness.metallicRoughnessTexture) &&
      corners.some((c) => !c.uv)
    )
      throw Error("贴图材质的面缺少 UV");
    const stride = hasUV ? 32 : 24;
    const bytes = new Uint8Array(corners.length * stride),
      data = new DataView(bytes.buffer);
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    corners.forEach((c, index) => {
      const at = index * stride;
      c.position.forEach((v, k) => {
        v = Math.fround(v);
        min[k] = Math.min(min[k], v);
        max[k] = Math.max(max[k], v);
        data.setFloat32(at + k * 4, v, true);
      });
      c.normal!.forEach((v, k) => data.setFloat32(at + 12 + k * 4, v, true));
      if (hasUV)
        (c.uv ?? [0, 0]).forEach((v, k) =>
          data.setFloat32(at + 24 + k * 4, v, true),
        );
    });
    const bufferView = append(bytes);
    Object.assign(views[bufferView], { byteStride: stride, target: 34962 });
    const a = (type: string, byteOffset: number) =>
      accessors.push({
        bufferView,
        byteOffset,
        componentType: 5126,
        count: corners.length,
        type,
      }) - 1;
    const position = a("VEC3", 0);
    Object.assign(accessors[position], { min, max });
    primitives.push({
      material,
      attributes: {
        POSITION: position,
        NORMAL: a("VEC3", 12),
        ...(hasUV ? { TEXCOORD_0: a("VEC2", 24) } : {}),
      },
    });
  }
  const bin = new Uint8Array(length);
  for (const c of chunks) bin.set(c.bytes, c.offset);
  return writeGLB({
    bin,
    extra: [],
    json: {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives }],
      materials,
      ...(images.length ? { images, textures } : {}),
      bufferViews: views,
      accessors,
      buffers: [{ byteLength: length }],
    },
  });
}
export function glbToOBJ(source: Uint8Array) {
  const { json, bin } = readGLB(source);
  const files: Record<string, Uint8Array> = {},
    obj = ["mtllib model.mtl"],
    mtl: string[] = [];
  const names = new Map<number | undefined, string>(),
    imageNames = new Map<number, string>();
  let vertex = 0,
    uv = 0,
    n = 0,
    active = "";
  function image(info: any) {
    if ((info.texCoord ?? 0) !== 0 || info.extensions?.KHR_texture_transform)
      throw Error("OBJ 导出需要未变换的 TEXCOORD_0");
    const index = json.textures?.[info.index]?.source;
    const existing = imageNames.get(index);
    if (existing) return existing;
    const img = json.images?.[index],
      view = json.bufferViews?.[img?.bufferView];
    const extension =
      img?.mimeType === "image/png"
        ? "png"
        : img?.mimeType === "image/jpeg"
          ? "jpg"
          : null;
    const start = view?.byteOffset ?? 0;
    if (
      !extension ||
      !view ||
      view.buffer !== 0 ||
      !Number.isSafeInteger(start) ||
      start < 0 ||
      !Number.isSafeInteger(view.byteLength) ||
      view.byteLength <= 0 ||
      start + view.byteLength > bin.length
    )
      throw Error("OBJ 导出仅支持内嵌 PNG 或 JPEG");
    const name = `texture-${imageNames.size + 1}.${extension}`;
    files[name] = bin.slice(start, start + view.byteLength);
    imageNames.set(index, name);
    return name;
  }
  glbToMesh(source, "obj", (corners, slot) => {
    let name = names.get(slot);
    if (!name) {
      name = `material_${names.size + 1}`;
      names.set(slot, name);
      const m = json.materials?.[slot ?? -1] ?? {},
        p = m.pbrMetallicRoughness ?? {},
        color = p.baseColorFactor ?? [1, 1, 1, 1];
      mtl.push(
        `newmtl ${name}`,
        `Kd ${color.slice(0, 3).join(" ")}`,
        `d ${color[3]}`,
        `Pm ${p.metallicFactor ?? 1}`,
        `Pr ${p.roughnessFactor ?? 1}`,
      );
      if (m.emissiveFactor) mtl.push(`Ke ${m.emissiveFactor.join(" ")}`);
      if (p.baseColorTexture) mtl.push(`map_Kd ${image(p.baseColorTexture)}`);
      if (m.emissiveTexture) mtl.push(`map_Ke ${image(m.emissiveTexture)}`);
      if (m.normalTexture)
        mtl.push(
          `norm ${image(m.normalTexture)}`,
          `# nova_normal_scale ${m.normalTexture.scale ?? 1}`,
        );
      if (p.metallicRoughnessTexture)
        mtl.push(`# nova_map_orm ${image(p.metallicRoughnessTexture)}`);
      if (m.occlusionTexture)
        mtl.push(
          `# nova_map_ao ${image(m.occlusionTexture)}`,
          `# nova_occlusion_strength ${m.occlusionTexture.strength ?? 1}`,
        );
      if (m.alphaMode) mtl.push(`# nova_alpha ${m.alphaMode}`);
      if (m.alphaCutoff !== undefined)
        mtl.push(`# nova_cutoff ${m.alphaCutoff}`);
      if (m.doubleSided) mtl.push("# nova_double_sided 1");
      mtl.push("");
    }
    if (name !== active) {
      obj.push(`usemtl ${name}`);
      active = name;
    }
    const face = corners.map((c) => {
      obj.push(`v ${c.position.join(" ")}`);
      const t = c.uv ? ++uv : "";
      if (c.uv) obj.push(`vt ${c.uv[0]} ${1 - c.uv[1]}`);
      obj.push(`vn ${c.normal!.join(" ")}`);
      return `${++vertex}/${t}/${++n}`;
    });
    obj.push("f " + face.join(" "));
  });
  files["model.obj"] = encoder.encode(obj.join("\n") + "\n");
  files["model.mtl"] = encoder.encode(mtl.join("\n"));
  return files;
}
