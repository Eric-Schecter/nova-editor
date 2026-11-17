import type { Scene } from "../../scene-schema/index";
import { worldMatrices } from "../../scene-schema/transforms";
import {
  add,
  mul,
  cameraFrame,
  cameraTangent,
  transform,
  type Camera,
  type Size,
  type Vec,
} from "./viewport";
export type Bounds = { minimum: number[]; maximum: number[] };
export type AssetBounds = Record<string, Bounds>;
export function boundsCorners(b: Bounds): Vec[] {
  return Array.from({ length: 8 }, (_, bits) =>
    [0, 1, 2].map((k) => (bits & (1 << k) ? b.maximum : b.minimum)[k]),
  );
}
export function sceneBounds(
  scene: Scene,
  assets: AssetBounds,
  root: string | null = null,
): Bounds | null {
  const worlds = worldMatrices(scene),
    ids = new Set(root ? [root] : scene.nodes.map((n) => n.id));
  if (root) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of scene.nodes)
        if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) {
          ids.add(n.id);
          changed = true;
        }
    }
  }
  const points: Vec[] = [];
  for (const n of scene.nodes)
    if (ids.has(n.id)) {
      const b = n.assetId ? assets[n.assetId] : null;
      if (b)
        for (const p of boundsCorners(b))
          points.push(transform(worlds.get(n.id)!, p));
      else if (!n.assetId) points.push(worlds.get(n.id)!.slice(12, 15));
    }
  if (!points.length) return null;
  return {
    minimum: [0, 1, 2].map((k) => Math.min(...points.map((p) => p[k]))),
    maximum: [0, 1, 2].map((k) => Math.max(...points.map((p) => p[k]))),
  };
}
export function frameBounds(
  camera: Camera,
  bounds: Bounds | null,
  size: Size,
): Camera {
  if (!bounds) return camera;
  const target = bounds.minimum.map((v, k) => (v + bounds.maximum[k]) * 0.5),
    radius = Math.max(
      0.02,
      Math.hypot(
        ...bounds.maximum.map((v, k) => (v - bounds.minimum[k]) * 0.5),
      ),
    );
  const tangent =
    cameraTangent(camera) *
    Math.min(1, Math.max(0.01, size.width / Math.max(1, size.height)));
  const factor = camera.orthographic ? tangent : Math.sin(Math.atan(tangent));
  return {
    ...camera,
    target,
    distance: Math.min(100, Math.max(0.05, (radius * 1.15) / factor)),
  };
}
export function panCamera(
  camera: Camera,
  dx: number,
  dy: number,
  size: Size,
): Camera {
  const f = cameraFrame(camera),
    unit =
      (2 * camera.distance * cameraTangent(camera)) / Math.max(1, size.height);
  return {
    ...camera,
    target: add(
      camera.target ?? [0, 0, 0],
      add(mul(f.right, -dx * unit), mul(f.up, dy * unit)),
    ),
  };
}
