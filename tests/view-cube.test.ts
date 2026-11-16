import { renderCamera } from "../packages/render-contract/bridge";
import { copyViewCamera } from "../apps/web/public/sdk/src/Camera.js";
const validateCamera = (camera: any) => copyViewCamera(renderCamera(camera));
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  standardViews,
  cubeFaces,
} from "../packages/editor-core/src/view-cube";
import {
  cameraFrame,
  rayAt,
  project,
  transform,
} from "../packages/editor-core/src/viewport";
import { loadGLB } from "../apps/web/public/sdk/src/ModelData.js";
const camera = { yaw: 25, pitch: 20, distance: 8, exposure: 1 };
test("all six cube presets are accepted by SDK, with stable projection and matching center ray", () => {
  for (const view of standardViews) {
    const c = { ...camera, yaw: view.yaw, pitch: view.pitch };
    validateCamera(c);
    const f = cameraFrame(c);
    assert.ok(f.eye[view.axis] * view.sign > 7.99);
    const p = project([0, 0, 0], c, { width: 900, height: 600 })!;
    const ray = rayAt(p, c, { width: 900, height: 600 });
    assert.ok([...f.up, ...f.right, ...ray.direction].every(Number.isFinite));
    assert.ok(ray.direction[view.axis] * view.sign < -0.999);
    assert.ok(cubeFaces(c).some((face) => face.title === view.title));
  }
});
test("generated helper GLBs load with actual SDK and recover world dimensions after normalization", async () => {
  const manifest = JSON.parse(
    readFileSync("resources/viewport/manifest.json", "utf8"),
  ) as { name: string; world: number[] }[];
  for (const helper of manifest) {
    const bytes = readFileSync(`resources/viewport/${helper.name}.glb`);
    const mesh = await loadGLB(
      `data:model/gltf-binary;base64,${bytes.toString("base64")}`,
    );
    assert.ok(mesh.vertices.length > 0);
    const points: number[][] = [];
    for (let i = 0; i < mesh.vertices.length; i += 12)
      points.push(
        transform(helper.world, Array.from(mesh.vertices.slice(i, i + 3))),
      );
    const bounds = [0, 1, 2].map((k) => [
      Math.min(...points.map((p) => p[k])),
      Math.max(...points.map((p) => p[k])),
    ]);
    if (helper.name === "grid") {
      assert.ok(bounds[0][0] < -19.99 && bounds[2][1] > 19.99);
      assert.ok(Math.abs(bounds[1][0] + 0.004) < 1e-5);
    } else if (helper.name === "ground") {
      assert.ok(bounds[0][0] < -19.99 && bounds[2][1] > 19.99);
      assert.ok(Math.abs(bounds[1][1] + 0.005) < 1e-5);
    } else {
      const k = Number(helper.name.at(-1)),
        extent = k === 1 ? 3 : 20;
      assert.ok(Math.abs(bounds[k][0] + extent) < 1e-4);
      assert.ok(Math.abs(bounds[k][1] - extent) < 1e-4);
    }
  }
});
