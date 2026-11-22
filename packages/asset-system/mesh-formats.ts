import { readGLB, writeGLB } from "./index";
import { identity } from "../scene-schema/index";
import { localMatrix, multiply } from "../scene-schema/transforms";

type Point = number[];
export type Triangle = [Point, Point, Point];
export type MeshFormat = "obj" | "stl";
const maxTriangles = 1_000_000;
function point(values: string[]): Point {
  const p = values.slice(0, 3).map(Number);
  if (p.length !== 3 || p.some((v) => !Number.isFinite(Math.fround(v))))
    throw Error("无效顶点");
  return p;
}
export function normal([a, b, c]: Triangle) {
  const [x, y, z] = b.map((v, i) => v - a[i]),
    [u, v, w] = c.map((p, i) => p - a[i]);
  const n = [y * w - z * v, z * u - x * w, x * v - y * u],
    l = Math.hypot(...n);
  return l ? n.map((x) => x / l) : [0, 1, 0];
}
export function triangulateFace(
  face: Point[],
  add: (triangle: Triangle) => void,
) {
  if (face.length === 3) {
    add(face as Triangle);
    return;
  }
  if (face.length > 1024) throw Error("OBJ 单面顶点超过 1024");
  const normal = [0, 0, 0];
  for (let i = 0; i < face.length; i++) {
    const a = face[i],
      b = face[(i + 1) % face.length];
    for (let k = 0; k < 3; k++)
      normal[k] +=
        (a[(k + 1) % 3] - b[(k + 1) % 3]) * (a[(k + 2) % 3] + b[(k + 2) % 3]);
  }
  const axis = normal.reduce(
    (best, value, k) => (Math.abs(value) > Math.abs(normal[best]) ? k : best),
    0,
  );
  const u = (axis + 1) % 3,
    v = (axis + 2) % 3,
    sign = Math.sign(normal[axis]);
  if (!sign) throw Error("OBJ 多边形退化或自相交");
  const turn = (a: Point, b: Point, c: Point) =>
    sign * ((b[u] - a[u]) * (c[v] - a[v]) - (b[v] - a[v]) * (c[u] - a[u]));
  const remaining = [...face];
  while (remaining.length > 3) {
    const ear = remaining.findIndex((b, i) => {
      const a = remaining[(i + remaining.length - 1) % remaining.length];
      const c = remaining[(i + 1) % remaining.length];
      return (
        turn(a, b, c) > 0 &&
        !remaining.some(
          (p) =>
            p !== a &&
            p !== b &&
            p !== c &&
            turn(a, b, p) >= 0 &&
            turn(b, c, p) >= 0 &&
            turn(c, a, p) >= 0,
        )
      );
    });
    if (ear < 0) throw Error("无法三角化 OBJ 多边形");
    add([
      remaining[(ear + remaining.length - 1) % remaining.length],
      remaining[ear],
      remaining[(ear + 1) % remaining.length],
    ]);
    remaining.splice(ear, 1);
  }
  add(remaining as Triangle);
}
function parseMesh(bytes: Uint8Array, format: MeshFormat): Triangle[] {
  const output: Triangle[] = [];
  const add = (triangle: Triangle) => {
    if (output.length >= maxTriangles) throw Error("模型超过 100 万三角面");
    output.push(triangle);
  };
  if (format === "stl" && bytes.length >= 84) {
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = data.getUint32(80, true);
    if (84 + count * 50 === bytes.length) {
      for (let i = 0; i < count; i++) {
        const p = [0, 1, 2].map((j) =>
          [0, 1, 2].map((k) =>
            data.getFloat32(96 + i * 50 + j * 12 + k * 4, true),
          ),
        );
        if (p.flat().some((v) => !Number.isFinite(v)))
          throw Error("无效 STL 顶点");
        add(p as Triangle);
      }
      return output;
    }
  }
  const points: Point[] = [];
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (format === "stl") {
    const lines = text
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    let i = 0;
    while (i < lines.length) {
      if (!/^solid(?:\s|$)/i.test(lines[i++])) throw Error("无效 ASCII STL");
      while (i < lines.length && !/^endsolid(?:\s|$)/i.test(lines[i])) {
        if (
          !/^facet\s+normal\s+/i.test(lines[i++]) ||
          !/^outer\s+loop$/i.test(lines[i++] ?? "")
        )
          throw Error("无效 STL 面");
        const vertices: Point[] = [];
        for (let j = 0; j < 3; j++) {
          const tokens = (lines[i++] ?? "").split(/\s+/);
          if (tokens[0].toLowerCase() !== "vertex" || tokens.length !== 4)
            throw Error("无效 STL 顶点");
          vertices.push(point(tokens.slice(1)));
        }
        if (
          !/^endloop$/i.test(lines[i++] ?? "") ||
          !/^endfacet$/i.test(lines[i++] ?? "")
        )
          throw Error("无效 STL 面结尾");
        add(vertices as Triangle);
      }
      if (i === lines.length) throw Error("缺少 endsolid");
      i++;
    }
    return output;
  }
  for (const line of text.replace(/\\\r?\n/g, " ").split(/\r?\n/)) {
    const [tag, ...fields] = line.split("#", 1)[0].trim().split(/\s+/);
    if (tag === "v") points.push(point(fields));
    if (tag === "f") {
      const face = fields.map((field) => {
        const index = Number(field.split("/")[0]);
        const offset = index < 0 ? points.length + index : index - 1;
        if (!Number.isSafeInteger(index) || !points[offset])
          throw Error("OBJ 面索引越界");
        return points[offset];
      });
      if (face.length < 3) throw Error("OBJ 面至少需要三个顶点");
      triangulateFace(face, add);
    }
  }
  return output;
}
export function meshToGLB(bytes: Uint8Array, format: MeshFormat) {
  const triangles = parseMesh(bytes, format);
  if (!triangles.length) throw Error("模型没有三角面");
  const bin = new Uint8Array(triangles.length * 72),
    data = new DataView(bin.buffer);
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  let offset = 0;
  for (const tri of triangles) {
    const n = normal(tri);
    for (const p of tri) {
      for (let i = 0; i < 3; i++) {
        const v = Math.fround(p[i]);
        min[i] = Math.min(min[i], v);
        max[i] = Math.max(max[i], v);
        data.setFloat32(offset + i * 4, v, true);
        data.setFloat32(offset + 12 + i * 4, n[i], true);
      }
      offset += 24;
    }
  }
  const count = triangles.length * 3;
  return writeGLB({
    bin,
    extra: [],
    json: {
      asset: { version: "2.0", generator: "Nova Editor" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [
        {
          primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0 }],
        },
      ],
      materials: [
        {
          name: "Default",
          pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.8 },
        },
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count, type: "VEC3", min, max },
        {
          bufferView: 0,
          byteOffset: 12,
          componentType: 5126,
          count,
          type: "VEC3",
        },
      ],
      buffers: [{ byteLength: bin.length }],
      bufferViews: [
        { buffer: 0, byteLength: bin.length, byteStride: 24, target: 34962 },
      ],
    },
  });
}
export type ObjCorner = { position: Point; uv?: number[]; normal?: Point };
export function glbToMesh(
  bytes: Uint8Array,
  format: MeshFormat,
  onFace?: (corners: ObjCorner[], material: number | undefined) => void,
) {
  const { json, bin } = readGLB(bytes),
    data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  if (json.skins?.length || json.animations?.length)
    throw Error("OBJ/STL 导出需要静态 GLB");
  const triangles: Triangle[] = [];
  function accessor(index: number, components: number) {
    const a = json.accessors?.[index],
      v = json.bufferViews?.[a?.bufferView];
    const types: Record<number, number> = {
      5121: 1,
      5123: 2,
      5125: 4,
      5126: 4,
    };
    const width = components ? 4 * components : types[a?.componentType];
    const stride = v?.byteStride ?? width,
      relative = a?.byteOffset ?? 0,
      offset = (v?.byteOffset ?? 0) + relative;
    if (
      !a ||
      !v ||
      v.buffer !== 0 ||
      a.sparse ||
      v.extensions?.EXT_meshopt_compression ||
      v.extensions?.KHR_meshopt_compression ||
      (components
        ? a.type !== `VEC${components}` || a.componentType !== 5126
        : a.type !== "SCALAR" || a.componentType === 5126) ||
      !width ||
      ![stride, relative, offset, a.count, v.byteLength].every(
        Number.isSafeInteger,
      ) ||
      a.count < 1 ||
      stride < width ||
      relative < 0 ||
      offset < 0 ||
      relative + (a.count - 1) * stride + width > v.byteLength ||
      offset + (a.count - 1) * stride + width >
        Math.min(bin.length, json.buffers?.[0]?.byteLength ?? 0)
    )
      throw Error("不支持或无效的 GLB 网格访问器");
    return {
      count: a.count,
      read(i: number) {
        if (!Number.isSafeInteger(i) || i < 0 || i >= a.count)
          throw Error("GLB 顶点索引越界");
        const p = offset + i * stride;
        return components
          ? Array.from({ length: components }, (_, k) =>
              data.getFloat32(p + k * 4, true),
            )
          : width === 1
            ? data.getUint8(p)
            : width === 2
              ? data.getUint16(p, true)
              : data.getUint32(p, true);
      },
    };
  }
  const active = new Set<number>();
  function visit(id: number, parent: number[]) {
    const n = json.nodes?.[id];
    if (!n || active.has(id) || active.size >= 256)
      throw Error("无效 GLB 层级");
    active.add(id);
    const transform = multiply(
      parent,
      n.matrix ??
        localMatrix({
          position: n.translation ?? [0, 0, 0],
          rotation: n.rotation ?? [0, 0, 0, 1],
          scale: n.scale ?? [1, 1, 1],
        }),
    );
    const determinant =
      transform[0] *
        (transform[5] * transform[10] - transform[9] * transform[6]) -
      transform[4] *
        (transform[1] * transform[10] - transform[9] * transform[2]) +
      transform[8] *
        (transform[1] * transform[6] - transform[5] * transform[2]);
    const mirrored = determinant < 0;
    const cofactor = [4, 8, 0].map((a, i) => {
      const b = [8, 0, 4][i];
      return [
        transform[a + 1] * transform[b + 2] -
          transform[a + 2] * transform[b + 1],
        transform[a + 2] * transform[b] - transform[a] * transform[b + 2],
        transform[a] * transform[b + 1] - transform[a + 1] * transform[b],
      ];
    });
    for (const primitive of n.mesh === undefined
      ? []
      : json.meshes[n.mesh].primitives) {
      if (
        (primitive.mode ?? 4) !== 4 ||
        primitive.targets?.length ||
        primitive.extensions?.KHR_draco_mesh_compression
      )
        throw Error("仅支持未压缩的静态三角面");
      const positions = accessor(primitive.attributes.POSITION, 3);
      const indices =
        primitive.indices === undefined
          ? undefined
          : accessor(primitive.indices, 0);
      const count = indices?.count ?? positions.count;
      if (count % 3 || triangles.length + count / 3 > maxTriangles)
        throw Error("无效或过大的三角网格");
      const vertex = (i: number) => {
        const p = positions.read((indices?.read(i) ?? i) as number) as Point;
        const result = [0, 1, 2].map((k) =>
          Math.fround(
            transform[k] * p[0] +
              transform[k + 4] * p[1] +
              transform[k + 8] * p[2] +
              transform[k + 12],
          ),
        );
        if (result.some((v) => !Number.isFinite(v)))
          throw Error("无效模型变换");
        return result;
      };
      const uv =
        onFace && primitive.attributes.TEXCOORD_0 !== undefined
          ? accessor(primitive.attributes.TEXCOORD_0, 2)
          : undefined;
      const normals =
        onFace && primitive.attributes.NORMAL !== undefined
          ? accessor(primitive.attributes.NORMAL, 3)
          : undefined;
      for (let j = 0; j < count; j += 3) {
        const order = [j, j + (mirrored ? 2 : 1), j + (mirrored ? 1 : 2)];
        const triangle = order.map(vertex) as Triangle;
        triangles.push(triangle);
        onFace?.(
          order.map((entry, corner) => {
            const index = (indices?.read(entry) ?? entry) as number;
            const tex = uv?.read(index) as number[] | undefined;
            const original = normals?.read(index) as number[] | undefined;
            let n = normal(triangle);
            if (original && determinant) {
              const transformed = [0, 1, 2].map(
                (k) =>
                  (mirrored ? -1 : 1) *
                  cofactor.reduce((v, c, i) => v + c[k] * original[i], 0),
              );
              const length = Math.hypot(...transformed);
              if (length) n = transformed.map((v) => v / length);
            }
            if (tex?.some((v) => !Number.isFinite(v))) throw Error("无效 UV");
            return { position: triangle[corner], uv: tex, normal: n };
          }),
          primitive.material,
        );
      }
    }
    for (const child of n.children ?? []) visit(child, transform);
    active.delete(id);
  }
  for (const root of json.scenes?.[json.scene ?? 0]?.nodes ?? [])
    visit(root, localMatrix(identity()));
  if (!triangles.length) throw Error("模型没有三角面");
  if (onFace) return new Uint8Array();
  if (format === "obj") {
    const lines = ["# Nova Editor"];
    for (const [i, triangle] of triangles.entries()) {
      for (const vertex of triangle) lines.push("v " + vertex.join(" "));
      lines.push(`f ${i * 3 + 1} ${i * 3 + 2} ${i * 3 + 3}`);
    }
    return new TextEncoder().encode(lines.join("\n") + "\n");
  }
  const out = new Uint8Array(84 + triangles.length * 50),
    view = new DataView(out.buffer);
  out.set(new TextEncoder().encode("Nova Editor binary STL"));
  view.setUint32(80, triangles.length, true);
  for (const [i, triangle] of triangles.entries())
    [...normal(triangle), ...triangle.flat()].forEach((v, j) =>
      view.setFloat32(84 + i * 50 + j * 4, v, true),
    );
  return out;
}
