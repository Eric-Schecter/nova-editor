import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildShadowMap,
  shadowResolution,
} from "../apps/web/public/sdk/src/ShadowMap.js";
import { SceneData } from "../apps/web/public/sdk/src/SceneData.js";
import { readFileSync } from "node:fs";
const triangles = [
  [
    [-1, 1, -1],
    [1, 1, -1],
    [1, 1, 1],
  ],
  [
    [-1, 1, -1],
    [1, 1, 1],
    [-1, 1, 1],
  ],
];
function sample(map: ReturnType<typeof buildShadowMap>, p: number[]) {
  const m = map.uniforms,
    q = [0, 1, 2].map(
      (k) => m[k] * p[0] + m[k + 4] * p[1] + m[k + 8] * p[2] + m[k + 12],
    );
  return {
    depth: q[2],
    map: map.depth[
      Math.floor(q[1] * shadowResolution) * shadowResolution +
        Math.floor(q[0] * shadowResolution)
    ],
  };
}
test("shadow depth occludes ground and lower model surfaces, follows light direction, and does not occlude above", () => {
  const map = buildShadowMap(triangles, [0, 1, 0]);
  assert.equal(map.uniforms[17], 1);
  for (const y of [0, 0.5]) {
    const s = sample(map, [0, y, 0]);
    assert.ok(s.depth > s.map + 0.01);
  }
  const above = sample(map, [0, 2, 0]);
  assert.ok(above.depth < above.map);
  const angled = sample(buildShadowMap(triangles, [-1, 1, 0]), [1, 0, 0]);
  assert.ok(angled.depth > angled.map + 0.01);
  assert.equal(buildShadowMap([], [0, 1, 0]).uniforms[17], 0);
  assert.throws(() => buildShadowMap(triangles, [0, 0, 0]));
});
test("real scene shadows cache across camera redraws, exclude editor geometry, and update after instance transforms", async () => {
  const sdk = new SceneData(),
    url = `data:model/gltf-binary;base64,${readFileSync("tests/fixtures/units-tall.glb").toString("base64")}`;
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    defs = [{ id: "box", url, sourceSpace: true }];
  await sdk.update(defs, [
    { id: "caster", assetId: "box", world: matrix },
    {
      id: "helper",
      assetId: "box",
      world: matrix.map((v, k) => (k === 12 ? 100 : v)),
      castShadow: false,
    },
  ]);
  assert.equal(sdk.shadowTriangles.length, 12);
  const first = sdk.shadowMap([-1, 1.6, 2])!;
  assert.equal(sdk.shadowMap([-1, 1.6, 2]), first);
  assert.notEqual(sdk.shadowMap([1, 1.6, 2]), first);
  await sdk.update(defs, [
    {
      id: "caster",
      assetId: "box",
      world: matrix.map((v, k) => (k === 12 ? 4 : v)),
    },
  ]);
  const moved = sdk.shadowMap([-1, 1.6, 2])!;
  assert.notEqual(moved, first);
  assert.notDeepEqual(moved.uniforms, first.uniforms);
  await sdk.update(defs, [
    { id: "caster", assetId: "box", world: matrix, castShadow: false },
  ]);
  assert.equal(sdk.shadowMap([-1, 1.6, 2])!.uniforms[17], 0);
  sdk.dispose();
});
