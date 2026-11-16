// Install only paired, clean SDK packages. No renderer source is patched or compiled here.
import {
  readFile,
  mkdir,
  readdir,
  rm,
  cp,
  writeFile,
  mkdtemp,
  access,
} from "node:fs/promises";
import { resolve, dirname, join, basename } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const manifestPath = resolve(process.argv[2] || ""),
  root = dirname(manifestPath),
  hash = (b) => createHash("sha256").update(b).digest("hex");
const manifestBytes = await readFile(manifestPath),
  manifest = JSON.parse(manifestBytes);
if (!manifest.native?.uiEnabled)
  throw Error("The native editor requires a UI-enabled SDK package");
const required = [
  "static-scenes",
  "camera-viewport",
  "scene-picking",
  "material-slots",
  "scene-bvh-shadows",
  "raster-fog",
  "environment-clear",
  "application-ui",
];
if (
  manifest.schemaVersion !== 1 ||
  manifest.sourceDirty ||
  !/^0\.2\.\d+$/.test(manifest.version) ||
  !required.every((f) => manifest.features?.includes(f))
)
  throw Error("A clean paired 0.2 SDK with all editor features is required");
if (
  manifest.native.platform !==
  { darwin: "Darwin", win32: "Windows", linux: "Linux" }[process.platform]
)
  throw Error("Native SDK platform does not match this computer");
const normalizeArch = (a) =>
  ({ aarch64: "arm64", x86_64: "x64", AMD64: "x64" })[a] || a;
if (normalizeArch(manifest.native.architecture) !== process.arch)
  throw Error("Native SDK architecture mismatch");
for (const artifact of [manifest.native, manifest.web]) {
  if (!artifact.file || basename(artifact.file) !== artifact.file)
    throw Error("Invalid SDK archive name");
  if (hash(await readFile(join(root, artifact.file))) !== artifact.sha256)
    throw Error("SDK archive checksum mismatch: " + artifact.file);
}
const work = await mkdtemp(join(tmpdir(), "nova-editor-install-"));
try {
  for (const name of ["native", "web"]) {
    await mkdir(join(work, name));
    execFileSync(
      "cmake",
      ["-E", "tar", "xf", join(root, manifest[name].file)],
      { cwd: join(work, name) },
    );
  }
  const nativeEntries = await readdir(join(work, "native"), {
      withFileTypes: true,
    }),
    prefix = join(
      work,
      "native",
      nativeEntries.find((f) => f.isDirectory()).name,
    );
  await access(join(prefix, "include/imgui.h"));
  const nativeInfo = JSON.parse(
      await readFile(join(prefix, "share/nova-render/build-info.json"), "utf8"),
    ),
    webInfo = JSON.parse(
      await readFile(join(work, "web/package/assets/manifest.json"), "utf8"),
    );
  for (const info of [nativeInfo, webInfo])
    if (
      info.sourceDirty ||
      info.version !== manifest.version ||
      info.sourceCommit !== manifest.sourceCommit
    )
      throw Error("SDK provenance mismatch");
  await rm(".sdk/native", { recursive: true, force: true });
  await cp(prefix, ".sdk/native", { recursive: true });
  await rm("apps/web/public/sdk", { recursive: true, force: true });
  await mkdir("apps/web/public/sdk", { recursive: true });
  await cp(join(work, "web/package/src"), "apps/web/public/sdk/src", {
    recursive: true,
  });
  await cp(join(work, "web/package/assets"), "apps/web/public/sdk/generated", {
    recursive: true,
  });
  await mkdir(".sdk/package", { recursive: true });
  await writeFile(".sdk/package/manifest.json", manifestBytes);
  const files = {};
  async function scan(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.isDirectory()) await scan(path);
      else files[path] = hash(await readFile(path));
    }
  }
  for (const dir of [
    ".sdk/native",
    ".sdk/support",
    ".sdk/package",
    "apps/web/public/sdk",
  ])
    await scan(dir);
  const lock = {
    formatVersion: 2,
    channel: "local-package",
    releaseId: null,
    sourceCommit: manifest.sourceCommit,
    sourceDirty: false,
    target: process.platform + "-" + process.arch,
    configuration: manifest.native.configuration,
    version: manifest.version,
    extensions: [],
    package: {
      manifestSha256: hash(manifestBytes),
      native: manifest.native,
      web: manifest.web,
    },
    files,
  };
  await writeFile("nova-sdk.lock.json", JSON.stringify(lock, null, 2) + "\n");
  console.log(
    "Installed paired SDK",
    manifest.version,
    manifest.sourceCommit,
    "files",
    Object.keys(files).length,
  );
} finally {
  await rm(work, { recursive: true, force: true });
}
