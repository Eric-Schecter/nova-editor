export type LightingSettings = {
  azimuth: number;
  elevation: number;
  color: string;
  intensity: number;
  shadows: boolean;
  softness: number;
};
export function defaultLighting(): LightingSettings {
  return {
    azimuth: (Math.atan2(-1, 2) * 180) / Math.PI,
    elevation: (Math.atan2(1.6, Math.sqrt(5)) * 180) / Math.PI,
    color: "#ffffff",
    intensity: 3.5,
    shadows: true,
    softness: 1,
  };
}
export function lightDirection(s: LightingSettings): number[] {
  const a = (s.azimuth * Math.PI) / 180,
    e = (s.elevation * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
}
export function linearColor(hex: string): number[] {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw Error("光照颜色需为六位十六进制颜色");
  return [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
}
export function rendererLight(s: LightingSettings) {
  return {
    direction: lightDirection(s),
    color: linearColor(s.color),
    intensity: s.intensity,
  };
}
