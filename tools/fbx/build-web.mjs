import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const build = join(root, "build-fbx-web");
const output = join(root, "apps/web/public/fbx");
const files = ["nova_fbx.mjs", "nova_fbx.wasm"];
const override = process.env.NOVA_ASSIMP_SOURCE;
const hash = createHash("sha256");
for (const source of ["tools/fbx/CMakeLists.txt", "tools/fbx/convert.cpp",
  "tools/fbx/build-web.mjs", "apps/desktop/src/Assets.hpp", "apps/desktop/src/Scene.hpp"])
  hash.update(readFileSync(join(root, source)));
const fingerprint = hash.update(override || "").digest("hex");
const stamp = join(output, ".source.sha256");
const staged = files.every((name) => existsSync(join(output, name))) &&
  existsSync(stamp) && readFileSync(stamp, "utf8") === fingerprint;
if (process.argv.includes("--if-missing") && staged) process.exit(0);

const args = override ? ["-DFETCHCONTENT_SOURCE_DIR_ASSIMP=" + override] : [];
try {
  execFileSync(process.platform === "win32" ? "emcmake.bat" : "emcmake",
    ["cmake", "-S", join(root, "tools/fbx"), "-B", build, "-DCMAKE_BUILD_TYPE=Release", ...args],
    { stdio: "inherit", shell: process.platform === "win32" });
  execFileSync("cmake", ["--build", build, "--target", "nova_fbx", "--parallel", "6"], { stdio: "inherit" });
} catch (error) {
  console.error(error.code === "ENOENT" ? "Activate Emscripten before building the Web FBX converter." : error.message);
  process.exit(1);
}
mkdirSync(output, { recursive: true });
for (const name of files) copyFileSync(join(build, name), join(output, name));
const cache = readFileSync(join(build, "CMakeCache.txt"), "utf8");
const deps = cache.match(/^FETCHCONTENT_BASE_DIR:PATH=(.*)$/m)?.[1] ?? join(build, "_deps");
const assimp = override || join(deps, "assimp-src");
copyFileSync(join(assimp, "LICENSE"), join(output, "Assimp-LICENSE.txt"));
writeFileSync(stamp, fingerprint);
