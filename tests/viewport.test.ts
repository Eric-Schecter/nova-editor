import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { identity, emptyScene } from "../packages/scene-schema/index";
import { EditorHistory } from "../packages/editor-core/src/index";
import {
  gizmoFor,
  beginDrag,
  updateDrag,
  project,
  transform,
  hitGizmo,
} from "../packages/editor-core/src/viewport";
const camera = { yaw: 25, pitch: 20, distance: 8, exposure: 1 },
  size = { width: 900, height: 700 };
const scene = () => ({
  ...emptyScene(),
  nodes: [{ id: "one", parentId: null, name: "One", transform: identity() }],
});
const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-4, `${a} != ${b}`);
function screen(g: NonNullable<ReturnType<typeof gizmoFor>>, v: number[]) {
  return project(transform(g.basis, v), camera, size)!;
}
test("all three translation axes move independently and hit their projected handles", () => {
  for (let k = 0; k < 3; k++) {
    const g = gizmoFor(scene(), "one", "translate", camera, size)!,
      a = [0, 0, 0],
      b = [0, 0, 0];
    a[k] = g.radius * 0.8;
    b[k] = a[k] + 0.5;
    const start = screen(g, a),
      drag = beginDrag(g, k, start)!;
    assert.equal(hitGizmo(g, start), k);
    const t = updateDrag(drag, screen(g, b));
    for (let i = 0; i < 3; i++) close(t.position[i], i === k ? 0.5 : 0);
  }
});
test("local scale and rotation use ray constraints, including a nonuniform parent", () => {
  for (const fixture of [
    scene(),
    JSON.parse(readFileSync("tests/fixtures/transforms.json", "utf8")),
  ]) {
    const id = fixture.nodes.at(-1).id;
    for (let k = 0; k < 3; k++) {
      const s = gizmoFor(fixture, id, "scale", camera, size)!,
        a = [0, 0, 0],
        b = [0, 0, 0];
      a[k] = s.radius * 0.8;
      b[k] = s.radius * 1.2;
      const drag = beginDrag(s, k, screen(s, a))!,
        t = updateDrag(drag, screen(s, b));
      close(t.scale[k], 1.4);
      const g = gizmoFor(fixture, id, "rotate", camera, size)!,
        u = [0, 0, 0],
        v = [0, 0, 0];
      u[(k + 1) % 3] = g.radius;
      v[(k + 1) % 3] = Math.cos(Math.PI / 4) * g.radius;
      v[(k + 2) % 3] = Math.sin(Math.PI / 4) * g.radius;
      const rotation = updateDrag(
        beginDrag(g, k, screen(g, u))!,
        screen(g, v),
      ).rotation;
      close(Math.abs(rotation[k]), Math.sin(Math.PI / 8));
      close(Math.abs(rotation[3]), Math.cos(Math.PI / 8));
    }
  }
});
test("free translation, uniform scale and singular parents have defined behavior", () => {
  const g = gizmoFor(scene(), "one", "translate", camera, size)!,
    d = beginDrag(g, -1, g.pivot)!;
  assert.ok(
    updateDrag(d, { x: g.pivot.x + 50, y: g.pivot.y }).position.some(
      (v) => Math.abs(v) > 0.01,
    ),
  );
  const s = gizmoFor(scene(), "one", "scale", camera, size)!,
    t = updateDrag(beginDrag(s, -1, s.pivot)!, {
      x: s.pivot.x + Math.log(2) * 100,
      y: s.pivot.y,
    });
  t.scale.forEach((v) => close(v, 2));
  const bad = scene();
  bad.nodes[0].transform.scale = [0, 1, 1];
  bad.nodes.push({
    id: "child",
    parentId: "one" as any,
    name: "Child",
    transform: identity(),
  });
  assert.equal(gizmoFor(bad, "child", "translate", camera, size), null);
});
test("drag previews commit once, cancel restores exactly, and no-op keeps redo", () => {
  const h = new EditorHistory(scene());
  h.beginPreview();
  for (let i = 1; i <= 50; i++)
    h.preview((s) => (s.nodes[0].transform.position[0] = i));
  h.finishPreview();
  assert.equal(h.scene.nodes[0].transform.position[0], 50);
  h.undo();
  assert.equal(h.scene.nodes[0].transform.position[0], 0);
  assert.equal(h.canUndo, false);
  h.beginPreview();
  h.preview((s) => (s.nodes[0].transform.scale[1] = 9));
  h.cancelPreview();
  assert.equal(h.scene.nodes[0].transform.scale[1], 1);
  assert.equal(h.canRedo, true);
  h.beginPreview();
  h.finishPreview();
  assert.equal(h.canRedo, true);
});

test("position snapping aligns the moved axis to the world grid and preserves untouched axes", () => {
  const s = scene();
  s.nodes[0].transform.position = [.31, .22, .17];
  const g = gizmoFor(s, "one", "translate", camera, size)!;
  const start = [g.radius * .8, 0, 0];
  const drag = beginDrag(g, 0, screen(g, start))!;
  const end = screen(g, [start[0] + .22, 0, 0]);
  const world = updateDrag(drag, end, true, .5, true);
  const local = updateDrag(drag, end, true, .5, false);
  close(world.position[0], .5);
  close(world.position[1], .22);
  close(world.position[2], .17);
  close(local.position[0], .31);
});
