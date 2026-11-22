import { readGLB, writeGLB, type GLB } from "./index";
import {
  identity,
  type Scene,
  type SceneNode,
  type Transform,
} from "../scene-schema/index";
import { localMatrix, multiply } from "../scene-schema/transforms";
import { decomposeTRS, assertEditable } from "../editor-core/src/hierarchy";
// Package only this primitive and the images its material actually uses.
function compactPart(doc: GLB): GLB {
  const j = doc.json,
    p = j.meshes[0].primitives[0],
    views = new Map<number, number>(),
    accessors = new Map<number, number>(),
    images = new Map<number, number>(),
    textures = new Map<number, number>();
  const sourceBin = doc.bin,
    sourceViews = j.bufferViews ?? [],
    sourceAccessors = j.accessors ?? [],
    sourceImages = j.images ?? [],
    sourceTextures = j.textures ?? [];
  let length = 0;
  const chunks: Uint8Array[] = [];
  j.bufferViews = [];
  j.accessors = [];
  j.images = [];
  j.textures = [];
  const view = (id: number) => {
    if (views.has(id)) return views.get(id)!;
    const v = sourceViews[id],
      start = v?.byteOffset ?? 0;
    if (
      !v ||
      v.buffer !== 0 ||
      !Number.isInteger(start) ||
      !Number.isInteger(v.byteLength) ||
      start < 0 ||
      v.byteLength < 0 ||
      start + v.byteLength > sourceBin.length
    )
      throw Error("子网格缓冲越界");
    const offset = Math.ceil(length / 4) * 4;
    chunks.push(
      new Uint8Array(offset - length),
      sourceBin.slice(start, start + v.byteLength),
    );
    length = offset + v.byteLength;
    const index = j.bufferViews.push({ ...v, byteOffset: offset }) - 1;
    views.set(id, index);
    return index;
  };
  const accessor = (id: number) => {
    if (accessors.has(id)) return accessors.get(id)!;
    const a = sourceAccessors[id];
    if (!a || a.sparse) throw Error("不支持稀疏或缺失的子网格数据");
    const index =
      j.accessors.push({ ...a, bufferView: view(a.bufferView) }) - 1;
    accessors.set(id, index);
    return index;
  };
  for (const key of Object.keys(p.attributes))
    p.attributes[key] = accessor(p.attributes[key]);
  if (p.indices !== undefined) p.indices = accessor(p.indices);
  function materialTextures(value: any) {
    for (const [key, child] of Object.entries(value)) {
      if (child && typeof child === "object") {
        if (
          key.endsWith("Texture") &&
          typeof (child as any).index === "number"
        ) {
          const old = (child as any).index;
          let index = textures.get(old);
          if (index === undefined) {
            const t = sourceTextures[old];
            if (!t || !Number.isInteger(t.source))
              throw Error("无效子网格贴图");
            let image = images.get(t.source);
            if (image === undefined) {
              const img = sourceImages[t.source];
              if (!img || img.bufferView === undefined)
                throw Error("需要内嵌贴图");
              image =
                j.images.push({ ...img, bufferView: view(img.bufferView) }) - 1;
              images.set(t.source, image);
            }
            index = j.textures.push({ ...t, source: image }) - 1;
            textures.set(old, index);
          }
          (child as any).index = index;
        } else materialTextures(child);
      }
    }
  }
  materialTextures(j.materials[0]);
  const bin = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bin.set(chunk, offset);
    offset += chunk.length;
  }
  j.buffers = [{ byteLength: length }];
  return { json: j, bin, extra: [] };
}
export type ModelPart = { key: string; name: string; bytes: Uint8Array };
export type ModelNode = {
  key: string;
  parent: string | null;
  name: string;
  transform: Transform;
  part?: string;
};
export type EditableModel = {
  nodes: ModelNode[];
  parts: ModelPart[];
  normalization: Transform;
};
// Each glTF primitive is a material slot. Keep its local geometry intact; move
// the glTF transforms into editor nodes so picking and gizmos use the same world.
export function decodeModel(bytes: Uint8Array): EditableModel {
  const doc = readGLB(bytes),
    j = doc.json;
  if (j.animations?.length || j.skins?.length)
    throw Error("暂不支持展开动画或蒙皮模型");
  if (
    (j.extensionsRequired ?? []).some(
      (x: string) =>
        !["KHR_materials_ior", "KHR_materials_transmission", "KHR_materials_clearcoat", "KHR_materials_unlit"].includes(x),
    )
  )
    throw Error("模型使用了不支持的必需扩展");
  if (
    (j.buffers ?? []).some((b: any) => b.uri) ||
    (j.images ?? []).some((i: any) => i.uri)
  )
    throw Error("模型需要内嵌缓冲与贴图");
  const roots = j.scenes?.[j.scene ?? 0]?.nodes;
  if (!Array.isArray(roots)) throw Error("缺少模型场景");
  const nodes: ModelNode[] = [],
    parts = new Map<string, ModelPart>(),
    visited = new Set<number>();
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  function visit(index: number, parent: string | null, world: number[]) {
    if (!Number.isInteger(index) || !j.nodes?.[index] || visited.has(index))
      throw Error("模型层级循环、重复引用或节点无效");
    if (nodes.length >= 4096) throw Error("模型节点过多");
    visited.add(index);
    const n = j.nodes[index];
    if (n.skin !== undefined) throw Error("暂不支持展开蒙皮节点");
    if (n.camera !== undefined || n.extensions?.KHR_lights_punctual)
      throw Error("模型内相机和灯光尚不支持展开");
    let transform: Transform;
    if (n.matrix !== undefined) {
      if (
        !Array.isArray(n.matrix) ||
        n.matrix.length !== 16 ||
        n.matrix.some(
          (x: any) => typeof x !== "number" || !Number.isFinite(x),
        ) ||
        [3, 7, 11].some((k) => Math.abs(n.matrix[k]) > 1e-8) ||
        Math.abs(n.matrix[15] - 1) > 1e-8
      )
        throw Error("无效节点矩阵");
      transform = decomposeTRS(n.matrix);
    } else {
      transform = {
        position: n.translation ?? [0, 0, 0],
        rotation: n.rotation ?? [0, 0, 0, 1],
        scale: n.scale ?? [1, 1, 1],
      };
      for (const [k, size] of [
        ["position", 3],
        ["rotation", 4],
        ["scale", 3],
      ] as const)
        if (
          !Array.isArray(transform[k]) ||
          transform[k].length !== size ||
          transform[k].some(
            (x: any) => typeof x !== "number" || !Number.isFinite(x),
          )
        )
          throw Error("无效节点变换");
      if (
        Math.abs(Math.hypot(...transform.rotation) - 1) > 0.001 ||
        transform.scale.some((x) => Math.abs(x) < 1e-8)
      )
        throw Error("无效旋转或零缩放");
    }
    const key = `node-${index}`,
      nextWorld = multiply(world, localMatrix(transform));
    nodes.push({ key, parent, name: n.name || `Node ${index + 1}`, transform });
    if (n.mesh !== undefined) {
      const mesh = j.meshes?.[n.mesh];
      if (!mesh || !Array.isArray(mesh.primitives) || !mesh.primitives.length)
        throw Error("缺少模型网格");
      mesh.primitives.forEach((p: any, pi: number) => {
        const mode = p.mode ?? 4;
        if (!Number.isInteger(mode) || mode < 0 || mode > 6 || p.targets || p.extensions)
          throw Error("仅支持未压缩的静态 glTF 图元");
        const material =
          j.materials?.[p.material] ?? (p.material === undefined ? {} : null);
        if (
          !material ||
          !["OPAQUE", "MASK", "BLEND"].includes(material.alphaMode ?? "OPAQUE")
        )
          throw Error("无效材质 Alpha 模式");
        const accessor = j.accessors?.[p.attributes?.POSITION],
          view = j.bufferViews?.[accessor?.bufferView];
        if (
          !accessor ||
          accessor.componentType !== 5126 ||
          accessor.type !== "VEC3" ||
          accessor.sparse ||
          !view ||
          view.buffer !== 0 ||
          !Number.isInteger(accessor.count) ||
          accessor.count < 1
        )
          throw Error("无效位置缓冲");
        const stride = view.byteStride ?? 12,
          start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0),
          end = start + (accessor.count - 1) * stride + 12;
        if (
          stride < 12 ||
          start < 0 ||
          end > doc.bin.length ||
          end > (view.byteOffset ?? 0) + view.byteLength
        )
          throw Error("位置缓冲越界");
        const data = new DataView(
          doc.bin.buffer,
          doc.bin.byteOffset,
          doc.bin.byteLength,
        );
        for (let v = 0; v < accessor.count; v++) {
          const pos = [0, 1, 2].map((k) =>
            data.getFloat32(start + v * stride + k * 4, true),
          );
          if (pos.some((x) => !Number.isFinite(x))) throw Error("无效模型顶点");
          for (let k = 0; k < 3; k++) {
            const x =
              nextWorld[12 + k] +
              pos.reduce((s, x, c) => s + nextWorld[c * 4 + k] * x, 0);
            min[k] = Math.min(min[k], x);
            max[k] = Math.max(max[k], x);
          }
        }
        const part = `mesh-${n.mesh}-${pi}`,
          name = `${mesh.name || n.name || "Mesh"} · ${pi + 1} · ${material.name || "Material"}`;
        if (!parts.has(part)) {
          const json = structuredClone(j);
          json.nodes = [{ mesh: 0 }];
          json.scenes = [{ nodes: [0] }];
          json.scene = 0;
          json.meshes = [
            {
              name: mesh.name,
              primitives: [{ ...structuredClone(p), material: 0 }],
            },
          ];
          json.materials = [structuredClone(material)];
          delete json.animations;
          delete json.skins;
          delete json.cameras;
          json.extras = { novaEditor: { version: 1, modelPart: true } };
          parts.set(part, {
            key: part,
            name,
            bytes: writeGLB(compactPart({ json, bin: doc.bin, extra: [] })),
          });
        }
        nodes.push({
          key: `${key}-slot-${pi}`,
          parent: key,
          name,
          transform: identity(),
          part,
        });
      });
    }
    for (const child of n.children ?? []) visit(child, key, nextWorld);
  }
  for (const root of roots) visit(root, null, localMatrix(identity()));
  if (!parts.size) throw Error("模型没有可编辑子网格");
  if (
    nodes.length > 4096 ||
    [...parts.values()].reduce((sum, p) => sum + p.bytes.length, 0) >
      120 * 1024 * 1024
  )
    throw Error("展开后节点或资源超过预算（4096 节点 / 120 MiB）");
  const half = Math.max(...max.map((x, k) => x - min[k])) / 2;
  if (!Number.isFinite(half) || half < 1e-8) throw Error("模型边界无效");
  const normalization = identity();
  normalization.scale = [1 / half, 1 / half, 1 / half];
  normalization.position = min.map((x, k) => -(x + max[k]) / (2 * half));
  return { nodes, parts: [...parts.values()], normalization };
}
export function expandModel(
  scene: Scene,
  id: string,
  model: EditableModel,
  allocate: () => string,
): Record<string, Uint8Array> {
  assertEditable(scene, [id]);
  const root = scene.nodes.find((n) => n.id === id)!;
  const old = root.assetId,
    sourceSpace = old ? !!scene.assets[old].sourceSpace : true;
  const files: Record<string, Uint8Array> = {},
    partIDs = new Map<string, string>(),
    nodeIDs = new Map(model.nodes.map((n) => [n.key, allocate()]));
  for (const p of model.parts) {
    const aid = allocate(),
      path = `assets/${allocate()}.glb`;
    partIDs.set(p.key, aid);
    scene.assets[aid] = { path, sourceSpace: true, name: p.name };
    files[path] = p.bytes;
  }
  let parent = id;
  if (!sourceSpace) {
    parent = allocate();
    scene.nodes.push({
      id: parent,
      parentId: id,
      name: "Source normalization",
      transform: structuredClone(model.normalization),
    });
  }
  const children: SceneNode[] = model.nodes.map((n) => ({
    id: nodeIDs.get(n.key)!,
    parentId: n.parent ? nodeIDs.get(n.parent)! : parent,
    name: n.name,
    transform: structuredClone(n.transform),
    ...(n.part ? { assetId: partIDs.get(n.part)! } : {}),
  }));
  delete root.assetId;
  scene.nodes.push(...children);
  scene.schemaVersion = scene.schemaVersion < 2 ? 2 : scene.schemaVersion;
  if (old && !scene.nodes.some((n) => n.assetId === old))
    delete scene.assets[old];
  return files;
}
