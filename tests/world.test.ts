import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emptyScene, validateScene } from "../packages/scene-schema/index";
import {
  defaultWorld,
  validateWorld,
  environmentSettings,
  validateEnvironmentBytes,
  fogAmount,
} from "../packages/editor-core/src/world";
import {
  packProject,
  unpackProject,
  validateRecovery,
} from "../packages/editor-core/src/project";
import { EditorHistory } from "../packages/editor-core/src/index";
const tiny = () => {
  const b = new Uint8Array(208);
  b.set(new TextEncoder().encode("NOVENV01"));
  const v = new DataView(b.buffer);
  v.setUint32(8, 1, true);
  v.setUint32(12, 1, true);
  return b;
};
test("world schema, colors, camera-depth fog and invalid settings", () => {
  const world = defaultWorld(),
    scene = emptyScene();
  scene.schemaVersion = 4;
  scene.world = world;
  validateScene(scene);
  assert.equal(environmentSettings(world).fogMode, 0);
  assert.ok(
    Math.abs(environmentSettings(world).fogColor[0] - 0.3185468) < 1e-6,
  );
  world.fog.mode = "linear";
  assert.equal(fogAmount(10, world), 0);
  assert.equal(fogAmount(30, world), 0.5);
  assert.equal(fogAmount(50, world), 1);
  world.fog.mode = "exp2";
  assert.ok(fogAmount(20, world) > fogAmount(10, world));
  for (const edit of [
    (w: any) => (w.fog.far = 0),
    (w: any) => (w.environment.map = "assets/../x.nenv"),
    (w: any) => (w.background.mode = "environment"),
    (w: any) => (w.fog.density = Infinity),
    (w: any) => (w.background.color = "red"),
  ]) {
    const bad = defaultWorld();
    edit(bad);
    assert.throws(() => validateWorld(bad));
  }
  scene.schemaVersion = 3;
  assert.throws(() => validateScene(scene));
});
test("environment payload validation including real NOVENV02 presets", () => {
  validateEnvironmentBytes(tiny());
  validateEnvironmentBytes(
    readFileSync("resources/environments/studio_small_09.nenv"),
  );
  validateEnvironmentBytes(
    readFileSync("resources/environments/venice_sunset.nenv"),
  );
  const b = tiny();
  new DataView(b.buffer).setUint16(160, 0x7c00, true);
  assert.throws(() => validateEnvironmentBytes(b));
  assert.throws(() => validateEnvironmentBytes(tiny().slice(0, 180)));
});
test("environment bytes survive project archive, recovery, undo and redo; missing bytes fail", () => {
  const scene = emptyScene();
  scene.schemaVersion = 4;
  scene.world = defaultWorld();
  scene.world.environment.map = "assets/env.nenv";
  scene.world.environment.name = "Tiny";
  scene.world.background.mode = "environment";
  const assets = { "assets/env.nenv": tiny() };
  const restored = unpackProject(packProject({ scene, assets }));
  assert.deepEqual(restored.scene, scene);
  assert.deepEqual(restored.assets, assets);
  assert.throws(() => packProject({ scene, assets: {} }));
  const history = new EditorHistory(scene);
  history.commit((s) => {
    s.world!.fog.mode = "linear";
  });
  history.undo();
  assert.equal(history.scene.world!.fog.mode, "none");
  history.redo();
  assert.equal(history.scene.world!.fog.mode, "linear");
  assert.equal(
    validateRecovery({
      ...restored,
      id: "env",
      updated: 1,
      savedSnapshot: JSON.stringify(scene),
    }).scene.world!.environment.map,
    "assets/env.nenv",
  );
});
