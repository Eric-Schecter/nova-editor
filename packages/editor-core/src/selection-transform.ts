import { identity, type Scene, type Transform } from "../../scene-schema/index";
import {
  localMatrix,
  multiply,
  worldMatrices,
} from "../../scene-schema/transforms";
import {
  selectionRoots,
  subtreeIds,
  assertEditable,
  inheritedFlag,
  decomposeTRS,
} from "./hierarchy";
import {
  inverse,
  transform,
  gizmoFor,
  type Mode,
  type Camera,
  type Size,
  type Gizmo,
} from "./viewport";
import { boundsCorners, type AssetBounds } from "./navigation";
export type TransformSpace = "local" | "world";
export type SelectionFrame = {
  ids: string[];
  roots: string[];
  active: string;
  basis: number[];
  inv: number[];
};
export function selectionFrame(
  scene: Scene,
  ids: string[],
  active: string,
  space: TransformSpace,
  bounds: AssetBounds = {},
): SelectionFrame {
  const unique = [...new Set(ids)];
  if (!unique.length || !unique.includes(active)) throw Error("请选择模型");
  const roots = selectionRoots(scene, unique);
  assertEditable(scene, roots, true);
  if (unique.some((id) => inheritedFlag(scene, id, "hidden")))
    throw Error("请先显示选中的节点");
  const worlds = worldMatrices(scene);
  for (const id of roots) {
    const n = scene.nodes.find((n) => n.id === id)!;
    if (n.parentId && !inverse(worlds.get(n.parentId)!))
      throw Error("父节点缩放不可逆，无法整体变换");
  }
  let pivot = worlds.get(roots[0])!.slice(12, 15);
  if (roots.length > 1) {
    const all = subtreeIds(scene, roots),
      points: number[][] = [];
    for (const n of scene.nodes)
      if (all.has(n.id) && !inheritedFlag(scene, n.id, "hidden")) {
        const b = n.assetId ? bounds[n.assetId] : null;
        if (n.camera || n.light) points.push(worlds.get(n.id)!.slice(12, 15));
        if (b)
          for (const p of boundsCorners(b))
            points.push(transform(worlds.get(n.id)!, p));
      }
    if (!points.length)
      for (const id of roots) points.push(worlds.get(id)!.slice(12, 15));
    pivot = [0, 1, 2].map(
      (k) =>
        (Math.min(...points.map((p) => p[k])) +
          Math.max(...points.map((p) => p[k]))) /
        2,
    );
  }
  let basis = localMatrix(identity());
  if (space === "local") {
    const chain = [];
    let n = scene.nodes.find((n) => n.id === active)!;
    while (n) {
      chain.unshift(n);
      n = scene.nodes.find((p) => p.id === n.parentId)!;
    }
    for (const n of chain)
      basis = multiply(
        basis,
        localMatrix({ ...identity(), rotation: n.transform.rotation }),
      );
  }
  basis.splice(12, 3, ...pivot);
  return { ids: unique, roots, active, basis, inv: inverse(basis)! };
}
export function selectionGizmo(
  scene: Scene,
  ids: string[],
  active: string | null,
  space: TransformSpace,
  mode: Mode,
  camera: Camera,
  size: Size,
  bounds: AssetBounds = {},
): { gizmo: Gizmo; frame: SelectionFrame } | null {
  if (!active) return null;
  try {
    const frame = selectionFrame(scene, ids, active, space, bounds),
      proxy: Scene = {
        schemaVersion: 2,
        name: "Selection",
        assets: {},
        nodes: [
          {
            id: "frame",
            parentId: null,
            name: "frame",
            transform: decomposeTRS(frame.basis),
          },
          {
            id: "handle",
            parentId: "frame",
            name: "handle",
            transform: identity(),
          },
        ],
      };
    const gizmo = gizmoFor(proxy, "handle", mode, camera, size);
    if (!gizmo) return null;
    gizmo.id = active;
    return { gizmo, frame };
  } catch {
    return null;
  }
}
export function selectionEdits(
  base: Scene,
  frame: SelectionFrame,
  delta: Transform,
): Record<string, Transform> {
  assertEditable(base, frame.roots, true);
  const d = localMatrix(delta),
    unit = localMatrix(identity());
  if (
    d.some((v) => !Number.isFinite(v)) ||
    delta.scale.some((v) => Math.abs(v) < 1e-6)
  )
    throw Error("缩放不能为零，变换必须为有限数值");
  const unchanged = d.every((v, k) => Math.abs(v - unit[k]) < 1e-8),
    worlds = worldMatrices(base),
    operation = multiply(multiply(frame.basis, d), frame.inv),
    result: Record<string, Transform> = {};
  for (const id of frame.roots) {
    const n = base.nodes.find((n) => n.id === id)!;
    if (unchanged) {
      result[id] = structuredClone(n.transform);
      continue;
    }
    const parent = n.parentId ? worlds.get(n.parentId)! : unit,
      inv = inverse(parent);
    if (!inv) throw Error("父节点缩放不可逆");
    try {
      result[id] = decomposeTRS(
        multiply(inv, multiply(operation, worlds.get(id)!)),
      );
    } catch {
      throw Error("此变换会产生剪切，已取消全部修改；请改用局部轴或等比缩放");
    }
  }
  return result;
}
export function applySelectionEdits(
  scene: Scene,
  edits: Record<string, Transform>,
) {
  assertEditable(scene, Object.keys(edits), true);
  for (const n of scene.nodes)
    if (edits[n.id]) n.transform = structuredClone(edits[n.id]);
}
export function readNodeTransform(
  scene: Scene,
  id: string,
  space: TransformSpace,
): Transform {
  const n = scene.nodes.find((n) => n.id === id);
  if (!n) throw Error("节点不存在");
  return space === "local"
    ? structuredClone(n.transform)
    : decomposeTRS(worldMatrices(scene).get(id)!);
}
export function writeNodeTransform(
  scene: Scene,
  id: string,
  space: TransformSpace,
  value: Transform,
) {
  assertEditable(scene, [id], true);
  const n = scene.nodes.find((n) => n.id === id)!;
  if (value.scale.some((v) => Math.abs(v) < 1e-6)) throw Error("缩放不能为零");
  let local = structuredClone(value);
  if (space === "world" && n.parentId) {
    const inv = inverse(worldMatrices(scene).get(n.parentId)!);
    if (!inv) throw Error("父节点缩放不可逆");
    local = decomposeTRS(multiply(inv, localMatrix(value)));
  }
  n.transform = local;
}
