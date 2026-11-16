import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  selectionFrame,
  selectionGizmo,
  selectionEdits,
  applySelectionEdits,
  readNodeTransform,
  writeNodeTransform,
  type TransformSpace,
} from "../packages/editor-core/src/selection-transform";
import { identity, type Scene } from "../packages/scene-schema/index";
import {
  worldMatrices,
  localMatrix,
  multiply,
  eulerQuaternion,
} from "../packages/scene-schema/transforms";
import {
  beginDrag,
  updateDrag,
  project,
  transform,
  hitGizmo,
} from "../packages/editor-core/src/viewport";
import { EditorHistory } from "../packages/editor-core/src/index";
import {
  packProject,
  unpackProject,
} from "../packages/editor-core/src/project";
const f = JSON.parse(
    readFileSync("tests/fixtures/selection-transforms.json", "utf8"),
  ),
  camera = { yaw: 25, pitch: 20, distance: 10, exposure: 1 },
  size = { width: 900, height: 700 };
function close(a: number[], b: number[]) {
  a.forEach((v, k) =>
    assert.ok(Math.abs(v - b[k]) < 1e-4, `${k}: ${v} != ${b[k]}`),
  );
}
const scene = (): Scene => structuredClone(f.scene);
test("shared dual-platform fixtures: group pivot, world/local translation, rotation and axis/uniform scale match exact world matrices", () => {
  for (const c of f.cases) {
    const base = scene(),
      s = structuredClone(base),
      frame = selectionFrame(base, f.ids, f.active, c.space, f.bounds);
    close(frame.basis.slice(12, 15), f.pivot);
    const delta = {
      position: c.position,
      rotation: eulerQuaternion(c.euler),
      scale: c.scale,
    };
    applySelectionEdits(s, selectionEdits(base, frame, delta));
    const before = worldMatrices(base),
      after = worldMatrices(s);
    for (const id of f.ids)
      close(after.get(id)!, multiply(c.operation, before.get(id)!));
  }
});
test("parent-child selections transform only roots, while mixed rotated and nonuniform parents preserve world translation and uniform scale", () => {
  const s = scene();
  s.nodes[0].transform.rotation = eulerQuaternion([0, 25, 0]);
  s.nodes[0].transform.scale = [2, 1, 3];
  s.nodes.push({
    id: "child",
    name: "Child",
    parentId: "left",
    assetId: "mesh",
    transform: { ...identity(), position: [1, 0, 0] },
  });
  const ids = ["left", "child", "right"],
    frame = selectionFrame(s, ids, "child", "local", f.bounds);
  assert.deepEqual(frame.roots, ["left", "right"]);
  const before = worldMatrices(s),
    next = structuredClone(s),
    delta = { ...identity(), position: [1, 0.5, -1] };
  applySelectionEdits(next, selectionEdits(s, frame, delta));
  assert.deepEqual(next.nodes[2].transform, s.nodes[2].transform);
  const operation = multiply(
    multiply(frame.basis, localMatrix(delta)),
    frame.inv,
  );
  for (const n of s.nodes)
    close(
      worldMatrices(next).get(n.id)!,
      multiply(operation, before.get(n.id)!),
    );
  const mixed = scene();
  mixed.nodes.push({
    id: "parent",
    name: "Parent",
    parentId: null,
    transform: {
      position: [3, 0, -1],
      rotation: eulerQuaternion([0, 30, 0]),
      scale: [2, 1, 3],
    },
  });
  mixed.nodes[0].parentId = "parent";
  for (const delta of [
    { ...identity(), position: [1, 2, 3] },
    { ...identity(), scale: [2, 2, 2] },
  ]) {
    const frame = selectionFrame(mixed, f.ids, f.active, "world", f.bounds),
      next = structuredClone(mixed);
    applySelectionEdits(next, selectionEdits(mixed, frame, delta));
    const op = multiply(multiply(frame.basis, localMatrix(delta)), frame.inv);
    for (const id of f.ids)
      close(
        worldMatrices(next).get(id)!,
        multiply(op, worldMatrices(mixed).get(id)!),
      );
  }
});
test("multi-selection ray gizmos in both projections and spaces: translation, rotation, axis scale and uniform scale", () => {
  for (const orthographic of [false, true])
    for (const space of ["world", "local"] as TransformSpace[])
      for (const mode of ["translate", "rotate", "scale"] as const) {
        const s = scene(),
          c = { ...camera, orthographic },
          selection = selectionGizmo(
            s,
            f.ids,
            f.active,
            space,
            mode,
            c,
            size,
            f.bounds,
          )!;
        assert.ok(selection);
        const g = selection.gizmo,
          k = 2,
          a = [0, 0, 0],
          b = [0, 0, 0];
        if (mode === "rotate") {
          a[0] = g.radius;
          b[0] = g.radius * Math.cos(Math.PI / 4);
          b[1] = g.radius * Math.sin(Math.PI / 4);
        } else {
          a[k] = g.radius * 0.8;
          b[k] = a[k] + (mode === "scale" ? g.radius * 0.4 : 0.5);
        }
        const screen = (v: number[]) =>
          project(transform(g.basis, v), c, size)!;
        const drag = beginDrag(g, k, screen(a))!;
        assert.ok(drag);
        const delta = updateDrag(drag, screen(b));
        if (mode === "translate") close(delta.position, [0, 0, 0.5]);
        if (mode === "scale") close(delta.scale, [1, 1, 1.4]);
        if (mode === "rotate")
          close(delta.rotation, [
            0,
            0,
            Math.sin(Math.PI / 8),
            Math.cos(Math.PI / 8),
          ]);
        const next = structuredClone(s);
        applySelectionEdits(next, selectionEdits(s, selection.frame, delta));
        if (mode === "scale") {
          const uniform = updateDrag(beginDrag(g, -1, g.pivot)!, {
            x: g.pivot.x + Math.log(2) * 100,
            y: g.pivot.y,
          });
          close(uniform.scale, [2, 2, 2]);
        }
      }
});
test("frozen group previews do not accumulate; one undo restores all, cancellation and no-op preserve redo; archive retains transforms", () => {
  const h = new EditorHistory(scene()),
    base = h.scene,
    frame = selectionFrame(base, f.ids, f.active, "world", f.bounds);
  h.beginPreview();
  for (let i = 1; i <= 40; i++)
    h.preview((s) =>
      applySelectionEdits(
        s,
        selectionEdits(base, frame, {
          ...identity(),
          position: [i / 10, 0, 0],
        }),
      ),
    );
  h.finishPreview();
  close(h.scene.nodes[0].transform.position, [2, 1, 0]);
  const edited = h.scene;
  h.undo();
  assert.deepEqual(h.scene, base);
  assert.equal(h.canUndo, false);
  h.beginPreview();
  h.preview((s) =>
    applySelectionEdits(
      s,
      selectionEdits(base, frame, { ...identity(), scale: [2, 2, 2] }),
    ),
  );
  h.cancelPreview();
  assert.deepEqual(h.scene, base);
  assert.equal(h.canRedo, true);
  h.beginPreview();
  h.preview((s) =>
    applySelectionEdits(s, selectionEdits(base, frame, identity())),
  );
  h.finishPreview();
  assert.equal(h.canRedo, true);
  h.redo();
  assert.deepEqual(h.scene, edited);
  assert.deepEqual(
    unpackProject(
      packProject({
        scene: edited,
        assets: { "assets/box.glb": new Uint8Array([1]) },
      }),
    ).scene,
    edited,
  );
});
test("locks, hidden selection, singular parents, zero scale and shear reject atomically; local/world numeric fields agree with world matrices", () => {
  const s = scene();
  s.nodes.push({
    id: "parent",
    name: "Parent",
    parentId: null,
    transform: {
      ...identity(),
      rotation: eulerQuaternion([0, 0, 90]),
      scale: [2, 2, 2],
    },
  });
  s.nodes[0].parentId = "parent";
  const world = readNodeTransform(s, "left", "world");
  world.position = [3, 4, 5];
  writeNodeTransform(s, "left", "world", world);
  close(worldMatrices(s).get("left")!.slice(12, 15), [3, 4, 5]);
  const local = readNodeTransform(s, "left", "local");
  close(local.position, [2, -1.5, 2.5]);
  for (const kind of ["locked", "hidden", "singular", "shear", "zero"]) {
    const base = scene();
    if (kind === "locked") base.nodes[1].locked = true;
    if (kind === "hidden") base.nodes[1].hidden = true;
    if (kind === "singular") {
      base.nodes.push({
        id: "parent",
        name: "Parent",
        parentId: null,
        transform: { ...identity(), scale: [0, 1, 1] },
      });
      base.nodes[0].parentId = "parent";
    }
    if (kind === "shear")
      base.nodes[1].transform.rotation = eulerQuaternion([0, 0, 35]);
    const before = structuredClone(base);
    assert.throws(() => {
      const frame = selectionFrame(base, f.ids, f.active, "world", f.bounds);
      applySelectionEdits(
        base,
        selectionEdits(base, frame, {
          ...identity(),
          scale: kind === "zero" ? [0, 1, 1] : [2, 1, 1],
        }),
      );
    });
    assert.deepEqual(base, before);
  }
  const parentLocked = scene();
  parentLocked.nodes.push({
    id: "locked-child",
    name: "Locked child",
    parentId: "left",
    locked: true,
    transform: identity(),
  });
  assert.equal(
    selectionGizmo(
      parentLocked,
      f.ids,
      f.active,
      "world",
      "translate",
      camera,
      size,
      f.bounds,
    ),
    null,
  );
});
