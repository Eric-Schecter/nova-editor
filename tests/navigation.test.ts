import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SceneData } from "../apps/web/public/sdk/src/SceneData.js";
import {
  frameBounds,
  panCamera,
  sceneBounds,
  boundsCorners,
} from "../packages/editor-core/src/navigation";
import {
  project,
  rayAt,
  add,
  mul,
  dot,
  sub,
  type Camera,
} from "../packages/editor-core/src/viewport";
import { validateScene } from "../packages/scene-schema/index";
const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-4, `${a} != ${b}`);
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const asset = (name: string) =>
  `data:model/gltf-binary;base64,${readFileSync(`tests/fixtures/units-${name}.glb`).toString("base64")}`;
test("source-space SDK restores GLB size and root origin for rendering and triangle picking; legacy keeps its layout", async () => {
  const sdk = new SceneData();
  const defs = [
    { id: "small", url: asset("small"), sourceSpace: true },
    { id: "tall", url: asset("tall"), sourceSpace: true },
  ];
  await sdk.update(defs, [
    { id: "small", assetId: "small", world: identity() },
    {
      id: "tall",
      assetId: "tall",
      world: identity().map((v, i) => (i === 12 ? 4 : v)),
    },
  ]);
  const b = sdk.assetBounds("small")!;
  close(b.minimum[0], 0.25);
  close(b.maximum[0], 1.25);
  close(b.minimum[1], 0);
  close(b.maximum[1], 1);
  const t = sdk.assetBounds("tall")!;
  close(t.maximum[1], 3);
  close(t.minimum[1], 0);
  close(t.maximum[0] - t.minimum[0], 2);
  assert.equal(
    sdk.pick({ origin: [1.2, 0.5, 4], direction: [0, 0, -1] })?.id,
    "small",
  );
  assert.equal(
    sdk.pick({ origin: [-0.3, 0.5, 4], direction: [0, 0, -1] }),
    null,
  );
  defs[0].sourceSpace = false;
  await sdk.update(defs, [
    { id: "small", assetId: "small", world: identity() },
  ]);
  // Removing an asset rebuilds topology; changing only the space flag does not.
  const legacyModel = sdk.model;
  defs[0].sourceSpace = true;
  await sdk.update(defs, [
    { id: "small", assetId: "small", world: identity() },
  ]);
  assert.equal(sdk.model, legacyModel);
  defs[0].sourceSpace = false;
  await sdk.update(defs, [
    { id: "small", assetId: "small", world: identity() },
  ]);
  assert.equal(
    sdk.pick({ origin: [1.2, 0.5, 4], direction: [0, 0, -1] }),
    null,
  );
  assert.equal(
    sdk.pick({ origin: [-0.3, 0.5, 4], direction: [0, 0, -1] })?.id,
    "small",
  );
  sdk.dispose();
});
test("translated camera targets match SDK-style projection and screen-ray roundtrips at poles and after panning", () => {
  for (const orthographic of [false, true])
    for (const pitch of [20, 90, -90]) {
      const c: Camera = {
          yaw: 25,
          pitch,
          distance: 8,
          exposure: 1,
          orthographic,
          target: [7, 4, -3],
        },
        s = { width: 900, height: 600 },
        p = [7.1, 4.2, -2.7];
      const q = project(p, c, s)!;
      const ray = rayAt(q, c, s),
        distance = dot(sub(p, ray.origin), ray.direction),
        hit = add(ray.origin, mul(ray.direction, distance));
      for (let k = 0; k < 3; k++) close(hit[k], p[k]);
      const pan = panCamera(c, 80, -30, s);
      const q0 = project(c.target!, c, s)!,
        q2 = project(c.target!, pan, s)!;
      close(q2.x - q0.x, 80);
      close(q2.y - q0.y, -30);
    }
});
test("frame all and selected subtree use real bounds and fit landscape/portrait in both projection modes", () => {
  const scene = validateScene(
      JSON.parse(readFileSync("tests/fixtures/units.scene.json", "utf8")),
    ),
    assets = {
      small: { minimum: [0.25, 0, 0], maximum: [1.25, 1, 1] },
      tall: { minimum: [-1, 0, -0.75], maximum: [1, 3, 0.75] },
    };
  const b = sceneBounds(scene, assets)!;
  close(b.minimum[0], -1.75);
  close(b.maximum[0], 2.5);
  close(b.maximum[1], 3);
  const selected = sceneBounds(scene, assets, "small")!;
  close(selected.maximum[1], 1);
  for (const orthographic of [false, true])
    for (const size of [
      { width: 900, height: 600 },
      { width: 400, height: 800 },
    ]) {
      const c = frameBounds(
        { yaw: 25, pitch: 20, distance: 8, exposure: 1, orthographic },
        b,
        size,
      );
      for (const p of boundsCorners(b)) {
        const q = project(p, c, size)!;
        assert.ok(
          q && q.x >= 0 && q.x <= size.width && q.y >= 0 && q.y <= size.height,
        );
      }
    }
  assert.equal(validateScene(scene).assets.small.sourceSpace, true);
  assert.throws(() => validateScene({ ...scene, schemaVersion: 1 }));
  const invalid = structuredClone(scene) as any;
  invalid.assets.small.sourceSpace = "true";
  assert.throws(() => validateScene(invalid));
});
