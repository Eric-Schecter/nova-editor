// Canonical installed packages are visible; only download/transaction state is hidden.
export const layout = Object.freeze({
  native: "deps/nova/native",
  web: "deps/nova/web",
  package: "deps/nova/package",
  webPublic: "apps/web/public/sdk",
});
export const stateRoot = ".cache/nova";
export const cachePath = stateRoot + "/sha256";
export const sdkTargets = [
  layout.native,
  layout.web,
  layout.package,
  layout.webPublic,
  "nova-sdk.lock.json",
];
export const legacyTargets = [
  ".sdk/native",
  layout.webPublic,
  ".sdk/package",
  "nova-sdk.lock.json",
];
export function currentLayoutLock(lock) {
  if (!lock)
    throw Error("Missing SDK lock; run sdk:update <exact-version> first");
  if (lock.formatVersion === 4) {
    if (
      !lock.layout ||
      Object.keys(lock.layout).length !== Object.keys(layout).length ||
      !Object.entries(layout).every(([k, v]) => lock.layout[k] === v)
    )
      throw Error("Unsupported SDK installation layout");
    return lock;
  }
  if (![2, 3].includes(lock.formatVersion))
    throw Error("Unsupported SDK lock format");
  const files = {};
  for (const [path, digest] of Object.entries(lock.files ?? {})) {
    const mapping = [
      [".sdk/native/", layout.native + "/"],
      [".sdk/package/", layout.package + "/"],
      [layout.webPublic + "/", layout.web + "/"],
    ].find(([prefix]) => path.startsWith(prefix));
    if (!mapping) throw Error("Unsupported legacy SDK inventory path: " + path);
    const next = mapping[1] + path.slice(mapping[0].length);
    if (
      next.split("/").some((p) => !p || p === "." || p === "..") ||
      /[\\:\x00-\x1f]/.test(next)
    )
      throw Error("Unsafe SDK inventory path");
    files[next] = digest;
  }
  return { ...lock, formatVersion: 4, layout: { ...layout }, files };
}
