import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { emptyScene, identity } from "../../packages/scene-schema/index";
import {
  createCamera,
  createLight,
  aimObject,
} from "../../packages/editor-core/src/scene-objects";
import { packProject } from "../../packages/editor-core/src/project";
const inputCamera = {
  yaw: 25,
  pitch: 20,
  distance: 9,
  exposure: 1.2,
  target: [0, 1, 0],
};
const scene = emptyScene();
scene.schemaVersion = 3;
scene.name = "Scene cameras & lights";
const front = createCamera("camera-front", inputCamera);
front.name = "Camera front";
front.camera!.primary = true;
const side = createCamera("camera-side", {
  ...inputCamera,
  yaw: 90,
  pitch: 15,
  distance: 8,
  orthographic: true,
});
side.name = "Camera side";
side.camera!.orthographicSize = 7;
const sun = createLight("sun");
sun.name = "Sun";
sun.light!.active = true;
sun.light!.color = [1, 0.7, 0.4];
sun.light!.intensity = 4;
sun.light!.softness = 2;
const fill = createLight("fill");
fill.name = "Alternate light";
fill.transform.position = [-4, 5, -3];
scene.nodes.push(front, side, sun, fill);
aimObject(scene, "fill", -70, 50);
writeFileSync(
  "tests/fixtures/scene-objects.json",
  JSON.stringify({ scene, inputCamera }, null, 2),
);
const example = JSON.parse(
  readFileSync("output/primitives-study/project.json", "utf8"),
);
example.schemaVersion = 3;
example.name = "Cameras & directional lights";
example.nodes.push(...scene.nodes);
const files: Record<string, Uint8Array> = {};
for (const a of Object.values(example.assets) as { path: string }[])
  files[a.path] = new Uint8Array(
    readFileSync("output/primitives-study/" + a.path),
  );
mkdirSync("output/scene-objects-study/assets", { recursive: true });
writeFileSync(
  "output/scene-objects-study/project.json",
  JSON.stringify(example, null, 2),
);
for (const [path, data] of Object.entries(files))
  writeFileSync("output/scene-objects-study/" + path, data);
mkdirSync("apps/web/public/examples", { recursive: true });
writeFileSync(
  "apps/web/public/examples/scene-objects.zip",
  packProject({ scene: example, assets: files }),
);
console.log("Generated saved scene camera / light example");
