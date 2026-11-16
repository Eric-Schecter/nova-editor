import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const lock = JSON.parse(await readFile("nova-sdk.lock.json", "utf8"));
// A legacy extension must have an explicit upstream owner and migration phase.
const migration = JSON.parse(
  await readFile("packages/render-contract/migration.json", "utf8"),
);
for (const extension of lock.extensions ?? []) {
  const entry = migration.extensionOwnership[extension];
  if (
    !entry ||
    entry.implementationOwner !== "nova-render" ||
    !migration.phases.some(
      (phase) =>
        phase.id === entry.phase && phase.extensions.includes(extension),
    )
  )
    throw Error(
      `SDK extension lacks a reviewed owner/migration phase: ${extension}`,
    );
}
for (const [path, expected] of Object.entries(lock.files)) {
  const actual = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
  if (actual !== expected) throw Error(`SDK checksum mismatch: ${path}`);
}
if (lock.editorPatch) {
  for (const [path, expected] of [
    [lock.editorPatch.path, lock.editorPatch.sha256],
    [lock.editorPatch.baseManifest, lock.editorPatch.baseManifestSha256],
  ]) {
    const actual = createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
    if (actual !== expected)
      throw Error(`SDK provenance checksum mismatch: ${path}`);
  }
}
console.log(
  `Verified ${Object.keys(lock.files).length} SDK files (${lock.channel}, ${lock.target}).`,
);
