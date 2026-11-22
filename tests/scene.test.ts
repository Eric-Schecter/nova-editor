import { previewWorldMatrices } from "../packages/editor-core/src/scene-preview";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateScene, identity } from "../packages/scene-schema/index";
import {
  EditorHistory,
  removeSubtree,
} from "../packages/editor-core/src/index";
const fixture = () =>
  JSON.parse(readFileSync("tests/fixtures/valid.scene.json", "utf8"));
test("shared fixtures accept valid hierarchy and reject cycles", () => {
  assert.equal(validateScene(fixture()).nodes.length, 2);
  assert.throws(() =>
    validateScene(
      JSON.parse(readFileSync("tests/fixtures/cycle.scene.json", "utf8")),
    ),
  );
});
test("reject dangerous paths, duplicate IDs, missing parent, invalid transform and future format", () => {
  for (const edit of [
    (s: any) => (s.assets.mesh.path = "assets/../secret"),
    (s: any) => (s.assets.mesh.path = "assets/a\\b"),
    (s: any) => (s.nodes[1].id = "root"),
    (s: any) => (s.nodes[1].parentId = "absent"),
    (s: any) => (s.nodes[1].assetId = "absent"),
    (s: any) => (s.nodes[0].transform.position[0] = Infinity),
    (s: any) => (s.nodes[0].transform.rotation = [0, 0, 0, 0]),
    (s: any) => (s.schemaVersion = 8),
  ]) {
    const s = fixture();
    edit(s);
    assert.throws(() => validateScene(s));
  }
});
test("delete hierarchy is atomic, undo restores, branched history discards redo", () => {
  const h = new EditorHistory(fixture());
  h.commit((s) => removeSubtree(s, "root"));
  assert.equal(h.scene.nodes.length, 0);
  h.undo();
  assert.equal(h.scene.nodes.length, 2);
  h.redo();
  h.undo();
  h.commit((s) =>
    s.nodes.push({
      id: "new",
      parentId: null,
      name: "New",
      transform: identity(),
    }),
  );
  assert.equal(h.canRedo, false);
});
test("failed edit and external mutation cannot corrupt history", () => {
  const h = new EditorHistory(fixture());
  assert.throws(() => h.commit((s) => (s.nodes[0].parentId = "child")));
  assert.equal(h.canUndo, false);
  const s = h.scene;
  s.nodes = [];
  assert.equal(h.scene.nodes.length, 2);
});

test("world transforms inherit rotated, non-uniformly scaled parents", async () => {
  const { worldMatrices } = await import("../packages/scene-schema/transforms");
  const s = validateScene(
      JSON.parse(readFileSync("tests/fixtures/transforms.json", "utf8")),
    ),
    m = worldMatrices(s).get("child")!;
  for (const [i, value] of [
    [12, 2],
    [13, 2],
    [14, 0],
    [0, 0],
    [1, 2],
    [4, -3],
    [5, 0],
  ])
    assert.ok(Math.abs(m[i] - value) < 1e-5, `matrix[${i}]`);
});
test("Euler XYZ rotation roundtrips through quaternion, including mirrored scale", async () => {
  const { eulerQuaternion, quaternionEuler, localMatrix } = await import(
    "../packages/scene-schema/transforms"
  );
  for (const angles of [
    [30, 40, -20],
    [0, 90, 0],
    [0, 0, 180],
  ]) {
    const q = eulerQuaternion(angles),
      q2 = eulerQuaternion(quaternionEuler(q));
    assert.ok(Math.abs(q.reduce((s, v, i) => s + v * q2[i], 0)) > 0.99999);
  }
  const m = localMatrix({
    position: [1, 2, 3],
    rotation: eulerQuaternion([0, 0, 90]),
    scale: [-2, 3, 1],
  });
  assert.ok(Math.abs(m[1] + 2) < 1e-5);
  assert.ok(Math.abs(m[4] + 3) < 1e-5);
});

test("scene preview moves model descendants without changing the authored project", () => {
  const source = fixture();
  source.nodes[0].previewBehavior = { kind: "spin", amount: 90 };
  source.nodes[1].previewBehavior = { kind: "bob", amount: 2 };
  const scene = validateScene(source);
  const baseline = JSON.stringify(scene);
  const posed = previewWorldMatrices(scene, 1.25).get("child")!;
  assert.equal(posed[13], 4);
  assert.ok(Math.abs(posed[12] - (3 * Math.cos(Math.PI / 8) - Math.sin(Math.PI / 8))) < 1e-6);
  assert.equal(JSON.stringify(scene), baseline);
  assert.deepEqual(validateScene(JSON.parse(baseline)), scene);
  source.nodes[1].previewBehavior.amount = 11;
  assert.throws(() => validateScene(source));
});
