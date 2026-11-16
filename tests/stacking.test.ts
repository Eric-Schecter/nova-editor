import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SceneData } from "../apps/web/public/sdk/src/SceneData.js";
import {
  groundedTransform,
  placementAt,
  surfaceQuery,
} from "../packages/editor-core/src/placement";
import { identity, type Scene } from "../packages/scene-schema/index";
import {
  worldMatrices,
  eulerQuaternion,
} from "../packages/scene-schema/transforms";
import {
  project,
  transform,
  type Camera,
} from "../packages/editor-core/src/viewport";
import { boundsCorners } from "../packages/editor-core/src/navigation";
import { EditorHistory } from "../packages/editor-core/src/index";
const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-4, `${a} != ${b}`);
const scene: Scene = {
  schemaVersion: 2,
  name: "Stacking regression",
  assets: {
    small: { path: "assets/units-small.glb", sourceSpace: true },
    tall: { path: "assets/units-tall.glb", sourceSpace: true },
  },
  nodes: [
    {
      id: "base",
      parentId: null,
      name: "Base",
      assetId: "tall",
      transform: identity(),
    },
    {
      id: "moving",
      parentId: null,
      name: "Moving",
      assetId: "small",
      transform: { ...identity(), position: [-0.75, 8, -0.5] },
    },
  ],
};
async function setup(s: Scene) {
  const sdk = new SceneData(),
    worlds = worldMatrices(s);
  await sdk.update(
    Object.entries(s.assets).map(([id, a]) => ({
      id,
      sourceSpace: !!a.sourceSpace,
      url: `data:model/gltf-binary;base64,${readFileSync("tests/fixtures/" + a.path.split("/").pop()).toString("base64")}`,
    })),
    [
      ...s.nodes
        .filter((n) => n.assetId)
        .map((n) => ({
          id: n.id,
          assetId: n.assetId!,
          world: worlds.get(n.id)!,
        })),
      ...Object.keys(s.assets)
        .filter((id) => !s.nodes.some((n) => n.assetId === id))
        .map((id) => ({
          id: `unused_${id}`,
          assetId: id,
          world: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
        })),
    ],
  );
  const bounds = Object.fromEntries(
    Object.keys(s.assets).map((id) => [id, sdk.assetBounds(id)!]),
  );
  return { sdk, bounds, query: surfaceQuery(s, (ray) => sdk.pick(ray)) };
}
test("real SDK triangles: downward landing stacks, ignores self, and stays one undo / no-op", async () => {
  const s = structuredClone(scene),
    { bounds, query } = await setup(s),
    h = new EditorHistory(s);
  h.commit((d) => {
    d.nodes[1].transform = groundedTransform(d, "moving", bounds, query)!;
  });
  close(h.scene.nodes[1].transform.position[1], 3);
  // Refresh the real renderer geometry after committing, as the app does.
  const landed = await setup(h.scene);
  h.commit((d) => {
    d.nodes[1].transform = groundedTransform(
      d,
      "moving",
      bounds,
      landed.query,
    )!;
  });
  h.undo();
  assert.deepEqual(h.scene, s);
  assert.equal(h.canUndo, false);
  h.redo();
  close(h.scene.nodes[1].transform.position[1], 3);
  s.nodes[1].transform.position[1] = 1;
  const inside = await setup(s);
  close(groundedTransform(s, "moving", bounds, inside.query)!.position[1], 0);
});
test("surface placement supports front orthographic, stacking, snapping off the edge, and empty-ground fallback", async () => {
  const s = structuredClone(scene);
  s.nodes.pop();
  const { bounds, query } = await setup(s);
  const dims = { width: 900, height: 600 };
  for (const orthographic of [false, true]) {
    const c: Camera = {
      yaw: 0,
      pitch: 30,
      distance: 12,
      target: [0, 2, 0],
      exposure: 1,
      orthographic,
    };
    const p = project([0, 3, 0], c, dims)!;
    close(
      placementAt(p, c, dims, bounds.small, false, 1, {
        scene: s,
        assets: bounds,
        query,
      })!.position[1],
      3,
    );
  }
  const front: Camera = {
    yaw: 180,
    pitch: 0,
    distance: 12,
    target: [0, 1.5, 0],
    exposure: 1,
    orthographic: true,
  };
  const p = project([0, 1.5, -0.75], front, dims)!;
  close(
    placementAt(p, front, dims, bounds.small, false, 1, {
      scene: s,
      assets: bounds,
      query,
    })!.position[1],
    3,
  );
  // Authored positive X offset puts the complete footprint outside the pedestal after snapping.
  const c: Camera = { ...front, pitch: 60, target: [0, 0, 0] };
  const off = project([3.2, 0, 2], c, dims)!;
  close(
    placementAt(off, c, dims, bounds.small, true, 1, {
      scene: s,
      assets: bounds,
      query,
    })!.position[1],
    0,
  );
  // Add a real second level and point at its roof.
  s.nodes.push({
    id: "level",
    name: "Level",
    parentId: null,
    assetId: "small",
    transform: { ...identity(), position: [-0.75, 3, -0.5] },
  });
  const stacked = await setup(s),
    top = project([0, 4, 0], c, dims)!;
  close(
    placementAt(top, c, dims, bounds.small, false, 1, {
      scene: s,
      assets: bounds,
      query: stacked.query,
    })!.position[1],
    4,
  );
});
test("narrow supports and transformed subtrees land vertically without using their own surfaces", async () => {
  const s = structuredClone(scene);
  s.nodes[0].transform = {
    ...identity(),
    scale: [0.05, 1, 0.05],
    position: [0.31, 0, 0.17],
  };
  s.nodes.push({
    id: "group",
    name: "Group",
    parentId: null,
    transform: {
      ...identity(),
      position: [0, 7, 0],
      rotation: eulerQuaternion([0, 30, 0]),
      scale: [-1, 1.3, 1],
    },
  });
  s.nodes[1].parentId = "group";
  s.nodes[1].transform = { ...identity(), position: [-0.75, 1, -0.5] };
  const { bounds, query } = await setup(s),
    before = worldMatrices(s).get("moving")!;
  const t = groundedTransform(s, "group", bounds, query)!;
  s.nodes[2].transform = t;
  const after = worldMatrices(s).get("moving")!;
  const low = Math.min(
    ...boundsCorners(bounds.small).map((p) => transform(after, p)[1]),
  );
  close(low, 3);
  for (let k = 0; k < 16; k++) if (k !== 13) close(before[k], after[k]);
});
test("surface filtering supplies include/exclude IDs to the SDK without scene mutations", () => {
  const s = structuredClone(scene);
  let calls = 0;
  const query = surfaceQuery(s, (ray) => {
    calls++;
    assert.deepEqual(ray.includeIds, ["base", "moving"]);
    assert.deepEqual(ray.excludeIds, ["moving"]);
    return { id: "base", position: [0, 3, 0] };
  });
  assert.equal(
    query({ origin: [0, 10, 0], direction: [0, -1, 0] }, new Set(["moving"]))
      ?.id,
    "base",
  );
  assert.equal(calls, 1);
  assert.deepEqual(s, scene);
});

test("sloped triangles provide sampled surface height and empty AABB regions do not support models", async () => {
  const { pickTriangles } = await import(
    "../apps/web/public/sdk/src/Picking.js"
  );
  const vertices = new Float32Array(36);
  [
    [-1, 0, -1],
    [1, 0, -1],
    [0, 2, 1],
  ].forEach((p, i) => vertices.set(p, i * 12));
  const mesh = new Map([["slope", { data: { vertices } }]]);
  const s: Scene = {
    schemaVersion: 2,
    name: "Slope",
    assets: { slope: { path: "slope.glb" }, box: { path: "box.glb" } },
    nodes: [
      {
        id: "ramp",
        assetId: "slope",
        name: "Ramp",
        parentId: null,
        transform: identity(),
      },
      {
        id: "box",
        assetId: "box",
        name: "Box",
        parentId: null,
        transform: { ...identity(), position: [0, 8, -0.6] },
      },
    ],
  };
  const matrix = worldMatrices(s).get("ramp")!;
  const query = surfaceQuery(s, (ray) =>
    pickTriangles(mesh, [{ id: "ramp", assetId: "slope", world: matrix }], ray),
  );
  const bounds = {
    slope: { minimum: [-1, 0, -1], maximum: [1, 2, 1] },
    box: { minimum: [-0.1, 0, -0.1], maximum: [0.1, 1, 0.1] },
  };
  close(groundedTransform(s, "box", bounds, query)!.position[1], 0.5);
  s.nodes[1].transform.position = [0.9, 8, 0.9];
  close(groundedTransform(s, "box", bounds, query)!.position[1], 0);
});
