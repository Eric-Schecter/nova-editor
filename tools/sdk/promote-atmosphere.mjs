// Promote only an explicitly built isolated snapshot; does not touch the upstream checkout.
import { cp, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
const root = resolve(process.argv[2] ?? "output/atmosphere-sdk");
const hash = (b) => createHash("sha256").update(b).digest("hex");
await mkdir(".sdk/native", { recursive: true });
await cp(join(root, "install"), ".sdk/native", { recursive: true });
await cp(join(root, "web/src"), "apps/web/public/sdk/src", { recursive: true });
for (const name of ["model", "skybox", "model-aa"])
  await cp(
    join(root, "web/generated", name + ".json"),
    "apps/web/public/sdk/generated/" + name + ".json",
  );
const lock = JSON.parse(await readFile("nova-sdk.lock.json", "utf8"));
lock.rasterWebBaseCommit = "6888d8a72eeb645985490e2b911ed0cc00b3bbca";
const metadata = JSON.parse(
  await readFile(join(root, "source-metadata.json"), "utf8"),
);
lock.sourceCommit = metadata.sourceCommit;
lock.sourceDirty = metadata.sourceDirty;
lock.snapshot = metadata;
lock.extensions = [
  ...new Set([
    ...lock.extensions,
    "scene-raster-fog-v1",
    "environment-clear-v1",
  ]),
];
lock.editorPatch = {
  path: "tools/sdk/patches/atmosphere.mjs",
  sha256: hash(await readFile("tools/sdk/patches/atmosphere.mjs")),
  baseManifest: "tools/sdk/patches/atmosphere-base.json",
  baseManifestSha256: hash(
    await readFile("tools/sdk/patches/atmosphere-base.json"),
  ),
  note: "Native is rebuilt from isolated local dirty Nova source; Web preserves the prior editor API baseline plus the same raster fog extension.",
};
lock.files = {};
async function scan(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await scan(path);
    else lock.files[path] = hash(await readFile(path));
  }
}
for (const dir of [
  ".sdk/native",
  ".sdk/support",
  "apps/web/public/sdk",
  "apps/web/public/demo",
])
  await scan(dir);
await writeFile("nova-sdk.lock.json", JSON.stringify(lock, null, 2) + "\n");
console.log("Promoted " + Object.keys(lock.files).length + " SDK files");
