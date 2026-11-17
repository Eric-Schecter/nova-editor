import { createHash } from "node:crypto";
export const repository = "Eric-Schecter/nova-render";
export const requiredFeatures = [
  "static-scenes",
  "camera-viewport",
  "scene-picking",
  "material-slots",
  "scene-bvh-shadows",
  "raster-fog",
  "environment-clear",
  "application-ui",
  "scene-lights",
];
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export const isHash = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function version(value) {
  const v = String(value).replace(/^v/, "");
  if (!/^0\.5\.(0|[1-9]\d*)$/.test(v))
    throw Error(
      "Editor supports stable Nova 0.5.x; specify an exact version, for example 0.5.0",
    );
  return v;
}
export function releaseURL(v) {
  return `https://github.com/${repository}/releases/download/v${version(v)}/manifest.json`;
}
export function parseReleaseURL(input) {
  const url = new URL(input),
    match = url.pathname.match(
      /^\/Eric-Schecter\/nova-render\/releases\/download\/v(0\.5\.(?:0|[1-9]\d*))\/manifest\.json$/,
    );
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    !match
  )
    throw Error("Expected an official versioned Nova Release manifest URL");
  return version(match[1]);
}
export function artifact(value) {
  if (
    !value ||
    typeof value.file !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value.file) ||
    !isHash(value.sha256)
  )
    throw Error("Invalid SDK archive name or SHA-256");
  return value;
}
export function validateManifest(
  m,
  { platform = process.platform, arch = process.arch, expectedVersion } = {},
) {
  if (
    m?.schemaVersion !== 1 ||
    m.sourceDirty !== false ||
    !/^[a-f0-9]{40}$/.test(m.sourceCommit ?? "") ||
    version(m.version) !== m.version ||
    !Array.isArray(m.features) ||
    !requiredFeatures.every((f) => m.features.includes(f))
  )
    throw Error(
      "A clean paired Nova 0.5.x manifest with all editor features is required",
    );
  if (expectedVersion && m.version !== expectedVersion)
    throw Error("Release tag and manifest version mismatch");
  artifact(m.native);
  artifact(m.web);
  const nativePlatform = { darwin: "Darwin", win32: "Windows", linux: "Linux" }[
    platform
  ];
  const nativeArch =
    { aarch64: "arm64", x86_64: "x64", AMD64: "x64" }[m.native.architecture] ??
    m.native.architecture;
  if (m.native.platform !== nativePlatform || nativeArch !== arch)
    throw Error(
      `No matching native package for ${platform}-${arch}; manifest contains ${m.native.platform}-${nativeArch}. No fallback to a different version or platform.`,
    );
  if (
    m.native.uiEnabled !== true ||
    m.native.configuration !== "Release" ||
    m.web.packageName !== "@nova/render-web"
  )
    throw Error("Expected UI-enabled Release SDK and @nova/render-web package");
  return m;
}
export function assertPaired(m, native, web, pkg) {
  for (const info of [native, web])
    if (
      info.sourceDirty !== false ||
      info.version !== m.version ||
      info.sourceCommit !== m.sourceCommit
    )
      throw Error("Native/Web/shader provenance mismatch");
  if (
    native.uiEnabled !== true ||
    native.platform !== m.native.platform ||
    native.architecture !== m.native.architecture ||
    native.configuration !== m.native.configuration ||
    !requiredFeatures.every((f) => native.features?.includes(f))
  )
    throw Error("Native build metadata does not match manifest");
  if (pkg && (pkg.name !== m.web.packageName || pkg.version !== m.version))
    throw Error("Web module package metadata does not match shaders");
}
export function assertLockedManifest(lock, bytes, m) {
  if (
    !lock ||
    !isHash(lock.package?.manifestSha256) ||
    sha256(bytes) !== lock.package.manifestSha256 ||
    m.version !== lock.version ||
    m.sourceCommit !== lock.sourceCommit
  )
    throw Error(
      "Locked Release manifest changed; refusing to replace the pinned dependency",
    );
  for (const name of ["native", "web"])
    if (JSON.stringify(m[name]) !== JSON.stringify(lock.package[name]))
      throw Error("Locked artifact descriptor changed");
}
export function validateLockedRelease(lock) {
  if (
    !lock ||
    lock.channel !== "github-release" ||
    lock.sourceDirty !== false ||
    lock.extensions?.length !== 0 ||
    lock.target !== `${process.platform}-${process.arch}`
  )
    throw Error(
      "No matching GitHub Release lock. Run sdk:update <exact-version> first.",
    );
  const v = parseReleaseURL(lock.package?.manifestUrl);
  if (
    v !== lock.version ||
    !isHash(lock.package.manifestSha256) ||
    !Number.isSafeInteger(lock.releaseId) ||
    lock.releaseId <= 0
  )
    throw Error("Invalid GitHub Release lock");
  artifact(lock.package.native);
  artifact(lock.package.web);
  return v;
}
export function validateArchiveEntries(names, listing) {
  for (const name of names.split(/\r?\n/).filter(Boolean)) {
    const clean = name.endsWith("/") ? name.slice(0, -1) : name;
    if (
      !clean ||
      clean.startsWith("/") ||
      /[\\:\x00-\x1f]/.test(clean) ||
      clean.split("/").some((p) => !p || p === ".." || p === ".")
    )
      throw Error("Unsafe SDK archive path: " + name);
  }
  for (const line of listing.split(/\r?\n/).filter(Boolean))
    if (!/^[-d]/.test(line))
      throw Error(
        "SDK archives must contain only regular files and directories",
      );
}
