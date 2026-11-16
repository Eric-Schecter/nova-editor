// Snapshot and patch only after an exact base audit. Source remains untouched.
import {
  cp,
  mkdir,
  readFile,
  access,
  symlink,
  writeFile,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const source = resolve(process.argv[2] ?? "../nova-v2"),
  root = resolve(process.argv[3] ?? "output/atmosphere-sdk-rebuild");
if (root === source || root.startsWith(source + "/"))
  throw Error("Choose a separate snapshot directory");
try {
  await access(root);
  throw Error("Snapshot destination must not exist");
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
await mkdir(root, { recursive: true });
for (const path of [
  "render",
  "cmake",
  "scripts/webgpu",
  "assets/AntiAliasing",
  "CMakeLists.txt",
])
  await cp(join(source, path), join(root, path), { recursive: true });
await cp("apps/web/public/sdk/src", join(root, "web/src"), { recursive: true });
for (const name of [
  "EnvironmentData.js",
  "ModelData.js",
  "ModelView.js",
  "Nova.js",
  "PathView.js",
])
  await cp(
    "tools/sdk/patches/atmosphere-web-base/" + name,
    join(root, "web/src", name),
  );
await symlink(join(source, "node_modules"), join(root, "node_modules"), "dir");
const info = JSON.parse(
  await readFile("tools/sdk/patches/atmosphere-base-info.json", "utf8"),
);
// Restore the packaging recipe at the recorded commit; current upstream packaging may evolve independently.
await writeFile(
  join(root, "cmake/Install.cmake"),
  execFileSync("git", [
    "-C",
    source,
    "show",
    info.sourceCommit + ":cmake/Install.cmake",
  ]),
);
await writeFile(
  join(root, "source-metadata.json"),
  JSON.stringify(info, null, 2) + "\n",
);
const manifest = JSON.parse(
  await readFile("tools/sdk/patches/atmosphere-base.json", "utf8"),
);
for (const [path, expected] of Object.entries(manifest)) {
  const actual = createHash("sha256")
    .update(await readFile(join(root, path)))
    .digest("hex");
  if (actual !== expected)
    throw Error(
      "Nova base changed: " +
        path +
        ". Review API/shader compatibility and regenerate the base manifest before rebuilding.",
    );
}
execFileSync(process.execPath, ["tools/sdk/patches/atmosphere.mjs", root], {
  stdio: "inherit",
});
console.log("Prepared isolated audited SDK at " + root);
