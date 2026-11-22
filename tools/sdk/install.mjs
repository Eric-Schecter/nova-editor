// Paired SDK download/install. Renderer source is never compiled or patched here.
import {
  readFile,
  mkdir,
  readdir,
  rm,
  cp,
  writeFile,
  access,
} from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  sha256,
  validateManifest,
  assertPaired,
  assertLockedManifest,
  validateLockedRelease,
  validateArchiveEntries,
  version,
  parseReleaseURL,
  isHash,
  sdkTarget,
} from "./core.mjs";
import { layout, stateRoot, cachePath, currentLayoutLock } from "./paths.mjs";
import { cachedBytes, resolveRelease } from "./download.mjs";
import { withInstallLock, replaceInstall } from "./transaction.mjs";
export async function readLock(root) {
  try {
    return JSON.parse(await readFile(join(root, "nova-sdk.lock.json"), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
async function hashFiles(root, relative, files = {}) {
  const path = join(root, relative);
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (e) {
    throw e;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const next = relative + "/" + entry.name;
    if (entry.isDirectory()) await hashFiles(root, next, files);
    else if (entry.isFile())
      files[next] = sha256(await readFile(join(root, next)));
    else
      throw Error("SDK installation contains unsupported file type: " + next);
  }
  return files;
}
export async function installedFilesForWeb(root, relative) {
  return hashFiles(root, relative);
}
export async function installedFiles(root) {
  const files = {};
  for (const p of [layout.native, layout.package, layout.web])
    await hashFiles(root, p, files);
  return files;
}
async function extract(file, destination) {
  await mkdir(destination, { recursive: true });
  const options = { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 };
  const names = execFileSync("cmake", ["-E", "tar", "tf", file], options),
    listing = execFileSync("cmake", ["-E", "tar", "tvf", file], options);
  validateArchiveEntries(names, listing);
  execFileSync("cmake", ["-E", "tar", "xf", file], {
    cwd: destination,
    stdio: "pipe",
  });
}
export async function installPair(
  root,
  bytes,
  archives,
  { release = null, frozen = null } = {},
) {
  root = resolve(root);
  const manifest = validateManifest(JSON.parse(bytes));
  for (const name of ["native", "web"])
    if (sha256(archives[name]) !== manifest[name].sha256)
      throw Error("SDK archive checksum mismatch: " + name);
  if (frozen) assertLockedManifest(frozen, bytes, manifest);
  const work = join(root, stateRoot, "transactions", randomUUID());
  await mkdir(work, { recursive: true });
  try {
    for (const name of ["native", "web"]) {
      const archive = join(work, manifest[name].file);
      await writeFile(archive, archives[name]);
      await extract(archive, join(work, "extract-" + name));
    }
    const entries = await readdir(join(work, "extract-native"), {
      withFileTypes: true,
    });
    if (entries.length !== 1 || !entries[0].isDirectory())
      throw Error("Native SDK must contain one top-level directory");
    const prefix = join(work, "extract-native", entries[0].name),
      web = join(work, "extract-web/package");
    for (const file of [
      ...(manifest.native.uiEnabled ? ["include/imgui.h"] : []),
      "include/render/Renderer.hpp",
      "lib/cmake/Nova/NovaConfig.cmake",
    ])
      await access(join(prefix, file));
    const nativeInfo = JSON.parse(
        await readFile(
          join(prefix, "share/nova-render/build-info.json"),
          "utf8",
        ),
      ),
      webInfo = JSON.parse(
        await readFile(join(web, "assets/manifest.json"), "utf8"),
      ),
      pkg = JSON.parse(await readFile(join(web, "package.json"), "utf8"));
    assertPaired(manifest, nativeInfo, webInfo, pkg);
    await access(join(web, "src/Nova.js"));
    await access(join(web, "assets/model.json"));
    if (
      !webInfo.assets ||
      Array.isArray(webInfo.assets) ||
      typeof webInfo.assets !== "object" ||
      !webInfo.assets["model.json"]
    )
      throw Error("Missing Web shader asset manifest");
    for (const [file, digest] of Object.entries(webInfo.assets)) {
      if (
        !/^[a-zA-Z0-9._-]+$/.test(file) ||
        !isHash(digest) ||
        sha256(await readFile(join(web, "assets", file))) !== digest
      )
        throw Error("Web shader/resource manifest mismatch: " + file);
    }
    await cp(prefix, join(work, "new-0"), { recursive: true });
    await mkdir(join(work, "new-1"));
    await cp(join(web, "src"), join(work, "new-1/src"), { recursive: true });
    await cp(join(web, "assets"), join(work, "new-1/generated"), {
      recursive: true,
    });
    await mkdir(join(work, "new-2"));
    await writeFile(join(work, "new-2/manifest.json"), bytes);
    await writeFile(
      join(work, "new-2/web-package.json"),
      JSON.stringify(pkg, null, 2) + "\n",
    );
    const staged = join(work, "inventory");
    await mkdir(join(staged, "deps/nova"), { recursive: true });
    // Inventory staged files under their final paths without touching the active installation.
    await cp(join(work, "new-0"), join(staged, layout.native), {
      recursive: true,
    });
    await cp(join(work, "new-1"), join(staged, layout.web), {
      recursive: true,
    });
    await cp(join(work, "new-2"), join(staged, layout.package), {
      recursive: true,
    });
    const files = await installedFiles(staged);

    if (
      frozen &&
      JSON.stringify(Object.entries(files).sort()) !==
        JSON.stringify(Object.entries(frozen.files).sort())
    )
      throw Error("Installed file inventory differs from lock");
    const lock = frozen ?? {
      formatVersion: 4,
      layout: { ...layout },
      channel: release ? "github-release" : "local-package",
      releaseId: release?.data.id ?? null,
      ...(release
        ? {
            release: {
              repository: "Eric-Schecter/nova-render",
              tag: `v${manifest.version}`,
              assetIds: Object.fromEntries(
                ["manifest.json", manifest.native.file, manifest.web.file].map(
                  (name) => [
                    name,
                    release.data.assets.find((a) => a.name === name).id,
                  ],
                ),
              ),
            },
          }
        : {}),
      sourceCommit: manifest.sourceCommit,
      sourceDirty: false,
      target: sdkTarget(),
      configuration: manifest.native.configuration,
      version: manifest.version,
      extensions: [],
      package: {
        ...(release ? { manifestUrl: release.url } : {}),
        manifestSha256: sha256(bytes),
        native: manifest.native,
        web: manifest.web,
      },
      files,
    };
    await cp(join(work, "new-1"), join(work, "new-3"), { recursive: true });
    await writeFile(join(work, "new-4"), JSON.stringify(lock, null, 2) + "\n");
    await replaceInstall(root, work);
    console.log(
      `Installed paired Nova ${lock.version} (${lock.sourceCommit.slice(0, 12)}, ${lock.channel}, ${Object.keys(files).length} files)`,
    );
    return lock;
  } finally {
    try {
      await access(join(root, stateRoot, "install-state.json"));
    } catch (e) {
      if (e.code === "ENOENT") await rm(work, { recursive: true, force: true });
      else throw e;
    }
  }
}
export async function importLegacyCache(root) {
  const old = join(root, ".sdk/cache/sha256"),
    dest = join(root, cachePath);
  let entries;
  try {
    entries = await readdir(old, { withFileTypes: true });
  } catch (e) {
    if (e.code === "ENOENT") return;
    throw e;
  }
  for (const entry of entries)
    if (entry.isFile() && isHash(entry.name)) {
      const bytes = await readFile(join(old, entry.name));
      if (sha256(bytes) !== entry.name)
        throw Error("Legacy SDK cache checksum mismatch: " + entry.name);
      try {
        await access(join(dest, entry.name));
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
        await mkdir(dest, { recursive: true });
        await writeFile(join(dest, entry.name), bytes, { flag: "wx" });
      }
    }
}
export async function restoreLocked(
  root,
  { offline = false, fetcher = fetch } = {},
) {
  return withInstallLock(root, async () => {
    const lock = currentLayoutLock(await readLock(root));
    validateLockedRelease(lock);
    await importLegacyCache(root);
    const cache = join(root, cachePath),
      url = lock.package.manifestUrl;
    const bytes = await cachedBytes(cache, url, lock.package.manifestSha256, {
        offline,
        fetcher,
        maxBytes: 1024 * 1024,
      }),
      manifest = validateManifest(JSON.parse(bytes), {
        expectedVersion: lock.version,
      });
    assertLockedManifest(lock, bytes, manifest);
    const archives = {};
    for (const name of ["native", "web"])
      archives[name] = await cachedBytes(
        cache,
        new URL(manifest[name].file, url).href,
        manifest[name].sha256,
        { offline, fetcher },
      );
    return installPair(root, bytes, archives, { frozen: lock });
  });
}
export async function updateRelease(root, input, { fetcher = fetch } = {}) {
  return withInstallLock(root, async () => {
    const lock = await readLock(root);
    await importLegacyCache(root);
    const release = await resolveRelease(
      version(input),
      join(root, cachePath),
      { fetcher },
    );
    if (
      lock?.version === release.version &&
      lock.channel === "github-release"
    ) {
      assertLockedManifest(lock, release.bytes, release.manifest, {
        switchingTarget: lock.target !== sdkTarget(),
      });
      if (
        lock.formatVersion >= 3 &&
        lock.channel === "github-release" &&
        lock.releaseId !== release.data.id
      )
        throw Error("Locked Release identity changed");
    }
    const archives = {};
    for (const name of ["native", "web"])
      archives[name] = await cachedBytes(
        join(root, cachePath),
        new URL(release.manifest[name].file, release.url).href,
        release.manifest[name].sha256,
        { fetcher },
      );
    return installPair(root, release.bytes, archives, { release });
  });
}
export async function installLocal(root, path) {
  return withInstallLock(root, async () => {
    const lock = await readLock(root);
    const bytes = await readFile(path),
      m = validateManifest(JSON.parse(bytes)),
      archives = {};
    for (const name of ["native", "web"])
      archives[name] = await readFile(join(dirname(path), m[name].file));
    return installPair(root, bytes, archives);
  });
}
export async function main(args = process.argv.slice(2)) {
  const offline = args.includes("--offline"),
    pos = args.filter((x) => x !== "--offline");
  if (pos.length > 1 || pos.some((x) => x.startsWith("--")))
    throw Error(
      "Usage: sdk:install [exact-version | official-manifest-URL | local-manifest] [--offline]",
    );
  const input = pos[0],
    root = process.cwd();
  if (!input) return restoreLocked(root, { offline });
  const remote = /^https?:/.test(input)
    ? parseReleaseURL(input)
    : /^v?\d+\.\d+\.\d+$/.test(input)
      ? version(input)
      : null;
  if (remote) {
    const lock = await readLock(root);
    if (lock?.channel === "github-release" && lock.formatVersion >= 3) {
      if (remote !== lock.version)
        throw Error("Use sdk:update <exact-version> to change the lock");
      return restoreLocked(root, { offline });
    }
    if (offline) throw Error("First Release pin requires network access");
    return updateRelease(root, remote);
  }
  if (offline) throw Error("--offline is for restoring a GitHub Release lock");
  return installLocal(root, resolve(input));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
