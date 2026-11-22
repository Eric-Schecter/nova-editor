import { validateWorld, type WorldSettings } from "./world";
export type CameraComponent = {
  projection: "perspective" | "orthographic";
  focusDistance: number;
  orthographicSize: number;
  exposure: number;
  primary: boolean;
  verticalFov?: number;
  nearPlane?: number;
  farPlane?: number;
};
export type LightComponent = {
  type: "directional" | "point" | "spot";
  range?: number;
  innerConeAngle?: number;
  outerConeAngle?: number;
  color: number[];
  intensity: number;
  shadows: boolean;
  softness: number;
  active: boolean;
};
export type Transform = {
  position: number[];
  rotation: number[];
  scale: number[];
};
export type SceneNode = {
  id: string;
  parentId: string | null;
  name: string;
  transform: Transform;
  assetId?: string;
  camera?: CameraComponent;
  light?: LightComponent;
  hidden?: boolean;
  locked?: boolean;
  previewBehavior?: { kind: "spin" | "bob"; amount: number };
};
export type Scene = {
  schemaVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  world?: WorldSettings;
  name: string;
  nodes: SceneNode[];
  assets: Record<
    string,
    { path: string; sourceSpace?: boolean; name?: string; materialVariant?: number }
  >;
};
export const identity = (): Transform => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
});
export const emptyScene = (): Scene => ({
  schemaVersion: 2,
  name: "Untitled",
  nodes: [],
  assets: {},
});
const record = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
export function validateScene(value: unknown): Scene {
  if (
    !record(value) ||
    ![1, 2, 3, 4, 5, 6, 7].includes(value.schemaVersion as number) ||
    typeof value.name !== "string" ||
    !Array.isArray(value.nodes) ||
    !record(value.assets)
  )
    throw Error("Unsupported or malformed scene document");
  if (value.world !== undefined) {
    if ((value.schemaVersion as number) < 4)
      throw Error("World settings require scene format 4");
    validateWorld(value.world);
  }
  const assets = value.assets;
  for (const [id, asset] of Object.entries(assets)) {
    if (
      !id ||
      !record(asset) ||
      typeof asset.path !== "string" ||
      (asset.name !== undefined && typeof asset.name !== "string") ||
      (value.schemaVersion === 1 && asset.sourceSpace === true) ||
      (asset.materialVariant !== undefined &&
        (typeof asset.materialVariant !== "number" || !Number.isInteger(asset.materialVariant) ||
          asset.materialVariant < 0 || asset.materialVariant > 0xffffffff)) ||
      (asset.sourceSpace !== undefined &&
        typeof asset.sourceSpace !== "boolean") ||
      !asset.path.startsWith("assets/") ||
      asset.path.split("/").some((p) => !p || p === "." || p === "..") ||
      /[\\:\x00-\x1f]/.test(asset.path)
    )
      throw Error("Invalid asset path");
  }
  const ids = new Map<string, SceneNode>();
  for (const node of value.nodes) {
    if (
      !record(node) ||
      typeof node.id !== "string" ||
      !node.id ||
      ids.has(node.id) ||
      typeof node.name !== "string" ||
      !(node.parentId === null || typeof node.parentId === "string") ||
      !record(node.transform)
    )
      throw Error("Invalid or duplicate node");
    for (const flag of ["hidden", "locked"] as const)
      if (node[flag] !== undefined && typeof node[flag] !== "boolean")
        throw Error("Invalid node flag");
    for (const [key, size] of [
      ["position", 3],
      ["rotation", 4],
      ["scale", 3],
    ] as const) {
      const vector = node.transform[key];
      if (
        !Array.isArray(vector) ||
        vector.length !== size ||
        !vector.every((v) => typeof v === "number" && Number.isFinite(v))
      )
        throw Error("Invalid transform");
    }
    const q = node.transform.rotation as number[];
    if (Math.abs(q.reduce((s, v) => s + v * v, 0) - 1) > 0.001)
      throw Error("Rotation must be a unit quaternion");
    if (
      node.assetId !== undefined &&
      (typeof node.assetId !== "string" || !Object.hasOwn(assets, node.assetId))
    )
      throw Error("Missing asset reference");
    const range = (v: unknown, min: number, max: number) =>
      typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
    if (node.previewBehavior !== undefined) {
      const behavior = node.previewBehavior;
      if (!record(behavior) || (behavior.kind !== "spin" && behavior.kind !== "bob") ||
          !range(behavior.amount, behavior.kind === "spin" ? -360 : 0, behavior.kind === "spin" ? 360 : 10) ||
          node.camera !== undefined || node.light !== undefined)
        throw Error("Invalid preview behavior");
    }
    if (
      [node.assetId, node.camera, node.light].filter((x) => x !== undefined)
        .length > 1
    )
      throw Error("Node components are mutually exclusive");
    if (
      (node.camera !== undefined || node.light !== undefined) &&
      (value.schemaVersion as number) < 3
    )
      throw Error("Scene nodes require scene format 3");
    if (node.camera !== undefined) {
      const c = node.camera;
      if (
        !record(c) ||
        !["perspective", "orthographic"].includes(c.projection as string) ||
        !range(c.focusDistance, 0.05, 100) ||
        !range(c.orthographicSize, 0.05, 80) ||
        !range(c.exposure, 0.01, 16) ||
        typeof c.primary !== "boolean"
      )
        throw Error("Invalid camera component");
      const lens = [c.verticalFov, c.nearPlane, c.farPlane];
      if (
        lens.some((v) => v !== undefined) &&
        ((value.schemaVersion as number) < 5 ||
          !range(c.verticalFov, 1, 179) ||
          !range(c.nearPlane, 0.0001, 1e6) ||
          !range(c.farPlane, 0.0002, 1e7) ||
          (c.farPlane as number) <= (c.nearPlane as number))
      )
        throw Error("Invalid camera lens or scene format (requires v5)");
    }
    if (node.light !== undefined) {
      if (new TextEncoder().encode(node.id).length > 128)
        throw Error("Light ID exceeds 128 UTF-8 bytes");
      const l = node.light;
      if (
        !record(l) ||
        !(
          (value.schemaVersion as number) >= 6
            ? ["directional", "point", "spot"]
            : ["directional"]
        ).includes(l.type as string) ||
        !Array.isArray(l.color) ||
        l.color.length !== 3 ||
        !l.color.every((v) => range(v, 0, 1)) ||
        !range(l.intensity, 0, 100) ||
        !range(l.softness, 0, 4) ||
        typeof l.shadows !== "boolean" ||
        typeof l.active !== "boolean"
      )
        throw Error("Invalid light component");
      if (
        l.type !== "directional" &&
        (!range(l.range, 0, 1e7) ||
          ((value.schemaVersion as number) < 7 && l.shadows !== false))
      )
        throw Error(
          "Invalid range or point/spot shadows require scene format 7",
        );
      if (
        l.type === "spot" &&
        (!range(l.innerConeAngle, 0, Math.PI / 2) ||
          !range(l.outerConeAngle, 0, Math.PI / 2) ||
          (l.innerConeAngle as number) > (l.outerConeAngle as number) ||
          (l.outerConeAngle as number) >= Math.PI / 2)
      )
        throw Error("Invalid spot cone angles");
    }
    ids.set(node.id, node as SceneNode);
  }
  if (
    [...ids.values()].filter((n) => n.camera?.primary).length > 1 ||
    ((value.schemaVersion as number) < 6 &&
      [...ids.values()].filter((n) => n.light?.active).length > 1)
  )
    throw Error(
      "Only one primary camera / active directional light is supported",
    );
  if ([...ids.values()].filter((n) => n.light).length > 16)
    throw Error("Maximum 16 scene lights");
  for (const node of ids.values()) {
    const visited = new Set<string>([node.id]);
    let parent = node.parentId;
    while (parent !== null) {
      if (visited.has(parent) || !ids.has(parent))
        throw Error("Cyclic or missing parent");
      visited.add(parent);
      parent = ids.get(parent)!.parentId;
    }
  }
  return structuredClone(value) as Scene;
}
