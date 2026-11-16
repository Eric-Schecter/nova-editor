import type { Scene, Transform } from "./index";
export const multiply = (a: number[], b: number[]) =>
  Array.from({ length: 16 }, (_, i) => {
    const r = i % 4,
      c = Math.floor(i / 4);
    return [0, 1, 2, 3].reduce((s, k) => s + a[k * 4 + r] * b[c * 4 + k], 0);
  });
export function localMatrix(t: Transform) {
  const [x, y, z, w] = t.rotation,
    [a, b, c] = t.scale;
  return [
    (1 - 2 * y * y - 2 * z * z) * a,
    (2 * x * y + 2 * z * w) * a,
    (2 * x * z - 2 * y * w) * a,
    0,
    (2 * x * y - 2 * z * w) * b,
    (1 - 2 * x * x - 2 * z * z) * b,
    (2 * y * z + 2 * x * w) * b,
    0,
    (2 * x * z + 2 * y * w) * c,
    (2 * y * z - 2 * x * w) * c,
    (1 - 2 * x * x - 2 * y * y) * c,
    0,
    ...t.position,
    1,
  ];
}
export function worldMatrices(scene: Scene) {
  const nodes = new Map(scene.nodes.map((n) => [n.id, n])),
    cache = new Map<string, number[]>(),
    visiting = new Set<string>();
  const world = (id: string): number[] => {
    if (cache.has(id)) return cache.get(id)!;
    if (visiting.has(id)) throw Error("Scene cycle");
    const n = nodes.get(id);
    if (!n) throw Error("Missing scene parent");
    visiting.add(id);
    const local = localMatrix(n.transform),
      result = n.parentId ? multiply(world(n.parentId), local) : local;
    cache.set(id, result);
    visiting.delete(id);
    return result;
  };
  for (const id of nodes.keys()) world(id);
  return cache;
}
export function eulerQuaternion(degrees: number[]) {
  const [x, y, z] = degrees.map((v) => (v * Math.PI) / 360),
    a = Math.cos(x),
    b = Math.cos(y),
    c = Math.cos(z),
    d = Math.sin(x),
    e = Math.sin(y),
    f = Math.sin(z);
  return [
    d * b * c + a * e * f,
    a * e * c - d * b * f,
    a * b * f + d * e * c,
    a * b * c - d * e * f,
  ];
}
export function quaternionEuler(q: number[]) {
  const m = localMatrix({ position: [0, 0, 0], scale: [1, 1, 1], rotation: q }),
    y = Math.asin(Math.max(-1, Math.min(1, m[8])));
  return [
    ((Math.abs(m[8]) < 0.9999999
      ? Math.atan2(-m[9], m[10])
      : Math.atan2(m[6], m[5])) *
      180) /
      Math.PI,
    (y * 180) / Math.PI,
    ((Math.abs(m[8]) < 0.9999999 ? Math.atan2(-m[4], m[0]) : 0) * 180) /
      Math.PI,
  ];
}
