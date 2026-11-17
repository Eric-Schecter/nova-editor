import { identity, type Scene, type Transform } from "../../scene-schema/index";
import {
  localMatrix,
  multiply,
  worldMatrices,
} from "../../scene-schema/transforms";
export type Vec = number[];
export type Point = { x: number; y: number };
export type Camera = {
  yaw: number;
  pitch: number;
  distance: number;
  exposure: number;
  orthographic?: boolean;
  target?: number[];
  roll?: number;
  verticalFov?: number;
  nearPlane?: number;
  farPlane?: number;
};
export type Size = { width: number; height: number };
export type Mode = "translate" | "rotate" | "scale";
export const add = (a: Vec, b: Vec) => a.map((v, i) => v + b[i]);
export const sub = (a: Vec, b: Vec) => a.map((v, i) => v - b[i]);
export const mul = (a: Vec, s: number) => a.map((v) => v * s);
export const dot = (a: Vec, b: Vec) => a.reduce((s, v, i) => s + v * b[i], 0);
export const cross = (a: Vec, b: Vec) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (v: Vec) => mul(v, 1 / Math.max(1e-20, Math.hypot(...v)));
export const transform = (m: Vec, v: Vec, w = 1) =>
  [0, 1, 2].map(
    (r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * w,
  );
export function inverse(m: Vec): Vec | null {
  const a = m.slice(0, 3),
    b = m.slice(4, 7),
    c = m.slice(8, 11),
    rows = [cross(b, c), cross(c, a), cross(a, b)],
    d = dot(a, rows[0]);
  if (Math.abs(d) < 1e-12) return null;
  const result = [
    rows[0][0] / d,
    rows[1][0] / d,
    rows[2][0] / d,
    0,
    rows[0][1] / d,
    rows[1][1] / d,
    rows[2][1] / d,
    0,
    rows[0][2] / d,
    rows[1][2] / d,
    rows[2][2] / d,
    0,
    0,
    0,
    0,
    1,
  ];
  const t = transform(result, m.slice(12, 15), 0);
  result.splice(12, 3, ...mul(t, -1));
  return result;
}
export const cameraTangent = (c: Camera) =>
  Math.tan(((c.verticalFov ?? 45) * Math.PI) / 360);
export const cameraNear = (c: Camera) => c.nearPlane ?? 0.01;
export const cameraFar = (c: Camera) => c.farPlane ?? 200;
export function cameraOrientation(c: Pick<Camera, "yaw" | "pitch" | "roll">) {
  const y = (c.yaw * Math.PI) / 360,
    p = (c.pitch * Math.PI) / 360,
    r = ((c.roll ?? 0) * Math.PI) / 360;
  const x = -Math.cos(y) * Math.sin(p),
    qY = Math.sin(y) * Math.cos(p),
    z = Math.sin(y) * Math.sin(p),
    w = Math.cos(y) * Math.cos(p);
  return [
    x * Math.cos(r) + qY * Math.sin(r),
    qY * Math.cos(r) - x * Math.sin(r),
    z * Math.cos(r) + w * Math.sin(r),
    w * Math.cos(r) - z * Math.sin(r),
  ];
}
export function cameraFrame(c: Camera) {
  const y = (c.yaw * Math.PI) / 180,
    p = (c.pitch * Math.PI) / 180,
    eye = [
      c.distance * Math.cos(p) * Math.sin(y),
      c.distance * Math.sin(p),
      c.distance * Math.cos(p) * Math.cos(y),
    ],
    target = c.target ?? [0, 0, 0],
    position = add(eye, target),
    forward = norm(mul(eye, -1)),
    baseRight = [Math.cos(y), 0, -Math.sin(y)],
    baseUp = cross(baseRight, forward),
    roll = ((c.roll ?? 0) * Math.PI) / 180,
    right = add(mul(baseRight, Math.cos(roll)), mul(baseUp, Math.sin(roll))),
    up = add(mul(baseUp, Math.cos(roll)), mul(baseRight, -Math.sin(roll)));
  return { eye: position, forward, right, up };
}
export function project(v: Vec, c: Camera, size: Size): Point | null {
  const frame = cameraFrame(c),
    rel = sub(v, frame.eye),
    depth = dot(rel, frame.forward);
  if (depth < cameraNear(c) || depth > cameraFar(c)) return null;
  const scale =
    size.height /
    (2 * cameraTangent(c) * (c.orthographic ? c.distance : depth));
  return {
    x: size.width / 2 + dot(rel, frame.right) * scale,
    y: size.height / 2 - dot(rel, frame.up) * scale,
  };
}
export function rayAt(p: Point, c: Camera, size: Size) {
  const f = cameraFrame(c),
    x =
      ((p.x * 2) / size.width - 1) *
      (size.width / size.height) *
      cameraTangent(c),
    y = (1 - (p.y * 2) / size.height) * cameraTangent(c);
  if (c.orthographic)
    return {
      origin: add(
        add(
          f.eye,
          add(mul(f.right, x * c.distance), mul(f.up, y * c.distance)),
        ),
        mul(f.forward, cameraNear(c) * (1 + 1e-6)),
      ),
      direction: f.forward,
    };
  const direction = norm(add(f.forward, add(mul(f.right, x), mul(f.up, y))));
  return {
    origin: add(
      f.eye,
      mul(direction, (cameraNear(c) * (1 + 1e-6)) / dot(direction, f.forward)),
    ),
    direction,
  };
}
const axis = (k: number): Vec => [0, 1, 2].map((i) => (i === k ? 1 : 0));
export type Gizmo = {
  mode: Mode;
  basis: Vec;
  inv: Vec;
  radius: number;
  pivot: Point;
  lines: { axis: number; points: Point[] }[];
  id: string;
  t: Transform;
  camera: Camera;
  size: Size;
};
export function gizmoFor(
  scene: Scene,
  id: string | null,
  mode: Mode,
  camera: Camera,
  size: Size,
): Gizmo | null {
  const node = scene.nodes.find((n) => n.id === id);
  if (!node || size.width <= 0 || size.height <= 0) return null;
  const worlds = worldMatrices(scene),
    parent = node.parentId
      ? worlds.get(node.parentId)!
      : localMatrix(identity()),
    basis =
      mode === "translate"
        ? [...parent]
        : multiply(
            parent,
            localMatrix({ ...node.transform, scale: [1, 1, 1] }),
          ),
    world = worlds.get(node.id)!;
  basis.splice(12, 3, ...world.slice(12, 15));
  const inv = inverse(basis),
    pivot = project(world.slice(12, 15), camera, size);
  if (!inv || !pivot) return null;
  const depth = dot(
      sub(world.slice(12, 15), cameraFrame(camera).eye),
      cameraFrame(camera).forward,
    ),
    maxLength = Math.max(
      ...[0, 1, 2].map((k) => Math.hypot(...basis.slice(k * 4, k * 4 + 3))),
    );
  const radius =
      (82 *
        2 *
        cameraTangent(camera) *
        (camera.orthographic ? camera.distance : depth)) /
      size.height /
      maxLength,
    lines = [];
  for (let k = 0; k < 3; k++) {
    const points: Point[] = [];
    if (mode === "rotate") {
      const a = (k + 1) % 3,
        b = (k + 2) % 3;
      for (let i = 0; i <= 64; i++) {
        const v = [0, 0, 0];
        v[a] = Math.cos((i * Math.PI) / 32) * radius;
        v[b] = Math.sin((i * Math.PI) / 32) * radius;
        const p = project(transform(basis, v), camera, size);
        if (p) points.push(p);
      }
    } else {
      points.push(pivot);
      const p = project(transform(basis, mul(axis(k), radius)), camera, size);
      if (p) points.push(p);
    }
    lines.push({ axis: k, points });
  }
  return {
    mode,
    basis,
    inv,
    radius,
    pivot,
    lines,
    id: node.id,
    t: structuredClone(node.transform),
    camera: { ...camera },
    size: { ...size },
  };
}
export function segmentDistance(p: Point, a: Point, b: Point) {
  const x = b.x - a.x,
    y = b.y - a.y,
    l = x * x + y * y,
    t = l
      ? Math.max(0, Math.min(1, ((p.x - a.x) * x + (p.y - a.y) * y) / l))
      : 0;
  return Math.hypot(p.x - a.x - x * t, p.y - a.y - y * t);
}
export function hitGizmo(g: Gizmo, p: Point): number | null {
  if (g.mode !== "rotate" && Math.hypot(p.x - g.pivot.x, p.y - g.pivot.y) < 10)
    return -1;
  let best = 9,
    result: number | null = null;
  for (const line of g.lines) {
    for (let i = 1; i < line.points.length; i++) {
      const a = line.points[i - 1],
        b = line.points[i];
      if (g.mode !== "rotate" && Math.hypot(b.x - a.x, b.y - a.y) < 18)
        continue;
      if (
        g.mode !== "rotate" &&
        Math.hypot(p.x - g.pivot.x, p.y - g.pivot.y) < 18
      )
        continue;
      const distance = segmentDistance(p, a, b);
      if (distance < best) {
        best = distance;
        result = line.axis;
      }
    }
  }
  return result;
}
function axisParameter(o: Vec, d: Vec, k: number) {
  const dd = dot(d, d),
    denominator = dd - d[k] * d[k];
  return denominator < 1e-10 * dd
    ? null
    : (o[k] * dd - d[k] * dot(o, d)) / denominator;
}
function localRay(g: Gizmo, p: Point) {
  const ray = rayAt(p, g.camera, g.size);
  return {
    o: transform(g.inv, ray.origin),
    d: transform(g.inv, ray.direction, 0),
  };
}
function planeVector(o: Vec, d: Vec, k: number) {
  if (Math.abs(d[k]) < 1e-10) return null;
  return add(o, mul(d, -o[k] / d[k]));
}
export type Drag = {
  g: Gizmo;
  axis: number;
  start: Point;
  parameter: number;
  vector: Vec;
  plane: Vec;
  worldAnchor: Vec;
};
export function beginDrag(g: Gizmo, k: number, start: Point): Drag | null {
  if (k < -1 || k > 2 || (g.mode === "rotate" && k < 0)) return null;
  const { o, d } = localRay(g, start),
    ray = rayAt(start, g.camera, g.size),
    plane = cameraFrame(g.camera).forward,
    pivot = g.basis.slice(12, 15),
    den = dot(ray.direction, plane),
    anchor =
      Math.abs(den) > 1e-10
        ? add(
            ray.origin,
            mul(ray.direction, dot(sub(pivot, ray.origin), plane) / den),
          )
        : pivot;
  const vector = g.mode === "rotate" ? planeVector(o, d, k) : [0, 0, 0],
    parameter = k >= 0 && g.mode !== "rotate" ? axisParameter(o, d, k) : 0;
  if (vector === null || parameter === null) return null;
  return { g, axis: k, start, parameter, vector, plane, worldAnchor: anchor };
}
export function updateDrag(drag: Drag, p: Point, snap = false): Transform {
  const { g, axis: k } = drag,
    t = structuredClone(g.t),
    { o, d } = localRay(g, p),
    round = (v: number, step: number) =>
      snap ? Math.round(v / step) * step : v;
  if (g.mode === "translate") {
    if (k < 0) {
      const ray = rayAt(p, g.camera, g.size),
        den = dot(ray.direction, drag.plane);
      if (Math.abs(den) > 1e-10) {
        const point = add(
            ray.origin,
            mul(
              ray.direction,
              dot(sub(g.basis.slice(12, 15), ray.origin), drag.plane) / den,
            ),
          ),
          delta = transform(g.inv, sub(point, drag.worldAnchor), 0);
        t.position = add(
          t.position,
          delta.map((v) => round(v, 0.25)),
        );
      }
    } else {
      const value = axisParameter(o, d, k);
      if (value !== null) t.position[k] += round(value - drag.parameter, 0.25);
    }
  } else if (g.mode === "scale") {
    if (k < 0) {
      const factor = Math.exp(
        Math.max(
          -7,
          Math.min(7, (p.x - drag.start.x - p.y + drag.start.y) / 100),
        ),
      );
      t.scale = t.scale.map((v) => v * round(factor, 0.1));
    } else {
      const value = axisParameter(o, d, k);
      if (value !== null)
        t.scale[k] += round(
          ((value - drag.parameter) / g.radius) *
            Math.max(1, Math.abs(t.scale[k])),
          0.1,
        );
    }
  } else {
    const v = planeVector(o, d, k);
    if (v && Math.hypot(...v) > 1e-8 && Math.hypot(...drag.vector) > 1e-8) {
      let angle = Math.atan2(
        dot(axis(k), cross(drag.vector, v)),
        dot(drag.vector, v),
      );
      angle = round(angle, Math.PI / 12);
      const q = mul(axis(k), Math.sin(angle / 2)).concat(Math.cos(angle / 2)),
        [x, y, z, w] = t.rotation,
        [a, b, c, e] = q;
      t.rotation = norm([
        w * a + x * e + y * c - z * b,
        w * b - x * c + y * e + z * a,
        w * c + x * b - y * a + z * e,
        w * e - x * a - y * b - z * c,
      ]);
    }
  }
  return t;
}
