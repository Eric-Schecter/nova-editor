import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultLighting,
  lightDirection,
  linearColor,
  rendererLight,
} from "../packages/editor-core/src/lighting";
import { copyShadowSettings } from "../apps/web/public/sdk/src/Lighting.js";
const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
test("lighting angles preserve the original light and remain normalized at UI limits", () => {
  const settings = defaultLighting(),
    d = rendererLight(settings),
    n = Math.hypot(-1, 1.6, 2);
  [-1, 1.6, 2].forEach((v, k) => close(d.direction[k], v / n));
  assert.deepEqual(d.color, [1, 1, 1]);
  close(d.intensity, 3.5);
  for (const azimuth of [-180, 0, 180])
    for (const elevation of [5, 85])
      close(
        Math.hypot(...lightDirection({ ...settings, azimuth, elevation })),
        1,
      );
  settings.intensity = 1;
  assert.equal(defaultLighting().intensity, 3.5);
});
test("picked sRGB colors become linear light without gamma errors", () => {
  const rgb = linearColor("#808080");
  rgb.forEach((v) => close(v, 0.21586050011389926));
  assert.deepEqual(linearColor("#ff0000"), [1, 0, 0]);
  assert.deepEqual(linearColor("#000000"), [0, 0, 0]);
  assert.throws(() => linearColor("#fff"));
  assert.throws(() => linearColor("#zzzzzz"));
});
test("SDK shadow controls accept hard/off/soft, copy inputs, and reject invalid softness", () => {
  const config = { enabled: true, softness: 4 },
    copy = copyShadowSettings(config);
  config.softness = 0;
  assert.equal(copy.softness, 4);
  assert.deepEqual(copyShadowSettings({ enabled: false, softness: 0 }), {
    enabled: false,
    softness: 0,
  });
  for (const softness of [-1, 5, NaN, Infinity])
    assert.throws(() => copyShadowSettings({ enabled: true, softness }));
  assert.throws(() => copyShadowSettings({ enabled: "yes", softness: 1 }));
});
