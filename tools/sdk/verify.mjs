import { readFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  sha256,
  validateManifest,
  assertPaired,
  assertLockedManifest,
  validateLockedRelease,
} from "./core.mjs";
import { layout, stateRoot, currentLayoutLock } from "./paths.mjs";
import { installedFiles, installedFilesForWeb } from "./install.mjs";
export async function verifyWebDeployment(root, lock) {
  const files = await installedFilesForWeb(root, layout.webPublic);
  const expected = Object.fromEntries(
    Object.entries(lock.files)
      .filter(([p]) => p.startsWith(layout.web + "/"))
      .map(([p, h]) => [layout.webPublic + p.slice(layout.web.length), h]),
  );
  if (
    JSON.stringify(Object.entries(files).sort()) !==
    JSON.stringify(Object.entries(expected).sort())
  )
    throw Error(
      "Web SDK deployment differs from locked deps/nova/web; run sdk:sync-web",
    );
}
export async function verify(root = process.cwd(), { deployment = true } = {}) {
  try {
    await access(join(root, stateRoot, "install-state.json"));
    throw Error(
      "SDK installation is incomplete; run sdk:install to recover before building",
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const lock = JSON.parse(
    await readFile(join(root, "nova-sdk.lock.json"), "utf8"),
  );
  if (
    lock.formatVersion !== 4 ||
    lock.sourceDirty !== false ||
    lock.extensions?.length !== 0 ||
    !["local-package", "github-release"].includes(lock.channel)
  )
    throw Error("Expected a clean paired SDK lock without private extensions");
  currentLayoutLock(lock);
  currentLayoutLock(lock);
  if (lock.formatVersion >= 3 && lock.channel === "github-release")
    validateLockedRelease(lock);
  const bytes = await readFile(join(root, layout.package, "manifest.json")),
    manifest = validateManifest(JSON.parse(bytes), {
      expectedVersion: lock.version,
    });
  assertLockedManifest(lock, bytes, manifest);
  const native = JSON.parse(
      await readFile(
        join(root, layout.native, "share/nova-render/build-info.json"),
        "utf8",
      ),
    ),
    web = JSON.parse(
      await readFile(join(root, layout.web, "generated/manifest.json"), "utf8"),
    );
  let pkg;
  if (lock.formatVersion >= 3)
    pkg = JSON.parse(
      await readFile(join(root, layout.package, "web-package.json"), "utf8"),
    );
  assertPaired(manifest, native, web, pkg);
  const actual = await installedFiles(root);
  if (
    JSON.stringify(Object.entries(actual).sort()) !==
    JSON.stringify(Object.entries(lock.files).sort())
  )
    throw Error(
      "SDK file checksum/inventory mismatch; run sdk:install to restore locked packages",
    );
  if (deployment) await verifyWebDeployment(root, lock);
  console.log(
    `Verified Nova ${lock.version}: ${Object.keys(actual).length} files (${lock.channel}, ${lock.target}, source ${lock.sourceCommit.slice(0, 12)}).`,
  );
  return lock;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  verify().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
