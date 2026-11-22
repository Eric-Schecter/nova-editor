import { writeGLB } from "./index";

type Color = number[];
type CadNode = { name: string; meshes: number[]; children: CadNode[] };
type CadMesh = {
  name: string;
  color?: Color;
  brep_faces: { first: number; last: number; color: Color | null }[];
  attributes: { position: { array: number[] }; normal?: { array: number[] } };
  index: { array: number[] };
};
export type StepResult = { success: boolean; root: CadNode; meshes: CadMesh[] };

export const stepMeshing = {
  linearUnit: "meter",
  linearDeflectionType: "bounding_box_ratio",
  linearDeflection: 0.001,
  angularDeflection: 0.35,
};

export function stepMeshToGLB(result: StepResult) {
  if (!result.success || !result.meshes.length) throw Error("STEP contains no readable solids or surfaces");
  const json: any = {
    asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [] }],
    nodes: [], meshes: [], materials: [], bufferViews: [], accessors: [], buffers: [],
  };
  const chunks: Uint8Array[] = [];
  let offset = 0;
  function accessor(array: Float32Array | Uint32Array, type: "VEC3" | "SCALAR", bounds = false) {
    const slot = json.accessors.length;
    const view = json.bufferViews.length;
    chunks.push(new Uint8Array(array.buffer));
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: array.byteLength });
    offset += array.byteLength;
    if (offset > 125 * 1024 * 1024) throw Error("STEP tessellation exceeds the GLB asset budget");
    const entry: any = { bufferView: view, componentType: type === "VEC3" ? 5126 : 5125, count: array.length / (type === "VEC3" ? 3 : 1), type };
    if (bounds) {
      entry.min = [Infinity, Infinity, Infinity];
      entry.max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < array.length; i++) {
        const axis = i % 3;
        entry.min[axis] = Math.min(entry.min[axis], array[i]);
        entry.max[axis] = Math.max(entry.max[axis], array[i]);
      }
    }
    json.accessors.push(entry);
    return slot;
  }
  const materials = new Map<string, number>();
  function material(color: Color) {
    const key = color.join(",");
    const existing = materials.get(key);
    if (existing !== undefined) return existing;
    const id = json.materials.length;
    materials.set(key, id);
    json.materials.push({ pbrMetallicRoughness: { baseColorFactor: [...color, 1], metallicFactor: 0, roughnessFactor: .55 }, doubleSided: true });
    return id;
  }
  function yUp(values: number[]) {
    const array = new Float32Array(values.length);
    for (let i = 0; i < array.length; i += 3) {
      array[i] = values[i];
      array[i + 1] = values[i + 2];
      array[i + 2] = -values[i + 1];
    }
    return array;
  }
  const meshIds = result.meshes.map(mesh => {
    const index = mesh.index.array;
    if (!index.length) return undefined;
    const pos = accessor(yUp(mesh.attributes.position.array), "VEC3", true);
    const normals = mesh.attributes.normal?.array;
    const attributes: Record<string, number> = { POSITION: pos };
    if (normals?.length === mesh.attributes.position.array.length)
      attributes.NORMAL = accessor(yUp(normals), "VEC3");
    const base = material(mesh.color ?? [.45, .55, .68]);
    const colors = new Uint32Array(index.length / 3).fill(base);
    for (const face of mesh.brep_faces)
      if (face.color) colors.fill(material(face.color), face.first, face.last + 1);
    const groups = new Map<number, number[]>();
    for (let i = 0; i < colors.length; i++) {
      if (!groups.has(colors[i])) groups.set(colors[i], []);
      groups.get(colors[i])!.push(index[i * 3], index[i * 3 + 1], index[i * 3 + 2]);
    }
    const primitives = Array.from(groups, ([material, indices]) => ({
      attributes, material, indices: accessor(Uint32Array.from(indices), "SCALAR"),
    }));
    const meshId = json.meshes.length;
    json.meshes.push({ name: mesh.name || "STEP part", primitives });
    return meshId;
  });
  if (!json.meshes.length) throw Error("STEP contains no triangles");
  function node(source: CadNode): number {
    const id = json.nodes.length;
    const entry: any = { name: source.name || "STEP assembly" };
    json.nodes.push(entry);
    const children = source.children.map(node);
    const meshes = source.meshes.map(i => meshIds[i]).filter(i => i !== undefined);
    if (meshes.length === 1 && !children.length) entry.mesh = meshes[0];
    else for (const mesh of meshes) {
      children.push(json.nodes.length);
      json.nodes.push({ name: json.meshes[mesh!].name, mesh });
    }
    if (children.length) entry.children = children;
    return id;
  }
  json.scenes[0].nodes.push(node(result.root));
  const bin = new Uint8Array(offset);
  let at = 0;
  for (const chunk of chunks) { bin.set(chunk, at); at += chunk.length; }
  json.buffers.push({ byteLength: bin.length });
  return writeGLB({ json, bin, extra: [] });
}
