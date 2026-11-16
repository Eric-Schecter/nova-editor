import { test } from "node:test";
import assert from "node:assert/strict";
import { pickTriangles } from "../apps/web/public/sdk/src/Picking.js";
const world = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const vertices = new Float32Array([
  -1, -1, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, -1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, -1,
  1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
]);
const meshes = new Map([["mesh", { data: { vertices } }]]);
test("web SDK picks nearest actual triangles and not empty space inside bounds", () => {
  const back = world();
  back[14] = -2;
  const instances = [
    { id: "back", assetId: "mesh", world: back },
    { id: "front", assetId: "mesh", world: world() },
  ];
  const hit = pickTriangles(meshes, instances, {
    origin: [-0.25, -0.25, 3],
    direction: [0, 0, -4],
  });
  assert.equal(hit?.id, "front");
  assert.equal(hit?.distance, 3);
  assert.equal(
    pickTriangles(meshes, instances, {
      origin: [0.75, 0.75, 3],
      direction: [0, 0, -1],
    }),
    null,
  );
});
test("web SDK picking supports mirrored nonuniform instances, ignores singular matrices", () => {
  const m = world();
  m[0] = -2;
  m[5] = 0.5;
  const instances = [{ id: "mirrored", assetId: "mesh", world: m }];
  assert.equal(
    pickTriangles(meshes, instances, {
      origin: [0.5, -0.125, 3],
      direction: [0, 0, -1],
    })?.id,
    "mirrored",
  );
  m[0] = 0;
  assert.equal(
    pickTriangles(meshes, instances, {
      origin: [0, 0, 3],
      direction: [0, 0, -1],
    }),
    null,
  );
  assert.throws(() =>
    pickTriangles(meshes, instances, {
      origin: [0, 0, 3],
      direction: [0, 0, 0],
    }),
  );
});

test("SDK filters instances before nearest-hit selection, including coincident triangles", () => {
  const instances = [
    { id: "self", assetId: "mesh", world: world() },
    { id: "support", assetId: "mesh", world: world() },
  ];
  const ray = { origin: [-0.25, -0.25, 3], direction: [0, 0, -1] };
  assert.equal(
    pickTriangles(meshes, instances, { ...ray, excludeIds: ["self"] })?.id,
    "support",
  );
  assert.equal(
    pickTriangles(meshes, instances, { ...ray, includeIds: ["support"] })?.id,
    "support",
  );
  assert.equal(
    pickTriangles(meshes, instances, {
      ...ray,
      includeIds: ["self"],
      excludeIds: ["self"],
    }),
    null,
  );
  assert.equal(
    pickTriangles(meshes, instances, { ...ray, includeIds: ["missing"] }),
    null,
  );
});
