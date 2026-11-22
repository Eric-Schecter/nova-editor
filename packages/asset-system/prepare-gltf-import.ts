import type { GLB } from "./index";
import { decomposeTRS } from "../editor-core/src/hierarchy";
import { identity, type SceneNode } from "../scene-schema/index";

const extension = "KHR_lights_punctual";

export function prepareGLTFImport(
  doc: GLB,
  root: string,
  allocate: () => string,
): { nodes: SceneNode[]; changed: boolean } {
  const { json } = doc;
  const expanded = expandSparseAccessors(doc);
  const unassigned = (json.meshes ?? []).flatMap((mesh: any) =>
    (mesh.primitives ?? []).filter((primitive: any) => primitive.material === undefined),
  );
  if (unassigned.length) {
    json.materials ??= [];
    const material = json.materials.length;
    json.materials.push({});
    for (const primitive of unassigned) primitive.material = material;
  }
  const lights = json.extensions?.[extension]?.lights;
  const references = (json.nodes ?? []).some((n: any) => n.extensions?.[extension] || n.camera !== undefined);
  if (!lights && !json.cameras?.length && !references && !json.extensionsUsed?.includes(extension) &&
      !json.extensionsRequired?.includes(extension)) return { nodes: [], changed: expanded || !!unassigned.length };

  const nodes: SceneNode[] = [];
  const visited = new Set<number>();
  function visit(index: number, parentId: string) {
    const source = json.nodes?.[index];
    if (!source || visited.has(index)) throw Error("无效的 glTF 场景层级");
    visited.add(index);
    const id = allocate();
    const slot = nodes.length;
    nodes.length++;
    for (const child of source.children ?? []) visit(child, id);
    const reference = source.extensions?.[extension];
    if (!reference && source.camera === undefined && nodes.length === slot + 1) {
      nodes.pop();
      return;
    }
    const transform = source.matrix ? decomposeTRS(source.matrix) : {
      position: source.translation ?? identity().position,
      rotation: source.rotation ?? identity().rotation,
      scale: source.scale ?? identity().scale,
    };
    const light = reference ? lights?.[reference.light] : undefined;
    if (reference && !light) throw Error("无效的 GLB 灯光引用");
    const node: SceneNode = { id, parentId, name: source.name || light?.name || "Group", transform };
    if (light) {
      const extras = light.extras?.novaEditor;
      const intensity = extras?.active === false ? extras.intensity : light.intensity;
      node.light = {
        type: light.type,
        color: light.color ?? [1, 1, 1],
        intensity: Math.min(100, intensity ?? 1),
        active: extras?.active !== false,
        shadows: extras?.shadows === true,
        softness: extras?.softness ?? 1,
        ...(light.type !== "directional" ? { range: light.range ?? 0 } : {}),
        ...(light.type === "spot" ? {
          innerConeAngle: light.spot?.innerConeAngle ?? 0,
          outerConeAngle: light.spot?.outerConeAngle ?? Math.PI / 4,
        } : {}),
      };
    }

    if (source.camera !== undefined) {
      const camera = json.cameras?.[source.camera];
      const lens = camera?.[camera.type];
      if (!lens || !["perspective", "orthographic"].includes(camera.type))
        throw Error("无效的 glTF 相机引用");
      if (!source.name && !light) node.name = camera.name || "Camera";
      const nearPlane = Math.min(1e6, Math.max(.0001, lens.znear));
      const farPlane = Math.min(1e7, Math.max(nearPlane + .0001, lens.zfar ?? Math.max(200, nearPlane * 2)));
      const component: NonNullable<SceneNode["camera"]> = {
        projection: camera.type,
        focusDistance: 5,
        orthographicSize: Math.min(80, Math.max(.05, lens.ymag === undefined ? 10 : 2 * lens.ymag)),
        exposure: 1,
        primary: false,
        verticalFov: Math.min(179, Math.max(1, lens.yfov === undefined ? 45 : lens.yfov * 180 / Math.PI)),
        nearPlane,
        farPlane,
      };
      if (light)
        nodes.push({ id: allocate(), parentId: id, name: camera.name || "Camera",
          transform: identity(), camera: component });
      else node.camera = component;
    }
    nodes[slot] = node;
  }
  for (const index of json.scenes?.[json.scene ?? 0]?.nodes ?? []) visit(index, root);
  for (const node of json.nodes ?? []) {
    delete node.camera;
    if (node.extensions) {
      delete node.extensions[extension];
      if (!Object.keys(node.extensions).length) delete node.extensions;
    }
  }
  delete json.cameras;
  if (json.extensions) {
    delete json.extensions[extension];
    if (!Object.keys(json.extensions).length) delete json.extensions;
  }
  for (const key of ["extensionsUsed", "extensionsRequired"])
    if (json[key]) {
      json[key] = json[key].filter((value: string) => value !== extension);
      if (!json[key].length) delete json[key];
    }
  return { nodes, changed: true };
}

/** Materialize sparse elements for the renderer while preserving accessor indices. */
function expandSparseAccessors(doc: GLB): boolean {
  const { json, bin } = doc;
  const chunks: { offset: number; bytes: Uint8Array }[] = [];
  let length = bin.length;
  const widths: Record<number, number> = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4};
  const rows: Record<string, number> = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 2, MAT3: 3, MAT4: 4};
  const aligned = (size: number) => Math.ceil(size / 4) * 4;
  function viewBytes(index: number, offset: number, size: number) {
    const view = json.bufferViews?.[index];
    const start = view?.byteOffset ?? 0;
    if (view?.buffer !== 0 || ![start, offset, size].every(Number.isSafeInteger) ||
        start < 0 || offset < 0 || size < 0 ||
        offset + size > view.byteLength || start + offset + size > bin.length)
      throw Error("稀疏访问器缓冲越界");
    return bin.subarray(start + offset, start + offset + size);
  }
  for (const accessor of json.accessors ?? []) {
    const sparse = accessor.sparse;
    if (!sparse) continue;
    const width = widths[accessor.componentType], rowCount = rows[accessor.type];
    const elementSize = accessor.type?.startsWith("MAT") ? rowCount * aligned(rowCount * width) : rowCount * width;
    const indexType = sparse.indices.componentType;
    const indexSize = [5121, 5123, 5125].includes(indexType) ? widths[indexType] : 0;
    if (!elementSize || !indexSize || !Number.isSafeInteger(accessor.count) ||
        !Number.isSafeInteger(sparse.count) || sparse.count < 1 || sparse.count > accessor.count)
      throw Error("无效稀疏访问器");
    const offset = aligned(length);
    length = offset + accessor.count * elementSize;
    if (length > 128 * 1024 * 1024) throw Error("稀疏访问器展开超过 128 MiB");
    const dense = new Uint8Array(accessor.count * elementSize);
    if (accessor.bufferView !== undefined) {
      const stride = json.bufferViews?.[accessor.bufferView]?.byteStride ?? elementSize;
      if (!Number.isSafeInteger(stride) || stride < elementSize) throw Error("无效访问器步长");
      const base = viewBytes(accessor.bufferView, accessor.byteOffset ?? 0, (accessor.count - 1) * stride + elementSize);
      for (let i = 0; i < accessor.count; i++)
        dense.set(base.subarray(i * stride, i * stride + elementSize), i * elementSize);
    }
    const indices = viewBytes(sparse.indices.bufferView, sparse.indices.byteOffset ?? 0, sparse.count * indexSize);
    const values = viewBytes(sparse.values.bufferView, sparse.values.byteOffset ?? 0, sparse.count * elementSize);
    const data = new DataView(indices.buffer, indices.byteOffset, indices.byteLength);
    let previous = -1;
    for (let i = 0; i < sparse.count; i++) {
      const byte = i * indexSize;
      const index = indexSize === 1 ? data.getUint8(byte) :
        indexSize === 2 ? data.getUint16(byte, true) : data.getUint32(byte, true);
      if (index <= previous || index >= accessor.count) throw Error("稀疏访问器索引无效");
      dense.set(values.subarray(i * elementSize, (i + 1) * elementSize), index * elementSize);
      previous = index;
    }
    accessor.bufferView = json.bufferViews.length;
    accessor.byteOffset = 0;
    delete accessor.sparse;
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: dense.length });
    chunks.push({ offset, bytes: dense });
  }
  if (!chunks.length) return false;
  doc.bin = new Uint8Array(length);
  doc.bin.set(bin);
  for (const chunk of chunks) doc.bin.set(chunk.bytes, chunk.offset);
  json.buffers[0].byteLength = length;
  return true;
}
