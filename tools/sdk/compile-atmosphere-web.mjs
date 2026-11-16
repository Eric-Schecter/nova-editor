import { readFile, writeFile, mkdir } from "node:fs/promises";
const root = process.argv[2];
if (!root) throw Error("Pass isolated SDK root");
process.chdir(root);
const { compile } = await import(
  new URL("file://" + root + "/scripts/webgpu/compiler.mjs")
);
const source = await readFile("render/shaders/model.hlsl", "utf8");
await mkdir("web/generated", { recursive: true });
for (const [name, extra, options] of [
  ["model", "", { model: true }],
  ["skybox", "", { model: true, sky: true }],
  ["model-aa", "#define NOVA_RASTER_AA 1\n", { model: true }],
]) {
  await writeFile(
    "web/generated/" + name + ".json",
    JSON.stringify(await compile(extra + source, options)),
  );
  console.log("Compiled " + name);
}
