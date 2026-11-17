import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateScene } from "../packages/scene-schema/index";
import {
  sceneLights,
  sceneGlyphs,
  setPrimary,
  applyCameraLens,
  createCamera,
} from "../packages/editor-core/src/scene-objects";
import { EditorHistory } from "../packages/editor-core/src/index";
import {
  packProject,
  unpackProject,
} from "../packages/editor-core/src/project";
const fixture = () =>
  validateScene(JSON.parse(readFileSync("tests/fixtures/lights.json", "utf8")));
test("six independent lights retain world positions, outward spot directions and unscaled range", () => {
  const s = fixture(),
    lights = sceneLights(s);
  assert.equal(lights.length, 6);
  assert(lights.every((l) => l.enabled));
  for (const l of lights) {
    assert(Math.abs(l.position[0] - 4) < 1e-6);
    assert(Math.abs(l.position[2]) < 1e-6);
    assert.equal(l.range, 10);
    if (l.type !== "point")
      assert(Math.abs(l.direction[0] - (l.type === "spot" ? -1 : 1)) < 1e-6);
  }
  const glyphs = sceneGlyphs(s);
  assert(glyphs[2].lines.length > 90);
  assert(glyphs[4].lines.length > 70);
  setPrimary(s, lights[0].id, "light", false);
  assert.equal(sceneLights(s).filter((l) => l.enabled).length, 5);
  s.nodes[0].hidden = true;
  assert(sceneLights(s).every((l) => !l.enabled));
});
test("light edits survive undo, archives and legacy inactive state; invalid edits are atomic", () => {
  const h = new EditorHistory(fixture());
  h.commit((s) => {
    s.nodes[3].light!.range = 3;
    s.nodes[5].light!.outerConeAngle = 0.9;
  });
  const edited = h.scene;
  h.undo();
  assert.equal(h.scene.nodes[3].light!.range, 10);
  h.redo();
  assert.deepEqual(h.scene, edited);
  assert.deepEqual(
    unpackProject(packProject({ scene: h.scene, assets: {} })).scene,
    edited,
  );
  for (const change of [
    (s: any) => (s.nodes[3].light.range = -1),
    (s: any) => (s.nodes[5].light.outerConeAngle = 0.1),
    (s: any) => (s.nodes[3].light.shadows = true),
  ]) {
    const before = h.scene;
    assert.throws(() => h.commit(change));
    assert.deepEqual(h.scene, before);
  }
  const legacy = validateScene(
    JSON.parse(readFileSync("tests/fixtures/scene-objects.json", "utf8")).scene,
  );
  const inactive = legacy.nodes.find((n) => n.light && !n.light.active)!;
  setPrimary(legacy, legacy.nodes.find((n) => n.light?.active)!.id, "light");
  assert.equal(legacy.schemaVersion, 6);
  assert.equal(
    legacy.nodes.find((n) => n.id === inactive.id)!.light!.active,
    false,
  );
  const c = createCamera("lens", {
    yaw: 0,
    pitch: 0,
    distance: 4,
    exposure: 1,
  });
  h.commit((s) => {
    s.nodes.push(c);
    applyCameraLens(s, c.id, c.camera!);
  });
  assert.equal(h.scene.schemaVersion, 6);
});

test("v7 point and spot shadow flags survive history, archive and independent toggles", () => {
  const s = validateScene(
    JSON.parse(readFileSync("tests/fixtures/light-shadows.json", "utf8")),
  );
  assert(sceneLights(s).every((l) => l.castShadow));
  const h = new EditorHistory(s);
  h.commit((s) => {
    s.nodes[3].light!.shadows = false;
    setPrimary(s, s.nodes[5].id, "light", false);
  });
  assert.equal(h.scene.schemaVersion, 7);
  assert(!sceneLights(h.scene)[2].castShadow);
  h.undo();
  assert.deepEqual(h.scene, s);
  h.redo();
  assert.deepEqual(
    unpackProject(packProject({ scene: h.scene, assets: {} })).scene,
    h.scene,
  );
  const legacy = { ...s, schemaVersion: 6 };
  assert.throws(() => validateScene(legacy));
});
