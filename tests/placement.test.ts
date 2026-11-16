import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  placementAt,
  groundedTransform,
} from "../packages/editor-core/src/placement";
import { boundsCorners } from "../packages/editor-core/src/navigation";
import {
  project,
  transform,
  type Camera,
} from "../packages/editor-core/src/viewport";
import {
  worldMatrices,
  eulerQuaternion,
} from "../packages/scene-schema/transforms";
import {
  identity,
  emptyScene,
  type Scene,
} from "../packages/scene-schema/index";
import { EditorHistory } from "../packages/editor-core/src/index";
const size = { width: 900, height: 600 },
  bounds = { minimum: [-0.5, -1, -0.5], maximum: [0.5, 2, 0.5] };
const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
test("placement rays agree in perspective and orthographic, snap world XZ and rest the source bounds on Y=0", () => {
  for (const orthographic of [false, true])
    for (const pitch of [35, 90, -90]) {
      const c: Camera = {
          yaw: 25,
          pitch,
          distance: 8,
          exposure: 1,
          orthographic,
        },
        p = project([1.24, 0, -2.26], c, size)!;
      const snapped = placementAt(p, c, size, bounds, true, 0.5)!;
      assert.ok(snapped);
      close(snapped.position[0], 1);
      close(snapped.position[2], -2.5);
      close(snapped.position[1] + bounds.minimum[1], 0);
      const free = placementAt(p, c, size, bounds, false, 0.5)!;
      close(free.position[0], 1.24);
      close(free.position[2], -2.26);
    }
});
test("invalid and parallel drops are rejected instead of producing arbitrary or non-finite transforms", () => {
  const c: Camera = {
    yaw: 0,
    pitch: 0,
    distance: 8,
    exposure: 1,
    orthographic: true,
  };
  assert.equal(placementAt({ x: 450, y: 300 }, c, size, bounds), null);
  for (const p of [
    { x: -1, y: 20 },
    { x: 1000, y: 20 },
    { x: NaN, y: 20 },
  ])
    assert.equal(placementAt(p, { ...c, pitch: 90 }, size, bounds), null);
  assert.equal(
    placementAt({ x: 450, y: 300 }, { ...c, pitch: 90 }, size, bounds, true, 0),
    null,
  );
});
function bottom(scene: Scene) {
  const worlds = worldMatrices(scene);
  return Math.min(
    ...boundsCorners(bounds).map((p) => transform(worlds.get("mesh")!, p)[1]),
  );
}
function hierarchy(): Scene {
  return JSON.parse(
    readFileSync("tests/fixtures/placement.scene.json", "utf8"),
  );
}

test("one-click ground moves a rotated mirrored subtree vertically in world space through a transformed parent", () => {
  for (const id of ["group", "mesh"]) {
    const scene = hierarchy(),
      before = worldMatrices(scene).get("mesh")!,
      min = bottom(scene),
      t = groundedTransform(scene, id, { asset: bounds })!;
    assert.ok(t);
    scene.nodes.find((n) => n.id === id)!.transform = t;
    close(bottom(scene), 0);
    const after = worldMatrices(scene).get("mesh")!;
    for (let k = 0; k < 16; k++) if (k !== 13) close(after[k], before[k]);
    close(after[13] - before[13], -min);
  }
});
test("grounding is one undo, no-op grounding keeps history, and singular parents / missing bounds fail safely", () => {
  const h = new EditorHistory(hierarchy()),
    before = h.scene;
  h.commit((s) => {
    s.nodes.find((n) => n.id === "group")!.transform = groundedTransform(
      s,
      "group",
      { asset: bounds },
    )!;
  });
  close(bottom(h.scene), 0);
  assert.ok(h.canUndo);
  h.commit((s) => {
    s.nodes.find((n) => n.id === "group")!.transform = groundedTransform(
      s,
      "group",
      { asset: bounds },
    )!;
  });
  h.undo();
  assert.deepEqual(h.scene, before);
  assert.equal(h.canUndo, false);
  h.redo();
  close(bottom(h.scene), 0);
  const scene = hierarchy();
  scene.nodes[0].transform.scale[1] = 0;
  assert.equal(groundedTransform(scene, "mesh", { asset: bounds }), null);
  assert.equal(groundedTransform(hierarchy(), "group", {}), null);
  assert.equal(
    groundedTransform(hierarchy(), "missing", { asset: bounds }),
    null,
  );
});
