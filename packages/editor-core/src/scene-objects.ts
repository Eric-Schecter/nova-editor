import {
  identity,
  type Scene,
  type SceneNode,
  type CameraComponent,
} from "../../scene-schema/index";
import {
  localMatrix,
  multiply,
  worldMatrices,
} from "../../scene-schema/transforms";
import { decomposeTRS, assertEditable, inheritedFlag } from "./hierarchy";
import {
  cameraFrame,
  inverse,
  cameraOrientation,
  cameraTangent,
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
        Math.min(80, 2 * c.distance * cameraTangent(c)),
      ),
      exposure: c.exposure,
      primary: false,
      ...(c.verticalFov !== undefined
        ? {
            verticalFov: c.verticalFov,
            nearPlane: c.nearPlane ?? 0.01,
            farPlane: c.farPlane ?? 200,
          }
        : {}),
    },
  };
}
export function createLight(
  id: string,
  type: "directional" | "point" | "spot" = "directional",
): SceneNode {
  const c: Camera = {
    yaw: (Math.atan2(-1, 2) * 180) / Math.PI,
    pitch: (Math.atan2(1.6, Math.sqrt(5)) * 180) / Math.PI,
    distance: 5,
    exposure: 1,
  };
  return {
    id,
    parentId: null,
    name:
      type === "directional"
        ? "Directional light"
        : type === "point"
          ? "Point light"
          : "Spot light",
    transform: viewTransform(c),
    light: {
      type,
      range: 10,
      innerConeAngle: 0.35,
      outerConeAngle: 0.6,
      color: [1, 1, 1],
      intensity: 3.5,
      shadows: type === "directional",
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
  if (kind === "light") {
    scene.schemaVersion = Math.max(
      6,
      scene.schemaVersion,
    ) as Scene["schemaVersion"];
    node.light!.active = enabled;
    return;
  }
  for (const n of scene.nodes) {
    if (kind === "camera" && n.camera && (n.id === id || enabled))
      n.camera.primary = enabled && n.id === id;
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
    angles = anglesFromFrame(m),
    c = n.camera!,
    verticalFov = c.verticalFov ?? 45,
    distance =
      c.projection === "orthographic"
        ? c.orthographicSize / (2 * Math.tan((verticalFov * Math.PI) / 360))
        : c.focusDistance;
  const result: Camera = {
    ...angles,
    distance,
    verticalFov,
    nearPlane: c.nearPlane ?? 0.01,
    farPlane: c.farPlane ?? 200,
    exposure: c.exposure,
    orthographic: c.projection === "orthographic",
    target: add(m.slice(12, 15), mul(norm(m.slice(8, 11)), -distance)),
  };
  return result;
}
export function sceneLights(scene: Scene) {
  return scene.nodes
    .filter((n) => n.light)
    .map((node) => {
      const m = objectFrame(scene, node.id),
        l = node.light!;
      return {
        id: node.id,
        type: l.type,
        enabled: l.active && !inheritedFlag(scene, node.id, "hidden"),
        color: [...l.color],
        intensity: l.intensity,
        position: m.slice(12, 15),
        direction: mul(norm(m.slice(8, 11)), l.type === "spot" ? -1 : 1),
        range: l.range ?? 0,
        innerConeAngle: l.innerConeAngle ?? 0.35,
        outerConeAngle: l.outerConeAngle ?? 0.6,
        castShadow: l.shadows,
        shadowSoftness: l.softness,
      };
    });
}
export function sceneDirectional(scene: Scene) {
  const node = scene.nodes.find((n) => n.light);
  if (!node) return null;
  const hidden = !node.light!.active || inheritedFlag(scene, node.id, "hidden"),
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
  assertEditable(scene, [id], true);
  const n = scene.nodes.find((n) => n.id === id)!;
  if (!n.camera) throw Error("请选择相机");
  const pose = viewTransform(c);
  let position = pose.position,
    rotation = pose.rotation;
  if (n.parentId) {
    const parentInverse = inverse(worldMatrices(scene).get(n.parentId)!);
    if (!parentInverse) throw Error("父节点缩放不可逆");
    position = transform(parentInverse, position);
    const parentRotation = objectFrame(scene, n.parentId);
    parentRotation.splice(12, 3, 0, 0, 0);
    rotation = decomposeTRS(
      multiply(
        inverse(parentRotation)!,
        localMatrix({ ...identity(), rotation }),
      ),
    ).rotation;
  }
  n.transform = { ...n.transform, position, rotation };
  n.camera.projection = c.orthographic ? "orthographic" : "perspective";
  n.camera.focusDistance = Math.max(0.05, Math.min(100, c.distance));
  n.camera.orthographicSize = Math.max(
    0.05,
    Math.min(80, 2 * c.distance * cameraTangent(c)),
  );
  n.camera.exposure = c.exposure;
  applyCameraLens(scene, id, {
    ...n.camera,
    verticalFov: c.verticalFov ?? 45,
    nearPlane: c.nearPlane ?? 0.01,
    farPlane: c.farPlane ?? 200,
  });
}
export function aimObject(
  scene: Scene,
  id: string,
  yaw: number,
  pitch: number,
  roll = 0,
) {
  if (
    ![yaw, pitch, roll].every(Number.isFinite) ||
    Math.abs(yaw) > 180 ||
    Math.abs(pitch) > 90 ||
    Math.abs(roll) > 180
  )
    throw Error("无效朝向");
  assertEditable(scene, [id], true);
  scene.nodes.find((n) => n.id === id)!.transform.rotation = cameraOrientation({
    yaw,
    pitch,
    roll,
  });
}
export function aimLightAt(scene: Scene, id: string, target: Vec) {
  const node = scene.nodes.find((n) => n.id === id);
  if (!node?.light || node.light.type === "point") throw Error("请选择方向光或聚光灯");
  const origin = objectFrame(scene, id).slice(12, 15);
  const delta = origin.map((v, axis) => v - target[axis]);
  const parent = node.parentId ? inverse(objectFrame(scene, node.parentId)) : null;
  const [x, y, z] = parent ? transform(parent, delta, 0) : delta;
  if (Math.hypot(x, y, z) < 1e-6) throw Error("目标点与光源重合");
  aimObject(scene, id, Math.atan2(x, z) * 180 / Math.PI,
    Math.atan2(y, Math.hypot(x, z)) * 180 / Math.PI);
}

export function anglesFromFrame(m: number[]) {
  const back = norm(m.slice(8, 11)),
    right = norm(m.slice(0, 3)),
    pole = Math.hypot(back[0], back[2]) < 1e-6;
  const yaw =
      ((pole ? Math.atan2(-right[2], right[0]) : Math.atan2(back[0], back[2])) *
        180) /
      Math.PI,
    pitch = pole
      ? back[1] > 0
        ? 90
        : -90
      : (Math.asin(Math.max(-1, Math.min(1, back[1]))) * 180) / Math.PI,
    base = cameraFrame({ yaw, pitch, distance: 1, exposure: 1 }),
    roll =
      (Math.atan2(dot(right, base.up), dot(right, base.right)) * 180) / Math.PI;
  return { yaw, pitch, roll };
}
export function localAim(n: SceneNode) {
  return anglesFromFrame(
    localMatrix({ ...identity(), rotation: n.transform.rotation }),
  );
}
export function applyCameraLens(
  scene: Scene,
  id: string,
  value: CameraComponent,
) {
  assertEditable(scene, [id]);
  const node = scene.nodes.find((n) => n.id === id)!;
  if (!node.camera) throw Error("请选择相机");
  node.camera = {
    ...value,
    verticalFov: value.verticalFov ?? 45,
    nearPlane: value.nearPlane ?? 0.01,
    farPlane: value.farPlane ?? 200,
  };
  scene.schemaVersion = Math.max(
    5,
    scene.schemaVersion,
  ) as Scene["schemaVersion"];
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
              : Math.tan(((n.camera.verticalFov ?? 45) * Math.PI) / 360) * d,
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
        const light = n.light!,
          radius = light.range ?? 0;
        if (radius > 0 && light.type === "point") {
          for (let axis = 0; axis < 3; axis++)
            for (let i = 0; i < 32; i++) {
              const point = (a: number) => {
                const p = [0, 0, 0];
                p[(axis + 1) % 3] = Math.cos(a) * radius;
                p[(axis + 2) % 3] = Math.sin(a) * radius;
                return p;
              };
              local.push([
                point((i * Math.PI) / 16),
                point(((i + 1) * Math.PI) / 16),
              ]);
            }
        }
        if (light.type === "spot") {
          const d = radius > 0 ? radius : 2;
          for (const angle of [
            light.innerConeAngle ?? 0.35,
            light.outerConeAngle ?? 0.6,
          ]) {
            const r = Math.tan(angle) * d;
            const point = (a: number) => [Math.cos(a) * r, Math.sin(a) * r, -d];
            for (let i = 0; i < 32; i++)
              local.push([
                point((i * Math.PI) / 16),
                point(((i + 1) * Math.PI) / 16),
              ]);
            for (let i = 0; i < 4; i++)
              local.push([[0, 0, 0], point((i * Math.PI) / 2)]);
          }
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
