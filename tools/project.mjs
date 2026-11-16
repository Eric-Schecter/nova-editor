// Project archive transport, independent of UI and rendering.
import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { validateScene } from "../packages/scene-schema/index.ts";
import {
  projectPaths,
  validateEnvironmentBytes,
} from "../packages/editor-core/src/world.ts";
const [mode, input, output] = process.argv.slice(2);
if (!input || !output || !["pack", "unpack"].includes(mode))
  throw Error(
    "Usage: node --import tsx tools/project.mjs pack <project.json> <archive.zip> | unpack <archive.zip> <new-directory>",
  );
const safe = (path) =>
  typeof path === "string" &&
  path.startsWith("assets/") &&
  !/[\\:\x00-\x1f]/.test(path) &&
  !path.split("/").some((s) => !s || s === "." || s === "..");
if (mode === "pack") {
  const document = validateScene(JSON.parse(await readFile(input, "utf8"))),
    root = await realpath(dirname(resolve(input)));
  const files = { "project.json": strToU8(JSON.stringify(document, null, 2)) };
  for (const path of projectPaths(document)) {
    if (!safe(path)) throw Error("Invalid asset path");
    const absolute = await realpath(resolve(root, path)),
      rel = relative(root, absolute);
    if (rel === ".." || rel.startsWith("../") || isAbsolute(rel))
      throw Error("Asset escapes project directory");
    files[path] = await readFile(absolute);
  }
  try {
    files["LICENSES.txt"] = await readFile(resolve(root, "LICENSES.txt"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (document.world?.environment.map)
    validateEnvironmentBytes(files[document.world.environment.map]);
  await writeFile(output, zipSync(files, { level: 0 }));
} else {
  const buffer = await readFile(input);
  if (buffer.length > 128 * 1024 * 1024) throw Error("Archive exceeds 128 MiB");
  let total = 0;
  const files = unzipSync(buffer, {
    filter: (f) => {
      total += f.originalSize;
      if (total > 256 * 1024 * 1024)
        throw Error("Expanded archive exceeds 256 MiB");
      return true;
    },
  });
  if (!files["project.json"]) throw Error("Missing project.json");
  const document = validateScene(JSON.parse(strFromU8(files["project.json"])));
  // Validate completeness before writing. Destination must be new to avoid symlinks/overwrites.
  for (const path of projectPaths(document))
    if (!safe(path) || !files[path]) throw Error("Missing or invalid asset");
  if (document.world?.environment.map)
    validateEnvironmentBytes(files[document.world.environment.map]);
  await mkdir(output, { recursive: false });
  await mkdir(resolve(output, "assets"));
  for (const path of projectPaths(document)) {
    const absolute = resolve(output, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, files[path], { flag: "wx" });
  }
  if (files["LICENSES.txt"])
    await writeFile(resolve(output, "LICENSES.txt"), files["LICENSES.txt"], {
      flag: "wx",
    });
  await writeFile(
    resolve(output, "project.json"),
    JSON.stringify(document, null, 2) + "\n",
    { flag: "wx" },
  );
}
console.log(`${mode}: ${output}`);
