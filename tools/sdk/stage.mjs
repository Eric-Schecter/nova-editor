// Explicit local development snapshot; never compiles Nova or replaces its working tree.
import { mkdir, cp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { resolve, relative, join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { zipSync, strToU8 } from "fflate";
try {
  const existing = JSON.parse(await readFile("nova-sdk.lock.json", "utf8"));
  if (existing.extensions?.includes("scene-raster-fog-v1"))
    throw Error(
      "This editor requires the atmosphere SDK extension. Use tools/sdk/prepare-atmosphere.mjs, rebuild the isolated SDK, then tools/sdk/promote-atmosphere.mjs. See docs/SDK-ATMOSPHERE.md.",
    );
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const root = resolve(process.argv[2] ?? "../nova-v2");
const generated = join(root, "docs/public/generated");
const web = resolve("apps/web/public/sdk");
const cache = await readFile(join(root, "build/CMakeCache.txt"), "utf8");
const triplet = cache.match(/^VCPKG_TARGET_TRIPLET:[^=]+=(.+)$/m)?.[1]?.trim();
if (!triplet)
  throw Error("Cannot discover vcpkg target triplet from Nova CMake cache");
await mkdir(".sdk/support/include", { recursive: true });
await cp(
  join(root, "build/vcpkg_installed", triplet, "include/nlohmann"),
  ".sdk/support/include/nlohmann",
  { recursive: true },
);
await cp(
  join(root, "build/vcpkg_installed", triplet, "share/nlohmann-json/copyright"),
  ".sdk/support/json-LICENSE",
);
await rm(web, { recursive: true, force: true });
await mkdir(web, { recursive: true });
await cp(join(root, "web/src"), join(web, "src"), { recursive: true });
await mkdir(join(web, "generated"), { recursive: true });
for (const file of await readdir(generated)) {
  if (file.endsWith(".json"))
    await cp(join(generated, file), join(web, "generated", file));
}
// Local example fixture is separate from the SDK, with its upstream license.
const demo = resolve("apps/web/public/demo");
await mkdir(demo, { recursive: true });
const example = {
  schemaVersion: 1,
  name: "Multi-instance study",
  assets: {
    helmet: { path: "assets/helmet.glb" },
    avocado: { path: "assets/avocado.glb" },
  },
  nodes: [
    {
      id: "helmet",
      parentId: null,
      name: "Damaged Helmet",
      assetId: "helmet",
      transform: {
        position: [-1.5, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
    },
  ],
};
example.nodes.push(
  {
    id: "helmet-copy",
    parentId: null,
    name: "Helmet copy",
    assetId: "helmet",
    transform: {
      position: [1.5, 0, 0],
      rotation: [0, 0.2588190451, 0, 0.9659258263],
      scale: [0.75, 1.1, 0.75],
    },
  },
  {
    id: "avocado",
    parentId: null,
    name: "Avocado",
    assetId: "avocado",
    transform: {
      position: [0, 1.8, 0],
      rotation: [0, 0, 0, 1],
      scale: [0.65, 0.65, 0.65],
    },
  },
);
const license = await readFile(join(root, "assets/DamagedHelmet/README.md"));
await writeFile(
  join(demo, "project.zip"),
  zipSync(
    {
      "project.json": strToU8(JSON.stringify(example, null, 2)),
      "assets/avocado.glb": await readFile(
        join(root, "assets/Avocado/Avocado.glb"),
      ),
      "assets/helmet.glb": await readFile(
        join(root, "assets/DamagedHelmet/DamagedHelmet.glb"),
      ),
      "LICENSES.txt": Buffer.concat([
        license,
        await readFile(join(root, "assets/Avocado/README.md")),
      ]),
    },
    { level: 0 },
  ),
);
await writeFile(join(demo, "README.md"), license);
const files = {};
async function scan(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) await scan(path);
    else
      files[relative(resolve("."), path)] = createHash("sha256")
        .update(await readFile(path))
        .digest("hex");
  }
}
await scan(resolve(".sdk/native"));
await scan(resolve(".sdk/support"));
await scan(web);
await scan(demo);
const lock = {
  formatVersion: 1,
  channel: "local-dev",
  releaseId: null,
  sourceCommit: execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  sourceDirty: !!execFileSync("git", ["-C", root, "status", "--porcelain"], {
    encoding: "utf8",
  }).trim(),
  target: process.platform + "-" + process.arch,
  configuration: cache.match(/^CMAKE_BUILD_TYPE:[^=]+=(.+)$/m)?.[1]?.trim(),
  triplet,
  extensions: [
    "parameter-panel-draw-ui-v1",
    "scene-instances-v1",
    "scene-picking-v1",
    "scene-picking-filter-v1",
    "scene-shadow-map-metal-web-v1",
    "scene-light-settings-v1",
    "window-escape-policy-v1",
    "ui-configuration-v1",
    "camera-poles-v1",
    "orthographic-raster-camera-v1",
    "source-model-space-v1",
    "scene-viewport-rect-v1",
  ],
  files,
};
await writeFile("nova-sdk.lock.json", JSON.stringify(lock, null, 2) + "\n");
console.log(
  `Staged ${Object.keys(files).length} files. Local dirty snapshots are not release packages.`,
);
