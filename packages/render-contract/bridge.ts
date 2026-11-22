import {
  cameraFrame,
  cameraOrientation,
  cameraTangent,
} from "../editor-core/src/viewport";
import type { Camera } from "../editor-core/src/viewport";
import type { Material, TextureSlot } from "../asset-system/index";
// Translate editor navigation/project fields into public Nova APIs; no rendering implementation lives here.
export function renderCamera(camera: Camera) {
  return {
    position: cameraFrame(camera).eye,
    orientation: cameraOrientation(camera),
    projection: camera.orthographic ? "orthographic" : "perspective",
    orthographicHeight: 2 * camera.distance * cameraTangent(camera),
    verticalFov: camera.verticalFov ?? 45,
    nearPlane: camera.nearPlane ?? 0.01,
    farPlane: camera.farPlane ?? 200,
    exposure: camera.exposure,
  };
}
export function createEditorRenderer(raw: any, onRendered?: () => void) {
  const overrides: Record<string, unknown> = {
    drawFrame: async () => {
      const result = await raw.drawFrame();
      if (result === "rendered") onRendered?.();
      return result;
    },
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
      baseColor: [...value.color, value.opacity],
      alphaMode: value.alphaMode,
      alphaCutoff: value.alphaCutoff,
      doubleSided: value.doubleSided,
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
