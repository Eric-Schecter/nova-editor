import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateScene, identity } from "../packages/scene-schema/index";
import {
  worldMatrices,
  eulerQuaternion,
  localMatrix,
} from "../packages/scene-schema/transforms";
import { EditorHistory } from "../packages/editor-core/src/index";
import {
  reparentNodes,
  groupNodes,
  ungroupNodes,
  deleteNodes,
  duplicateNodes,
  setNodeFlag,
  inheritedFlag,
  selectionRoots,
  decomposeTRS,
} from "../packages/editor-core/src/hierarchy";
import {
  packProject,
  unpackProject,
  validateRecovery,
} from "../packages/editor-core/src/project";
const fixture = () =>
  validateScene(
    JSON.parse(readFileSync("tests/fixtures/hierarchy.scene.json", "utf8")),
  );
const close = (a: number[], b: number[]) =>
  a.forEach((v, i) =>
    assert.ok(Math.abs(v - b[i]) < 1e-4, `matrix ${i}: ${v} != ${b[i]}`),
  );
test("20-node shared scene: reparent mirrored subtree preserves world, one undo restores full order", () => {
  const s = fixture(),
    h = new EditorHistory(s),
    before = worldMatrices(s);
  h.commit((d) => reparentNodes(d, ["shelf", "box"], "target"));
  for (const [id, m] of before) close(worldMatrices(h.scene).get(id)!, m);
  assert.equal(h.scene.nodes.find((n) => n.id === "shelf")!.parentId, "target");
  assert.equal(h.scene.nodes.find((n) => n.id === "box")!.parentId, "shelf");
  h.undo();
  assert.deepEqual(h.scene, s);
  assert.equal(h.canUndo, false);
  h.redo();
  assert.equal(h.scene.nodes.find((n) => n.id === "shelf")!.parentId, "target");
});
test("reject cycles, locks, singular parents and shear without changing scene or history", () => {
  for (const operation of [
    (s: ReturnType<typeof fixture>) => reparentNodes(s, ["room"], "box"),
    (s: ReturnType<typeof fixture>) => {
      s.nodes.find((n) => n.id === "target")!.transform.scale = [0, 1, 1];
      reparentNodes(s, ["box"], "target");
    },
    (s: ReturnType<typeof fixture>) => {
      s.nodes.find((n) => n.id === "target")!.transform.scale = [2, 1, 1];
      reparentNodes(s, ["box"], "target");
    },
    (s: ReturnType<typeof fixture>) => {
      s.nodes.find((n) => n.id === "box")!.locked = true;
      deleteNodes(s, ["room"]);
    },
  ]) {
    const original = fixture(),
      h = new EditorHistory(original);
    assert.throws(() => h.commit(operation));
    assert.deepEqual(h.scene, original);
    assert.equal(h.canUndo, false);
  }
});
test("TRS decomposition covers negative axes and all quaternion branches", () => {
  for (const rotation of [
    [10, 20, 30],
    [180, 0, 0],
    [0, 180, 0],
    [0, 0, 180],
    [120, -90, 70],
  ])
    for (const scale of [
      [1, 2, 3],
      [-1, 2, 3],
      [1, -2, 3],
      [1, 2, -3],
      [-1, -2, 3],
    ]) {
      const m = localMatrix({
        position: [3, -2, 9],
        rotation: eulerQuaternion(rotation),
        scale,
      });
      close(localMatrix(decomposeTRS(m)), m);
    }
});
test("group, ungroup, duplicate descendants, sibling ordering and batch delete are atomic", () => {
  const original = fixture(),
    s = fixture(),
    before = worldMatrices(s);
  groupNodes(s, ["shelf", "box", "other"], "group");
  for (const [id, m] of before) close(worldMatrices(s).get(id)!, m);
  const children = ungroupNodes(s, ["group"]);
  assert.deepEqual(children, ["shelf", "other"]);
  assert.ok(!s.nodes.some((n) => n.id === "group"));
  for (const [id, m] of before) close(worldMatrices(s).get(id)!, m);
  let i = 0;
  const ids = duplicateNodes(s, ["shelf", "box"], () => `copy-${i++}`),
    all = s.nodes.length - original.nodes.length;
  assert.equal(ids.length, 1);
  assert.equal(all, 7);
  assert.equal(selectionRoots(s, ["shelf", "box"]).length, 1);
  deleteNodes(s, ids);
  assert.equal(s.nodes.length, 20);
  reparentNodes(s, ["other"], null, "room");
  assert.equal(s.nodes[0].id, "other");
  const stable = structuredClone(s);
  assert.throws(() => ungroupNodes(s, ["room", "missing"]));
  assert.deepEqual(s, stable);
});
test("hidden and locked inherit; self unlock cannot bypass locked parent; archive preserves flags/order", () => {
  const s = fixture();
  setNodeFlag(s, ["room"], "hidden", true);
  setNodeFlag(s, ["room"], "locked", true);
  assert.equal(inheritedFlag(s, "box", "hidden"), true);
  assert.equal(inheritedFlag(s, "box", "locked"), true);
  assert.throws(() => setNodeFlag(s, ["box"], "locked", false));
  assert.throws(() => duplicateNodes(s, ["box"], () => "new"));
  setNodeFlag(s, ["room"], "locked", false);
  assert.equal(inheritedFlag(s, "box", "locked"), false);
  assert.deepEqual(
    unpackProject(packProject({ scene: s, assets: {} })).scene,
    s,
  );
  const malformed = structuredClone(s);
  (malformed.nodes[0] as any).hidden = "yes";
  assert.throws(() => validateScene(malformed));
});
test("recovery is self contained, validates baseline and missing assets, zip roundtrip preserves bytes", () => {
  const s = fixture();
  s.assets.mesh = { path: "assets/model.glb", sourceSpace: true };
  s.nodes[0].assetId = "mesh";
  const assets = {
    "assets/model.glb": new Uint8Array([103, 108, 84, 70, 2, 0, 0, 0]),
  };
  const data = unpackProject(packProject({ scene: s, assets }));
  assert.deepEqual(data.scene, s);
  assert.deepEqual(data.assets, assets);
  const r = validateRecovery({
    ...data,
    id: "session",
    updated: 123,
    savedSnapshot: JSON.stringify(fixture()),
  });
  assert.equal(r.scene.nodes.length, 20);
  assert.throws(() => validateRecovery({ ...r, assets: {} }));
  assert.throws(() => validateRecovery({ ...r, savedSnapshot: "{}" }));
  assert.throws(() => packProject({ scene: s, assets: {} }));
});
