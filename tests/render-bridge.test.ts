import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createEditorRenderer,
  renderCamera,
  previewMaterial,
} from "../packages/render-contract/bridge";
test("editor camera/fog state maps to formal APIs and retains exact pole and orthographic navigation", () => {
  let camera: any, fog: any, environment: any;
  const raw = {
    setViewCamera: (v: any) => (camera = v),
    setFog: (v: any) => (fog = v),
    setEnvironment: (v: any) => (environment = v),
    check() {
      assert.equal(this, raw);
    },
  };
  const editor = createEditorRenderer(raw);
  editor.setCamera({
    yaw: 90,
    pitch: 90,
    distance: 4,
    exposure: 2,
    target: [1, 2, 3],
    orthographic: true,
  });
  assert.ok(Math.abs(camera.position[0] - 1) < 1e-6);
  assert.equal(camera.position[1], 6);
  assert.ok(Math.abs(Math.hypot(...camera.orientation) - 1) < 1e-6);
  assert.equal(camera.projection, "orthographic");
  assert.equal(camera.exposure, 2);
  editor.setEnvironment({
    rotation: 20,
    intensity: 1,
    backgroundIntensity: 1,
    showBackground: false,
    fogMode: 2,
    fogColor: [0.2, 0.3, 0.4],
    fogNear: 3,
    fogFar: 10,
    fogDensity: 0.1,
  });
  assert.deepEqual(fog, {
    mode: "exp2",
    color: [0.2, 0.3, 0.4],
    nearDistance: 3,
    farDistance: 10,
    density: 0.1,
  });
  assert.equal(environment.rotation, 20);
  assert.equal(environment.fogMode, undefined);
  editor.check();
});
test("material authoring applies the public runtime slots while leaving immutable project persistence to editor", async () => {
  const material = {
    name: "new",
    color: [0.2, 0.3, 0.4],
    metallic: 0.8,
    roughness: 0.25,
    emissive: [0, 0, 0],
    normalScale: 0.5,
    occlusion: 0.7,
  };
  const source = [
      { name: "left", baseColor: [1, 0, 0, 1] },
      { name: "right", baseColor: [0, 0, 1, 1] },
    ],
    calls: any[] = [];
  const renderer = {
    getSceneAssetBounds: () => ({}),
    getMaterials: () => structuredClone(source),
    setMaterial: async (...args: any[]) => calls.push(args),
    drawFrame: async () => calls.push("draw"),
  };
  await previewMaterial(
    renderer,
    "box",
    material,
    { normal: null },
    async () => {
      throw Error("Unexpected image load");
    },
  );
  assert.equal(calls.length, 3);
  assert.equal(calls[1][0], 1);
  assert.equal(calls[0][2], "box");
  assert.deepEqual(calls[0][1].baseColor, [0.2, 0.3, 0.4, 1]);
  assert.equal(calls[0][1].occlusionStrength, 0.7);
  assert.equal(calls[0][1].normalTexture, null);
  assert.equal(source[0].name, "left");
});
