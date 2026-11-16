import { renderCamera } from "../packages/render-contract/bridge";
import { copyViewCamera } from "../apps/web/public/sdk/src/Camera.js";
const validateCamera = (camera: any) => copyViewCamera(renderCamera(camera));
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cameraFrame,
  project,
  rayAt,
  add,
  mul,
  dot,
  sub,
  gizmoFor,
  beginDrag,
  updateDrag,
  transform,
} from "../packages/editor-core/src/viewport";
import { standardViews } from "../packages/editor-core/src/view-cube";
import { sceneUniforms } from "../apps/web/public/sdk/src/ModelData.js";
import { emptyScene, identity } from "../packages/scene-schema/index";
const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 0.0001, `${a} != ${b}`);
const size = { width: 960, height: 640 };
const material = {
  baseColor: [1, 1, 1, 1],
  material: [0, 1, 1, 1],
  emissive: [0, 0, 0, 0],
};
test("all exact cardinal views match SDK raster projection and screen rays in both projection modes", () => {
  for (const view of standardViews)
    for (const orthographic of [false, true]) {
      const c = { ...view, distance: 8, exposure: 1, orthographic };
      validateCamera(c);
      const f = cameraFrame(c),
        m = sceneUniforms(material, renderCamera(c), size.width / size.height);
      for (const p of [
        [0.6, 0.8, 0.3],
        [-1, -0.7, -0.4],
      ]) {
        const q = [...p, 1];
        const clip = [0, 1, 2, 3].map((r) =>
          q.reduce((s, v, k) => s + v * m[k * 4 + r], 0),
        );
        const screen = project(p, c, size)!;
        close(screen.x, ((clip[0] / clip[3] + 1) * size.width) / 2);
        close(screen.y, ((1 - clip[1] / clip[3]) * size.height) / 2);
        const ray = rayAt(screen, c, size),
          t = dot(sub(p, ray.origin), ray.direction);
        const hit = add(ray.origin, mul(ray.direction, t));
        for (let k = 0; k < 3; k++) close(hit[k], p[k]);
      }
    }
});
test("orthographic rays are parallel, depth does not change apparent size, and zoom preserves central framing", () => {
  const c = {
    yaw: 25,
    pitch: 20,
    distance: 8,
    exposure: 1,
    orthographic: true,
  };
  const f = cameraFrame(c);
  const a = rayAt({ x: 100, y: 200 }, c, size),
    b = rayAt({ x: 800, y: 400 }, c, size);
  assert.deepEqual(a.direction, b.direction);
  assert.notDeepEqual(a.origin, b.origin);
  const p = [0.3, 0.5, 0.2],
    near = project(p, c, size)!,
    far = project(add(p, mul(f.forward, 3)), c, size)!;
  close(near.x, far.x);
  close(near.y, far.y);
  const zoom = project(p, { ...c, distance: 4 }, size)!;
  close(zoom.x - size.width / 2, (near.x - size.width / 2) * 2);
  close(zoom.y - size.height / 2, (near.y - size.height / 2) * 2);
});
test("orthographic gizmo translation scale and rotation remain correct", () => {
  const scene = {
    ...emptyScene(),
    nodes: [
      { id: "mesh", name: "Mesh", parentId: null, transform: identity() },
    ],
  };
  const c = {
    yaw: 25,
    pitch: 20,
    distance: 8,
    exposure: 1,
    orthographic: true,
  };
  for (let k = 0; k < 3; k++) {
    for (const mode of ["translate", "scale"] as const) {
      const g = gizmoFor(scene, "mesh", mode, c, size)!;
      const a = [0, 0, 0],
        b = [0, 0, 0];
      a[k] = g.radius * 0.6;
      b[k] = a[k] + (mode === "scale" ? g.radius * 0.4 : 0.5);
      const start = project(transform(g.basis, a), c, size)!,
        end = project(transform(g.basis, b), c, size)!;
      const drag = beginDrag(g, k, start)!;
      assert.ok(drag);
      const t = updateDrag(drag, end);
      close(
        mode === "scale" ? t.scale[k] : t.position[k],
        mode === "scale" ? 1.4 : 0.5,
      );
    }
    const g = gizmoFor(scene, "mesh", "rotate", c, size)!,
      a = [0, 0, 0],
      b = [0, 0, 0];
    a[(k + 1) % 3] = g.radius;
    b[(k + 1) % 3] = Math.cos(Math.PI / 4) * g.radius;
    b[(k + 2) % 3] = Math.sin(Math.PI / 4) * g.radius;
    const d = beginDrag(g, k, project(transform(g.basis, a), c, size)!)!;
    const t = updateDrag(d, project(transform(g.basis, b), c, size)!);
    close(Math.abs(t.rotation[k]), Math.sin(Math.PI / 8));
  }
});
