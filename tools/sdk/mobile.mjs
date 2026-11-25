import { mkdir, readFile, rename, rm, writeFile, mkdtemp } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertLockedManifest, sha256, validateManifest } from "./core.mjs";
import { cachedBytes } from "./download.mjs";
import { cachePath } from "./paths.mjs";
import { extract, readLock } from "./install.mjs";
import { withInstallLock } from "./transaction.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const [target, localFolder] = process.argv.slice(2);
if (!["ios-arm64", "ios-simulator-arm64", "android-arm64"].includes(target))
  throw Error("Usage: node tools/sdk/mobile.mjs <ios-arm64|ios-simulator-arm64|android-arm64> [paired-package-directory]");

await withInstallLock(root, async () => {
  const lock = await readLock(root);
  const entry = lock?.package?.nativeTargets?.[target];
  if (!entry) throw Error("The locked release has no SDK for " + target);
  const cache = join(root, cachePath);
  const readArtifact = (name, hash) => localFolder
    ? readFile(join(localFolder, name))
    : cachedBytes(cache, new URL(name, lock.package.manifestUrl).href, hash);
  const bytes = await readArtifact("manifest.json", lock.package.manifestSha256);
  const manifest = validateManifest(JSON.parse(bytes), { platform: target.slice(0, -6), arch: "arm64" });
  assertLockedManifest(lock, bytes, manifest, { switchingTarget: true });
  if (JSON.stringify(entry) !== JSON.stringify(manifest.native))
    throw Error("The mobile SDK descriptor differs from the release manifest");

  const archive = await readArtifact(entry.file, entry.sha256);
  if (sha256(archive) !== entry.sha256) throw Error("Mobile SDK archive checksum mismatch");
  const folder = entry.file.slice(0, -4);
  const dest = join(root, "deps/nova/mobile", folder);
  await mkdir(dirname(dest), { recursive: true });
  const temp = await mkdtemp(join(dirname(dest), ".install-"));
  try {
    const zip = join(temp, entry.file);
    await writeFile(zip, archive);
    await extract(zip, join(temp, "sdk"));
    const source = join(temp, "sdk", folder);
    const backup = join(temp, "backup");
    let backedUp = false;
    try {
      await rename(dest, backup);
      backedUp = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      await rename(source, dest);
    } catch (error) {
      if (backedUp) await rename(backup, dest);
      throw error;
    }
    console.log(`Installed Nova ${lock.version} for ${target} in ${dest}`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
