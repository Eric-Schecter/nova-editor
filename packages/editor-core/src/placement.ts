import { inheritedFlag } from "./hierarchy";
import { identity, type Scene, type Transform } from "../../scene-schema/index";
import { worldMatrices, localMatrix } from "../../scene-schema/transforms";
import { boundsCorners, type AssetBounds, type Bounds } from "./navigation";
import {
  rayAt,
  project,
  add,
  mul,
  transform,
  inverse,
  type Camera,
  type Point,
  type Size,
  type Vec,
} from "./viewport";
export type SurfaceHit = { id: string; position: number[] };
export type SurfaceRay = {
  origin: number[];
  direction: number[];
  includeIds?: string[];
  excludeIds?: string[];
};
export type SurfaceQuery = (
  ray: SurfaceRay,
  excluded?: ReadonlySet<string>,
) => SurfaceHit | null;
// Filter in the SDK before nearest-hit selection. Advancing past self hits would
// incorrectly skip a support triangle coincident with the moving model's bottom.
export function surfaceQuery(
  scene: Scene,
  pick: (ray: SurfaceRay) => SurfaceHit | null,
): SurfaceQuery {
  const allowed = new Set(
    scene.nodes
      .filter((n) => n.assetId && !inheritedFlag(scene, n.id, "hidden"))
      .map((n) => n.id),
  );
  return (ray, excluded = new Set()) => {
    if (!allowed.size) return null;
    const hit = pick({
      ...ray,
      includeIds: [...allowed],
      excludeIds: [...excluded],
    });
    return hit &&
      allowed.has(hit.id) &&
      !excluded.has(hit.id) &&
      hit.position.every(Number.isFinite)
      ? hit
      : null;
  };
}
function worldBox(points: Vec[]): Bounds {
  return {
    minimum: [0, 1, 2].map((k) => Math.min(...points.map((p) => p[k]))),
    maximum: [0, 1, 2].map((k) => Math.max(...points.map((p) => p[k]))),
  };
}
function modelBoxes(scene: Scene, assets: AssetBounds): Map<string, Bounds> {
  const worlds = worldMatrices(scene),
    result = new Map<string, Bounds>();
  for (const n of scene.nodes)
    if (n.assetId && assets[n.assetId])
      result.set(
        n.id,
        worldBox(
          boundsCorners(assets[n.assetId]).map((p) =>
            transform(worlds.get(n.id)!, p),
          ),
        ),
      );
  return result;
}
// Sample real triangles, not bounding-box roofs. Also probe the overlap with
// each candidate so a narrow pedestal between the regular probes is considered.
function supportHeight(
  box: Bounds,
  ceiling: number,
  boxes: Map<string, Bounds>,
  query: SurfaceQuery,
  excluded: ReadonlySet<string>,
): number {
  let height = 0;
  const probes = new Map<string, [number, number]>();
  function patch(x0: number, x1: number, z0: number, z1: number) {
    if (x0 > x1 || z0 > z1) return;
    for (const u of [0, 0.5, 1])
      for (const v of [0, 0.5, 1]) {
        const x = x0 + (x1 - x0) * u,
          z = z0 + (z1 - z0) * v;
        probes.set(`${x},${z}`, [x, z]);
      }
  }
  for (const [id, b] of boxes)
    if (
      !excluded.has(id) &&
      b.minimum[1] <= ceiling + 0.002 &&
      b.maximum[1] >= 0
    ) {
      patch(
        Math.max(box.minimum[0], b.minimum[0]),
        Math.min(box.maximum[0], b.maximum[0]),
        Math.max(box.minimum[2], b.minimum[2]),
        Math.min(box.maximum[2], b.maximum[2]),
      );
    }
  for (const [x, z] of probes.values()) {
    const hit = query(
      { origin: [x, ceiling + 0.002, z], direction: [0, -1, 0] },
      excluded,
    );
    if (hit && hit.position[1] <= ceiling + 0.003)
      height = Math.max(height, hit.position[1]);
  }
  return height;
}
export const gridSteps = [0.1, 0.25, 0.5, 1, 2, 5] as const;
export function placementAt(
  p: Point,
  camera: Camera,
  size: Size,
  bounds: Bounds,
  snap = true,
  step = 1,
  surface?: { scene: Scene; assets: AssetBounds; query: SurfaceQuery },
): Transform | null {
  if (
    ![
      p.x,
      p.y,
      size.width,
      size.height,
      ...bounds.minimum,
      ...bounds.maximum,
    ].every(Number.isFinite) ||
    size.width <= 0 ||
    size.height <= 0 ||
    p.x < 0 ||
    p.y < 0 ||
    p.x > size.width ||
    p.y > size.height ||
    !Number.isFinite(step) ||
    step <= 0
  )
    return null;
  const ray = rayAt(p, camera, size),
    dy = ray.direction[1];
  const modelHit = surface?.query(ray);
  let hit = modelHit?.position;
  const groundT = Math.abs(dy) < 1e-6 ? -1 : -ray.origin[1] / dy;
  if (groundT >= 0 && Number.isFinite(groundT)) {
    const ground = add(ray.origin, mul(ray.direction, groundT));
    if (
      !hit ||
      Math.hypot(...ground.map((v, k) => v - ray.origin[k])) <
        Math.hypot(...hit.map((v, k) => v - ray.origin[k]))
    )
      hit = ground;
  }
  if (!hit || !project(hit, camera, size)) return null;
  const result = identity();
  result.position = [
    snap ? Math.floor(hit[0] / step + 0.5) * step : hit[0],
    0,
    snap ? Math.floor(hit[2] / step + 0.5) * step : hit[2],
  ];
  let support = 0;
  if (surface) {
    const boxes = modelBoxes(surface.scene, surface.assets);
    const footprint: Bounds = {
      minimum: bounds.minimum.map((v, k) => v + result.position[k]),
      maximum: bounds.maximum.map((v, k) => v + result.position[k]),
    };
    support = supportHeight(
      footprint,
      Math.max(0, ...[...boxes.values()].map((b) => b.maximum[1])),
      boxes,
      surface.query,
      new Set(),
    );
  }
  result.position[1] = support - bounds.minimum[1];
  if (Math.abs(result.position[1]) < 1e-6) result.position[1] = 0;
  return result;
}
export function groundedTransform(
  scene: Scene,
  id: string,
  assets: AssetBounds,
  query?: SurfaceQuery,
): Transform | null {
  const root = scene.nodes.find((n) => n.id === id);
  if (!root) return null;
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of scene.nodes)
      if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) {
        ids.add(n.id);
        changed = true;
      }
  }
  const worlds = worldMatrices(scene);
  let minimum = Infinity;
  for (const n of scene.nodes)
    if (ids.has(n.id) && n.assetId) {
      if (!assets[n.assetId]) return null;
      for (const p of boundsCorners(assets[n.assetId]))
        minimum = Math.min(minimum, transform(worlds.get(n.id)!, p)[1]);
    }
  if (!Number.isFinite(minimum)) return null;
  const parent = root.parentId
      ? worlds.get(root.parentId)!
      : localMatrix(identity()),
    inv = inverse(parent);
  if (!inv) return null;
  let distance = -minimum;
  if (query) {
    const boxes = modelBoxes(scene, assets);
    for (const id of ids) {
      const box = boxes.get(id);
      if (box)
        distance = Math.max(
          distance,
          supportHeight(box, box.minimum[1], boxes, query, ids) -
            box.minimum[1],
        );
    }
  }
  const delta = transform(inv, [0, distance, 0], 0),
    t = structuredClone(root.transform);
  t.position = t.position.map((v, k) =>
    Math.abs(v + delta[k]) < 1e-6 ? 0 : v + delta[k],
  );
  if (Math.abs(distance) < 1e-6) return structuredClone(root.transform);
  return t;
}
