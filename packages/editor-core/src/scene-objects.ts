import { identity, type Scene, type SceneNode } from "../../scene-schema/index";
import {
  localMatrix,
  multiply,
  worldMatrices,
} from "../../scene-schema/transforms";
import { decomposeTRS, assertEditable, inheritedFlag } from "./hierarchy";
import { writeNodeTransform } from "./selection-transform";
import {
  cameraFrame,
  transform,
  add,
  mul,
  dot,
  norm,
  type Camera,
  type Vec,
} from "./viewport";
export function objectFrame(scene: Scene, id: string) {
  const worlds = worldMatrices(scene),
    chain: SceneNode[] = [];
  let n = scene.nodes.find((n) => n.id === id)!;
  while (n) {
    chain.unshift(n);
    n = scene.nodes.find((p) => p.id === n.parentId)!;
  }
  let m = localMatrix(identity());
  for (const n of chain)
    m = multiply(
      m,
      localMatrix({ ...identity(), rotation: n.transform.rotation }),
    );
  m.splice(12, 3, ...worlds.get(id)!.slice(12, 15));
  return m;
}
export function viewTransform(c: Camera) {
  const f = cameraFrame(c),
    back = mul(f.forward, -1);
  return decomposeTRS([...f.right, 0, ...f.up, 0, ...back, 0, ...f.eye, 1]);
}
export function createCamera(id: string, c: Camera): SceneNode {
  return {
    id,
    parentId: null,
    name: "Camera",
    transform: viewTransform(c),
    camera: {
      projection: c.orthographic ? "orthographic" : "perspective",
      focusDistance: Math.max(0.05, Math.min(100, c.distance)),
      orthographicSize: Math.max(
        0.05,
        Math.min(80, 2 * c.distance * Math.tan(Math.PI / 8)),
      ),
      exposure: c.exposure,
      primary: false,
    },
  };
}
export function createLight(id: string): SceneNode {
  const c: Camera = {
    yaw: (Math.atan2(-1, 2) * 180) / Math.PI,
    pitch: (Math.atan2(1.6, Math.sqrt(5)) * 180) / Math.PI,
    distance: 5,
    exposure: 1,
  };
  return {
    id,
    parentId: null,
    name: "Directional light",
    transform: viewTransform(c),
    light: {
      type: "directional",
      color: [1, 1, 1],
      intensity: 3.5,
      shadows: true,
      softness: 1,
      active: false,
    },
  };
}
export function setPrimary(
  scene: Scene,
  id: string,
  kind: "camera" | "light",
  enabled = true,
) {
  assertEditable(scene, [id]);
  const node = scene.nodes.find((n) => n.id === id)!;
  if (!node[kind]) throw Error("节点类型不匹配");
  for (const n of scene.nodes) {
    if (kind === "camera" && n.camera && (n.id === id || enabled))
      n.camera.primary = enabled && n.id === id;
    if (kind === "light" && n.light && (n.id === id || enabled))
      n.light.active = enabled && n.id === id;
  }
}
export function primaryCamera(scene: Scene) {
  return scene.nodes.find(
    (n) => n.camera?.primary && !inheritedFlag(scene, n.id, "hidden"),
  );
}
export function sceneCamera(scene: Scene): Camera | null {
  const n = primaryCamera(scene);
  if (!n) return null;
  const m = objectFrame(scene, n.id),
    back = norm(m.slice(8, 11)),
    right = norm(m.slice(0, 3)),
    up = norm(m.slice(4, 7)),
    pitch = (Math.asin(Math.max(-1, Math.min(1, back[1]))) * 180) / Math.PI,
    yaw =
      ((Math.hypot(back[0], back[2]) < 1e-6
        ? Math.atan2(-right[2], right[0])
        : Math.atan2(back[0], back[2])) *
        180) /
      Math.PI;
  const c = n.camera!,
    distance =
      c.projection === "orthographic"
        ? c.orthographicSize / (2 * Math.tan(Math.PI / 8))
        : c.focusDistance;
  const result: Camera = {
    yaw,
    pitch,
    distance,
    exposure: c.exposure,
    orthographic: c.projection === "orthographic",
    target: add(m.slice(12, 15), mul(back, -distance)),
  };
  if (dot(up, cameraFrame(result).up) < 0.9999)
    throw Error("当前 SDK 不支持相机滚转，请调整相机或父节点旋转");
  return result;
}
export function sceneDirectional(scene: Scene) {
  const node = scene.nodes.find((n) => n.light?.active);
  if (!node) return null;
  const hidden = inheritedFlag(scene, node.id, "hidden"),
    m = objectFrame(scene, node.id),
    l = node.light!;
  return {
    id: node.id,
    direction: norm(m.slice(8, 11)),
    color: [...l.color],
    intensity: hidden ? 0 : l.intensity,
    shadows: !hidden && l.shadows,
    softness: l.softness,
  };
}
export function captureCamera(scene: Scene, id: string, c: Camera) {
  assertEditable(scene, [id]);
  writeNodeTransform(scene, id, "world", viewTransform(c));
  const n = scene.nodes.find((n) => n.id === id)!;
  if (!n.camera) throw Error("请选择相机");
  n.camera.projection = c.orthographic ? "orthographic" : "perspective";
  n.camera.focusDistance = Math.max(0.05, Math.min(100, c.distance));
  n.camera.orthographicSize = Math.max(
    0.05,
    Math.min(80, 2 * c.distance * Math.tan(Math.PI / 8)),
  );
  n.camera.exposure = c.exposure;
}
export function aimObject(
  scene: Scene,
  id: string,
  yaw: number,
  pitch: number,
) {
  if (
    !Number.isFinite(yaw) ||
    !Number.isFinite(pitch) ||
    Math.abs(yaw) > 180 ||
    Math.abs(pitch) > 90
  )
    throw Error("无效朝向");
  assertEditable(scene, [id], true);
  const n = scene.nodes.find((n) => n.id === id)!;
  n.transform.rotation = viewTransform({
    yaw,
    pitch,
    distance: 1,
    exposure: 1,
  }).rotation;
}
export function localAim(n: SceneNode) {
  const m = localMatrix({ ...identity(), rotation: n.transform.rotation });
  return {
    yaw: (Math.atan2(m[8], m[10]) * 180) / Math.PI,
    pitch: (Math.asin(Math.max(-1, Math.min(1, m[9]))) * 180) / Math.PI,
  };
}
export type SceneGlyph = {
  id: string;
  type: "camera" | "light";
  position: Vec;
  lines: [Vec, Vec][];
  active: boolean;
};
export function sceneGlyphs(scene: Scene, aspect = 1.5): SceneGlyph[] {
  return scene.nodes
    .filter(
      (n) => (n.camera || n.light) && !inheritedFlag(scene, n.id, "hidden"),
    )
    .map((n) => {
      const m = objectFrame(scene, n.id),
        local: [Vec, Vec][] = [];
      if (n.camera) {
        const d = 0.8,
          h =
            n.camera.projection === "orthographic"
              ? 0.4
              : Math.tan(Math.PI / 8) * d,
          w = h * Math.max(0.3, Math.min(3, aspect)),
          corners = [
            [-w, -h, -d],
            [w, -h, -d],
            [w, h, -d],
            [-w, h, -d],
          ];
        for (let k = 0; k < 4; k++) {
          local.push(
            [corners[k], corners[(k + 1) % 4]],
            [[0, 0, 0], corners[k]],
          );
        }
        local.push(
          [
            [-0.15, 0.2, 0],
            [0.15, 0.2, 0],
          ],
          [
            [0.15, 0.2, 0],
            [0, 0.35, 0],
          ],
          [
            [0, 0.35, 0],
            [-0.15, 0.2, 0],
          ],
        );
      } else {
        for (let k = 0; k < 3; k++) {
          const a = [0, 0, 0],
            b = [0, 0, 0];
          a[k] = -0.2;
          b[k] = 0.2;
          local.push([a, b]);
        }
        local.push(
          [
            [0, 0, 0],
            [0, 0, -1],
          ],
          [
            [0, 0, -1],
            [0.15, 0, -0.75],
          ],
          [
            [0, 0, -1],
            [-0.15, 0, -0.75],
          ],
        );
      }
      return {
        id: n.id,
        type: n.camera ? "camera" : "light",
        position: m.slice(12, 15),
        active: !!(n.camera?.primary || n.light?.active),
        lines: local.map(
          ([a, b]) => [transform(m, a), transform(m, b)] as [Vec, Vec],
        ),
      };
    });
}
