import type { Camera } from "../editor-core/src/viewport";
import type { Material, TextureSlot } from "../asset-system/index";
// Translate editor navigation/project fields into public Nova APIs; no rendering implementation lives here.
export function renderCamera(camera: Camera) {
  const y = (camera.yaw * Math.PI) / 180,
    p = (camera.pitch * Math.PI) / 180,
    t = camera.target ?? [0, 0, 0];
  return {
    position: [
      t[0] + camera.distance * Math.cos(p) * Math.sin(y),
      t[1] + camera.distance * Math.sin(p),
      t[2] + camera.distance * Math.cos(p) * Math.cos(y),
    ],
    orientation: [
      -Math.cos(y / 2) * Math.sin(p / 2),
      Math.sin(y / 2) * Math.cos(p / 2),
      Math.sin(y / 2) * Math.sin(p / 2),
      Math.cos(y / 2) * Math.cos(p / 2),
    ],
    projection: camera.orthographic ? "orthographic" : "perspective",
    orthographicHeight: 2 * camera.distance * Math.tan(Math.PI / 8),
    verticalFov: 45,
    nearPlane: 0.01,
    farPlane: 200,
    exposure: camera.exposure,
  };
}
export function createEditorRenderer(raw: any) {
  const overrides: Record<string, unknown> = {
    setCamera: (camera: Camera) => raw.setViewCamera(renderCamera(camera)),
    setEnvironment: (settings: any) => {
      const { fogMode, fogColor, fogNear, fogFar, fogDensity, ...environment } =
        settings;
      if (fogMode !== undefined)
        raw.setFog({
          mode: ["off", "linear", "exp2"][fogMode],
          color: fogColor,
          nearDistance: fogNear,
          farDistance: fogFar,
          density: fogDensity,
        });
      raw.setEnvironment(environment);
    },
  };
  return new Proxy(raw, {
    get(target, key) {
      if (typeof key === "string" && key in overrides) return overrides[key];
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
export type PendingTextures = Partial<
  Record<TextureSlot, { bytes: Uint8Array; name: string } | null>
>;
export async function previewMaterial(
  raw: any,
  assetId: string,
  value: Material,
  pending: PendingTextures,
  decodeImage: (url: string) => Promise<unknown>,
) {
  if (!raw.getSceneAssetBounds(assetId)) return;
  const images: Record<string, unknown> = {};
  for (const [slot, texture] of Object.entries(pending)) {
    if (!texture) {
      images[slot + "Texture"] = null;
      continue;
    }
    const url = URL.createObjectURL(new Blob([new Uint8Array(texture.bytes)]));
    try {
      images[slot + "Texture"] = await decodeImage(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const slots = raw.getMaterials(assetId);
  for (let slot = 0; slot < slots.length; slot++) {
    const material = {
      ...slots[slot],
      ...images,
      name: value.name,
      baseColor: [...value.color, slots[slot].baseColor[3]],
      metallic: value.metallic,
      roughness: value.roughness,
      emissive: [...value.emissive],
      normalScale: value.normalScale,
      occlusionStrength: value.occlusion,
    };
    await raw.setMaterial(slot, material, assetId);
  }
  await raw.drawFrame();
}
