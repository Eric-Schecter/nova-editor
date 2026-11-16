export type WorldSettings = {
  environment: {
    map: string | null;
    name: string;
    rotation: number;
    intensity: number;
    backgroundIntensity: number;
  };
  background: { mode: "color" | "environment"; color: string };
  fog: {
    mode: "none" | "linear" | "exp2";
    color: string;
    near: number;
    far: number;
    density: number;
  };
};
export const defaultWorld = (): WorldSettings => ({
  environment: {
    map: null,
    name: "",
    rotation: 0,
    intensity: 1,
    backgroundIntensity: 1,
  },
  background: { mode: "color", color: "#999999" },
  fog: { mode: "none", color: "#999999", near: 10, far: 50, density: 0.02 },
});
export function validateWorld(value: unknown): WorldSettings {
  const w = value as WorldSettings,
    range = (v: unknown, a: number, b: number) =>
      typeof v === "number" && Number.isFinite(v) && v >= a && v <= b,
    hex = (v: unknown) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
  if (!w || !w.environment || !w.background || !w.fog)
    throw Error("Invalid scene world settings");
  const e = w.environment,
    b = w.background,
    f = w.fog;
  if (
    (e.map !== null &&
      (typeof e.map !== "string" ||
        !e.map.startsWith("assets/") ||
        !e.map.endsWith(".nenv") ||
        e.map.split("/").some((p) => !p || p === "." || p === "..") ||
        /[\\:\x00-\x1f]/.test(e.map))) ||
    typeof e.name !== "string" ||
    !range(e.rotation, -180, 180) ||
    !range(e.intensity, 0, 16) ||
    !range(e.backgroundIntensity, 0, 16) ||
    !["color", "environment"].includes(b.mode) ||
    !hex(b.color) ||
    (b.mode === "environment" && !e.map) ||
    !["none", "linear", "exp2"].includes(f.mode) ||
    !hex(f.color) ||
    !range(f.near, 0, 1000) ||
    !range(f.far, 0.001, 2000) ||
    f.far <= f.near ||
    !range(f.density, 0, 1)
  )
    throw Error("Invalid environment, background or fog parameters");
  return structuredClone(w);
}
