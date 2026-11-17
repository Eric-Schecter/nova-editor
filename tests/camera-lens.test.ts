import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  validateScene,
  emptyScene,
  identity,
} from "../packages/scene-schema/index";
import {
  sceneCamera,
  localAim,
  aimObject,
  applyCameraLens,
  captureCamera,
  objectFrame,
} from "../packages/editor-core/src/scene-objects";
import {
  cameraFrame,
  cameraOrientation,
  project,
  rayAt,
  add,
  mul,
  dot,
} from "../packages/editor-core/src/viewport";
import { renderCamera } from "../packages/render-contract/bridge";
import { EditorHistory } from "../packages/editor-core/src/index";
import {
  packProject,
  unpackProject,
  validateRecovery,
} from "../packages/editor-core/src/project";
import { expandModel } from "../packages/asset-system/model";
const fixture = () =>
  JSON.parse(readFileSync("tests/fixtures/camera-lens.json", "utf8"));
const close = (a: number[], b: number[]) =>
  a.forEach((v, k) => assert.ok(Math.abs(v - b[k]) < 2e-5, `${v} != ${b[k]}`));
test("parented rolled camera maps authored orientation, FOV and clipping to the formal SDK in perspective and orthographic", () => {
  const f = fixture();
  validateScene(f.scene);
  let c = sceneCamera(f.scene)!;
  close(renderCamera(c).position, f.frame.slice(12, 15));
  close(cameraFrame(c).right, f.frame.slice(0, 3));
  close(cameraFrame(c).up, f.frame.slice(4, 7));
  assert.equal(renderCamera(c).verticalFov, 72);
  assert.equal(renderCamera(c).nearPlane, 0.25);
  assert.equal(renderCamera(c).farPlane, 1500);
  f.scene.nodes[1].camera.projection = "orthographic";
  c = sceneCamera(f.scene)!;
  assert.ok(Math.abs(renderCamera(c).orthographicHeight - 8) < 1e-6);
  close(renderCamera(c).position, f.frame.slice(12, 15));
  for (const pitch of [-90, -89.999, 0, 89.999, 90]) {
    const node = f.scene.nodes[1];
    node.parentId = null;
    node.transform.rotation = cameraOrientation({ yaw: 123, pitch, roll: 67 });
    const basis = objectFrame(f.scene, node.id),
      view = cameraFrame(sceneCamera(f.scene)!);
    close(view.right, basis.slice(0, 3));
    close(view.up, basis.slice(4, 7));
  }
});
test("FOV, roll and near/far planes agree in ray/projection helpers for both projections and clip beyond the legacy 200 units", () => {
  for (const orthographic of [false, true]) {
    const c = {
        yaw: 35,
        pitch: 20,
        roll: 40,
        distance: 10,
        exposure: 1,
        verticalFov: 90,
        nearPlane: 2,
        farPlane: 900,
        orthographic,
      },
      size = { width: 1000, height: 600 },
      f = cameraFrame(c);
    for (const p of [
      { x: 100, y: 200 },
      { x: 500, y: 300 },
      { x: 800, y: 500 },
    ]) {
      const ray = rayAt(p, c, size);
      assert.ok(dot(ray.direction, f.forward) > 0);
      const point = add(ray.origin, mul(ray.direction, 20)),
        screen = project(point, c, size)!;
      close([screen.x, screen.y], [p.x, p.y]);
    }
    assert.equal(project(add(f.eye, mul(f.forward, 1)), c, size), null);
    assert.ok(project(add(f.eye, mul(f.forward, 500)), c, size));
    assert.equal(project(add(f.eye, mul(f.forward, 901)), c, size), null);
  }
});
test("lens editing is atomic v5 history, project and recovery preserve lens and quaternion, and legacy cameras get original defaults", () => {
  const original = fixture().scene,
    h = new EditorHistory(original);
  h.commit((s) => {
    const node = s.nodes[1];
    aimObject(s, node.id, 40, -20, -55);
    applyCameraLens(s, node.id, {
      ...node.camera!,
      verticalFov: 105,
      nearPlane: 1,
      farPlane: 3500,
    });
  });
  const edited = h.scene;
  assert.equal(edited.schemaVersion, 5);
  assert.ok(Math.abs(localAim(edited.nodes[1]).roll + 55) < 1e-5);
  h.undo();
  assert.deepEqual(h.scene, original);
  h.redo();
  assert.deepEqual(h.scene, edited);
  assert.deepEqual(
    unpackProject(packProject({ scene: edited, assets: {} })).scene,
    edited,
  );
  assert.deepEqual(
    validateRecovery({
      scene: edited,
      assets: {},
      id: "lens",
      updated: 1,
      savedSnapshot: JSON.stringify(original),
    }).scene,
    edited,
  );
  const legacy = fixture().scene;
  legacy.schemaVersion = 3;
  delete legacy.nodes[1].camera.verticalFov;
  delete legacy.nodes[1].camera.nearPlane;
  delete legacy.nodes[1].camera.farPlane;
  validateScene(legacy);
  const c = renderCamera(sceneCamera(legacy)!);
  assert.equal(c.verticalFov, 45);
  assert.equal(c.nearPlane, 0.01);
  assert.equal(c.farPlane, 200);
  captureCamera(legacy, "camera", {
    yaw: 10,
    pitch: 15,
    roll: 25,
    distance: 8,
    exposure: 1,
    verticalFov: 80,
    nearPlane: 0.2,
    farPlane: 2000,
  });
  validateScene(legacy);
  assert.equal(legacy.schemaVersion, 5);
  assert.equal(legacy.nodes[1].camera.verticalFov, 80);
  for (const modify of [
    (s: any) => (s.nodes[1].camera.verticalFov = 0),
    (s: any) => (s.nodes[1].camera.nearPlane = 0),
    (s: any) => (s.nodes[1].camera.farPlane = 0.1),
    (s: any) => (s.nodes[1].camera.farPlane = Infinity),
    (s: any) => delete s.nodes[1].camera.nearPlane,
    (s: any) => (s.schemaVersion = 4),
  ]) {
    const s = fixture().scene;
    modify(s);
    assert.throws(() => validateScene(s));
  }
  const before = h.scene;
  assert.throws(() =>
    h.commit((s) => {
      s.nodes[1].camera!.farPlane = 0.01;
    }),
  );
  assert.deepEqual(h.scene, before);
});
