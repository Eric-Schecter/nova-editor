import type { Scene } from "../../scene-schema/index";
import {
  defaultWorld,
  validateWorld,
  type WorldSettings,
} from "../../scene-schema/world";
import { linearColor } from "./lighting";
export { defaultWorld, validateWorld, type WorldSettings };
export function environmentSettings(world: WorldSettings) {
  const w = validateWorld(world);
  return {
    rotation: w.environment.rotation,
    intensity: w.environment.intensity,
    backgroundIntensity: w.environment.backgroundIntensity,
    showBackground: w.background.mode === "environment",
    fogMode: { none: 0, linear: 1, exp2: 2 }[w.fog.mode],
    fogColor: linearColor(w.fog.color),
    fogNear: w.fog.near,
    fogFar: w.fog.far,
    fogDensity: w.fog.density,
  };
}
export function projectPaths(scene: Scene) {
  return [
    ...new Set([
      ...Object.values(scene.assets).map((a) => a.path),
      ...(scene.world?.environment.map ? [scene.world.environment.map] : []),
    ]),
  ];
}
export function validateEnvironmentBytes(bytes: Uint8Array) {
  if (bytes.length < 160 || bytes.length > 128 * 1024 * 1024)
    throw Error("Invalid .nenv size");
  const magic = new TextDecoder().decode(bytes.slice(0, 8)),
    v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    second = magic === "NOVENV02";
  if (!second && magic !== "NOVENV01")
    throw Error("请选择 Nova 预处理的 .nenv 贴图");
  if (second && bytes.length < 168) throw Error("Truncated environment header");
  const size = (n: number, levels: number) => {
    if (
      !Number.isInteger(n) ||
      n < 1 ||
      n > 1024 ||
      n & (n - 1) ||
      levels !== Math.log2(n) + 1
    )
      throw Error("Invalid environment mip chain");
    let sum = 0;
    for (; n >= 1; n /= 2) sum += n * n * 48;
    return sum;
  };
  const header = second ? 168 : 160,
    expected =
      header +
      size(v.getUint32(8, true), v.getUint32(12, true)) +
      (second ? size(v.getUint32(160, true), v.getUint32(164, true)) : 0);
  if (expected !== bytes.length)
    throw Error("Environment payload size mismatch");
  for (let k = 0; k < 36; k++)
    if (!Number.isFinite(v.getFloat32(16 + k * 4, true)))
      throw Error("Invalid irradiance");
  for (let k = header; k < bytes.length; k += 2)
    if ((v.getUint16(k, true) & 0x7c00) === 0x7c00)
      throw Error("Invalid environment pixel");
}
export function fogAmount(depth: number, world: WorldSettings) {
  const f = world.fog,
    d = Math.max(0, depth);
  return f.mode === "none"
    ? 0
    : f.mode === "linear"
      ? Math.min(1, Math.max(0, (d - f.near) / (f.far - f.near)))
      : 1 - Math.exp(-d * d * f.density * f.density);
}
