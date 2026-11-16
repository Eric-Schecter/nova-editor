import { test } from "node:test";
import assert from "node:assert/strict";
import { surfaceQuery } from "../packages/editor-core/src/placement";
import { emptyScene, identity } from "../packages/scene-schema/index";
test("editor filters visible instances and excludes moving nodes before the public SDK query", () => {
  const scene = emptyScene();
  scene.assets = { box: { path: "box.glb" } };
  scene.nodes = [
    {
      id: "moving",
      assetId: "box",
      name: "Moving",
      parentId: null,
      transform: identity(),
    },
    {
      id: "support",
      assetId: "box",
      name: "Support",
      parentId: null,
      transform: identity(),
    },
    {
      id: "hidden",
      assetId: "box",
      name: "Hidden",
      parentId: null,
      transform: identity(),
      hidden: true,
    },
  ];
  let request: any;
  const query = surfaceQuery(scene, (ray) => {
    request = ray;
    return { id: "support", position: [1, 2, 3] };
  });
  assert.deepEqual(
    query({ origin: [0, 10, 0], direction: [0, -1, 0] }, new Set(["moving"])),
    { id: "support", position: [1, 2, 3] },
  );
  assert.deepEqual(request.includeIds, ["moving", "support"]);
  assert.deepEqual(request.excludeIds, ["moving"]);
  const invalid = surfaceQuery(scene, () => ({
    id: "hidden",
    position: [0, 0, 0],
  }));
  assert.equal(invalid({ origin: [0, 1, 0], direction: [0, -1, 0] }), null);
});
