import { renderCamera } from "../packages/render-contract/bridge";
import { copyViewCamera } from "../deps/nova/web/src/Camera.js";
const validateCamera = (camera: any) => copyViewCamera(renderCamera(camera));
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  validateScene,
  identity,
  type Scene,
} from "../packages/scene-schema/index";
import {
  sceneCamera,
  primaryCamera,
  sceneDirectional,
  createCamera,
  createLight,
  setPrimary,
  sceneGlyphs,
  captureCamera,
  aimObject,
  objectFrame,
} from "../packages/editor-core/src/scene-objects";
import { EditorHistory } from "../packages/editor-core/src/index";
import {
  duplicateNodes,
  deleteNodes,
} from "../packages/editor-core/src/hierarchy";
import {
  packProject,
  unpackProject,
} from "../packages/editor-core/src/project";
import {
  cameraFrame,
  project,
  rayAt,
  dot,
  sub,
  norm,
} from "../packages/editor-core/src/viewport";
import { eulerQuaternion } from "../packages/scene-schema/transforms";
const fixture = JSON.parse(
  readFileSync("tests/fixtures/scene-objects.json", "utf8"),
);
const scene = (): Scene => structuredClone(fixture.scene);
function close(a: number[], b: number[]) {
  a.forEach((v, k) => assert.ok(Math.abs(v - b[k]) < 1e-4, `${v} != ${b[k]}`));
}
test("camera nodes roundtrip real SDK orbit projection, authored position / direction, exposure, orthographic height and exact poles", () => {
  const s = scene();
  validateScene(s);
  const c = sceneCamera(s)!;
  validateCamera(c);
  close([c.yaw, c.pitch, c.distance, c.exposure], [25, 20, 9, 1.2]);
  close(c.target!, [0, 1, 0]);
  close(cameraFrame(c).eye, cameraFrame(fixture.inputCamera).eye);
  setPrimary(s, "camera-side", "camera");
  const ortho = sceneCamera(s)!;
  validateCamera(ortho);
  assert.equal(ortho.orthographic, true);
  assert.ok(Math.abs(2 * ortho.distance * Math.tan(Math.PI / 8) - 7) < 1e-5);
  close(cameraFrame(ortho).eye, s.nodes[1].transform.position);
  for (const pitch of [-90, 90]) {
    aimObject(s, "camera-side", 35, pitch);
    const pole = sceneCamera(s)!;
    validateCamera(pole);
    assert.ok(Math.abs(pole.pitch - pitch) < 1e-4);
    const ray = rayAt({ x: 400, y: 300 }, pole, { width: 800, height: 600 });
    assert.ok(dot(norm(sub(pole.target!, ray.origin)), ray.direction) > 0.9999);
  }
  const capture = {
    yaw: -40,
    pitch: 30,
    distance: 7,
    exposure: 2,
    target: [2, 1, -3],
    orthographic: false,
  };
  captureCamera(s, "camera-side", capture);
  const restored = sceneCamera(s)!;
  close(cameraFrame(restored).eye, cameraFrame(capture).eye);
  close(restored.target!, capture.target);
  assert.equal(restored.exposure, 2);
});
test("directional nodes preserve linear color/intensity/shadows and follow parent rotation; hiding active node disables direct light", () => {
  const s = scene();
  let light = sceneDirectional(s)!;
  close(light.direction, norm([-1, 1.6, 2]));
  close(light.color, [1, 0.7, 0.4]);
  assert.equal(light.intensity, 4);
  assert.equal(light.softness, 2);
  s.nodes[2].hidden = true;
  light = sceneDirectional(s)!;
  assert.equal(light.intensity, 0);
  assert.equal(light.shadows, false);
  delete s.nodes[2].hidden;
  s.nodes.push({
    id: "parent",
    name: "Parent",
    parentId: null,
    transform: {
      ...identity(),
      position: [4, 0, 0],
      rotation: eulerQuaternion([0, 90, 0]),
      scale: [2, 1, 3],
    },
  });
  s.nodes[2].parentId = "parent";
  light = sceneDirectional(s)!;
  close(light.direction, norm([2, 1.6, 1]));
  setPrimary(s, "fill", "light");
  assert.equal(sceneDirectional(s)!.id, "sun");
  assert.equal(s.nodes.filter((n) => n.light?.active).length, 2);
  setPrimary(s, "fill", "light", false);
  assert.equal(sceneDirectional(s)!.id, "sun");
});
test("switch, duplicate, delete, undo, archive and recovery preserve unique primary components and v3 while reading legacy v1/v2", () => {
  const h = new EditorHistory(scene());
  h.commit((s) => setPrimary(s, "camera-side", "camera"));
  assert.equal(primaryCamera(h.scene)!.id, "camera-side");
  h.undo();
  assert.equal(primaryCamera(h.scene)!.id, "camera-front");
  h.redo();
  const saved = h.scene;
  assert.deepEqual(
    unpackProject(packProject({ scene: saved, assets: {} })).scene,
    saved,
  );
  let i = 0;
  h.commit((s) =>
    duplicateNodes(s, ["camera-side", "sun"], () => `copy-${++i}`),
  );
  assert.equal(h.scene.nodes.filter((n) => n.camera?.primary).length, 1);
  assert.equal(h.scene.nodes.filter((n) => n.light?.active).length, 1);
  h.commit((s) => deleteNodes(s, ["camera-side"]));
  assert.equal(primaryCamera(h.scene), undefined);
  h.undo();
  assert.equal(primaryCamera(h.scene)!.id, "camera-side");
  for (const schemaVersion of [1, 2] as const)
    validateScene({ schemaVersion, name: "Legacy", nodes: [], assets: {} });
});
test("camera / light gizmo helper geometry follows hierarchy, is hidden with ancestors, and is never saved as model assets", () => {
  const s = scene();
  const glyphs = sceneGlyphs(s, 1.5);
  assert.equal(glyphs.length, 4);
  assert.equal(glyphs[0].lines.length, 11);
  assert.equal(glyphs[2].lines.length, 6);
  close(glyphs[2].position, s.nodes[2].transform.position);
  assert.deepEqual(s.assets, {});
  s.nodes[0].hidden = true;
  assert.equal(sceneGlyphs(s).length, 3);
  assert.equal(primaryCamera(s), undefined);
});
test("invalid components reject and camera roll is preserved without corrupting transactions", () => {
  for (const mutate of [
    (s: any) => (s.schemaVersion = 2),
    (s: any) => (s.nodes[0].camera.exposure = Infinity),
    (s: any) => (s.nodes[0].camera.projection = "fisheye"),
    (s: any) => (s.nodes[0].camera.orthographicSize = 100),
    (s: any) => (s.nodes[1].camera.primary = true),
    (s: any) => (s.nodes[3].light.active = true),
    (s: any) => (s.nodes[2].light.type = "point"),
    (s: any) => (s.nodes[2].light.color = [1, -1, 0]),
    (s: any) => (s.nodes[2].light.intensity = 101),
    (s: any) => (s.nodes[0].light = s.nodes[2].light),
  ]) {
    const s = scene();
    mutate(s);
    assert.throws(() => validateScene(s));
  }
  const s = scene();
  s.nodes[0].transform.rotation = eulerQuaternion([0, 0, 35]);
  assert.ok(Math.abs(sceneCamera(s)!.roll! - 35) < 1e-5);
  const h = new EditorHistory(scene()),
    before = h.scene;
  assert.throws(() => h.commit((s) => (s.nodes[0].camera!.focusDistance = 0)));
  assert.deepEqual(h.scene, before);
});
