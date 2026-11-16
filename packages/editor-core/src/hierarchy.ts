import { identity, type Scene, type Transform } from "../../scene-schema/index";
import {
  localMatrix,
  multiply,
  worldMatrices,
} from "../../scene-schema/transforms";
import { inverse, cross, dot } from "./viewport";

export function inheritedFlag(
  scene: Scene,
  id: string,
  flag: "hidden" | "locked",
): boolean {
  const nodes = new Map(scene.nodes.map((n) => [n.id, n]));
  let n = nodes.get(id);
  while (n) {
    if (n[flag]) return true;
    n = n.parentId ? nodes.get(n.parentId) : undefined;
  }
  return false;
}
export function subtreeIds(scene: Scene, ids: readonly string[]) {
  const all = new Set(ids);
  for (let changed = true; changed; ) {
    changed = false;
    for (const n of scene.nodes)
      if (n.parentId && all.has(n.parentId) && !all.has(n.id)) {
        all.add(n.id);
        changed = true;
      }
  }
  return all;
}
export function selectionRoots(scene: Scene, ids: readonly string[]) {
  const selected = new Set(ids),
    nodes = new Map(scene.nodes.map((n) => [n.id, n]));
  for (const id of ids) if (!nodes.has(id)) throw Error("节点已不存在");
  return scene.nodes
    .filter((n) => {
      if (!selected.has(n.id)) return false;
      let p = n.parentId;
      while (p) {
        if (selected.has(p)) return false;
        p = nodes.get(p)!.parentId;
      }
      return true;
    })
    .map((n) => n.id);
}
export function assertEditable(
  scene: Scene,
  ids: readonly string[],
  descendants = false,
) {
  const all = descendants ? subtreeIds(scene, ids) : new Set(ids);
  for (const id of all) {
    if (!scene.nodes.some((n) => n.id === id)) throw Error("节点已不存在");
    if (inheritedFlag(scene, id, "locked"))
      throw Error("请先解锁节点或其父节点");
  }
}
// TRS-only documents cannot preserve shear. Reject rather than silently distort.
export function decomposeTRS(m: number[]): Transform {
  const columns = [m.slice(0, 3), m.slice(4, 7), m.slice(8, 11)];
  const scale = columns.map((c) => Math.hypot(...c));
  if (scale.some((v) => v < 1e-8)) throw Error("无法保持世界变换：存在零缩放");
  if (dot(columns[0], cross(columns[1], columns[2])) < 0) scale[0] *= -1;
  const r = columns.map((c, i) => c.map((v) => v / scale[i]));
  if (
    Math.abs(dot(r[0], r[1])) > 1e-5 ||
    Math.abs(dot(r[0], r[2])) > 1e-5 ||
    Math.abs(dot(r[1], r[2])) > 1e-5
  )
    throw Error("无法保持世界变换：非等比缩放产生了剪切，请先调整父节点缩放");
  const a = r[0][0],
    b = r[1][1],
    c = r[2][2],
    trace = a + b + c;
  let q: number[];
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [
      (r[1][2] - r[2][1]) / s,
      (r[2][0] - r[0][2]) / s,
      (r[0][1] - r[1][0]) / s,
      s / 4,
    ];
  } else if (a > b && a > c) {
    const s = Math.sqrt(1 + a - b - c) * 2;
    q = [
      s / 4,
      (r[1][0] + r[0][1]) / s,
      (r[2][0] + r[0][2]) / s,
      (r[1][2] - r[2][1]) / s,
    ];
  } else if (b > c) {
    const s = Math.sqrt(1 + b - a - c) * 2;
    q = [
      (r[1][0] + r[0][1]) / s,
      s / 4,
      (r[2][1] + r[1][2]) / s,
      (r[2][0] - r[0][2]) / s,
    ];
  } else {
    const s = Math.sqrt(1 + c - a - b) * 2;
    q = [
      (r[2][0] + r[0][2]) / s,
      (r[2][1] + r[1][2]) / s,
      s / 4,
      (r[0][1] - r[1][0]) / s,
    ];
  }
  const length = Math.hypot(...q);
  const t = {
    position: m.slice(12, 15),
    rotation: q.map((v) => v / length),
    scale,
  };
  const rebuilt = localMatrix(t);
  if (
    rebuilt.some(
      (v, i) => Math.abs(v - m[i]) > 1e-4 * Math.max(1, Math.abs(m[i])),
    )
  )
    throw Error("无法准确保持世界变换");
  return t;
}
export function reparentNodes(
  scene: Scene,
  ids: readonly string[],
  parentId: string | null,
  beforeId: string | null = null,
) {
  const roots = selectionRoots(scene, ids);
  if (!roots.length) return;
  assertEditable(scene, roots, true);
  if (parentId) assertEditable(scene, [parentId]);
  const moving = subtreeIds(scene, roots);
  if (parentId && moving.has(parentId)) throw Error("不能移动到自身或子节点内");
  if (
    beforeId &&
    (moving.has(beforeId) ||
      !scene.nodes.some((n) => n.id === beforeId && n.parentId === parentId))
  )
    throw Error("无效的排序目标");
  const worlds = worldMatrices(scene),
    transforms = new Map<string, Transform>();
  const parentInverse = parentId
    ? inverse(worlds.get(parentId)!)
    : localMatrix(identity());
  if (!parentInverse) throw Error("父节点缩放不可逆");
  for (const id of roots) {
    const n = scene.nodes.find((n) => n.id === id)!;
    if (n.parentId !== parentId)
      transforms.set(
        id,
        decomposeTRS(multiply(parentInverse, worlds.get(id)!)),
      );
  }
  const moved = scene.nodes.filter((n) => roots.includes(n.id));
  const remaining = scene.nodes.filter((n) => !roots.includes(n.id));
  for (const n of moved) {
    n.parentId = parentId;
    if (transforms.has(n.id)) n.transform = transforms.get(n.id)!;
  }
  const index = beforeId
    ? remaining.findIndex((n) => n.id === beforeId)
    : remaining.length;
  remaining.splice(index, 0, ...moved);
  scene.nodes = remaining;
}
export function deleteNodes(scene: Scene, ids: readonly string[]) {
  assertEditable(scene, ids, true);
  const all = subtreeIds(scene, ids);
  scene.nodes = scene.nodes.filter((n) => !all.has(n.id));
}
export function duplicateNodes(
  scene: Scene,
  ids: readonly string[],
  makeId: () => string,
) {
  const roots = selectionRoots(scene, ids);
  assertEditable(scene, roots, true);
  const all = subtreeIds(scene, roots),
    mapping = new Map([...all].map((id) => [id, makeId()]));
  const copies = scene.nodes
    .filter((n) => all.has(n.id))
    .map((n) => {
      const c = structuredClone(n);
      c.id = mapping.get(n.id)!;
      if (c.camera) c.camera.primary = false;
      if (c.light) c.light.active = false;
      c.parentId =
        n.parentId && mapping.has(n.parentId)
          ? mapping.get(n.parentId)!
          : n.parentId;
      if (roots.includes(n.id)) c.name += " copy";
      return c;
    });
  scene.nodes.push(...copies);
  return roots.map((id) => mapping.get(id)!);
}
export function groupNodes(scene: Scene, ids: readonly string[], id: string) {
  const roots = selectionRoots(scene, ids);
  if (!roots.length) throw Error("请先选择节点");
  assertEditable(scene, roots, true);
  const parent = scene.nodes.find((n) => n.id === roots[0])!.parentId;
  const common = roots.every(
    (id) => scene.nodes.find((n) => n.id === id)!.parentId === parent,
  )
    ? parent
    : null;
  const draft = structuredClone(scene);
  draft.nodes.push({
    id,
    name: "Group",
    parentId: common,
    transform: identity(),
  });
  reparentNodes(draft, roots, id);
  // Keep the new group where the first selected sibling was.
  const item = draft.nodes.find((n) => n.id === id)!;
  draft.nodes = draft.nodes.filter((n) => n.id !== id);
  const first = scene.nodes.findIndex((n) => n.id === roots[0]);
  draft.nodes.splice(Math.min(first, draft.nodes.length), 0, item);
  scene.nodes = draft.nodes;
  return id;
}
export function ungroupNodes(scene: Scene, ids: readonly string[]) {
  const draft = structuredClone(scene),
    selected: string[] = [];
  for (const id of selectionRoots(draft, ids)) {
    const n = draft.nodes.find((n) => n.id === id)!;
    if (n.assetId) throw Error("只有空分组节点可以解组");
    assertEditable(draft, [id], true);
    const children = draft.nodes
      .filter((c) => c.parentId === id)
      .map((c) => c.id);
    reparentNodes(draft, children, n.parentId, id);
    selected.push(...children);
    draft.nodes = draft.nodes.filter((c) => c.id !== id);
  }
  scene.nodes = draft.nodes;
  return selected;
}
export function setNodeFlag(
  scene: Scene,
  ids: readonly string[],
  flag: "hidden" | "locked",
  value: boolean,
) {
  // A node can unlock itself, but not bypass an ancestor lock.
  for (const id of ids) {
    const n = scene.nodes.find((n) => n.id === id);
    if (!n) throw Error("节点已不存在");
    if (flag === "hidden") assertEditable(scene, [id]);
    else if (n.parentId && inheritedFlag(scene, n.parentId, "locked"))
      throw Error("请先解锁父节点");
  }
  for (const n of scene.nodes) if (ids.includes(n.id)) n[flag] = value;
}
