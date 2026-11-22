import { createHash } from "node:crypto";
export const repository = "Eric-Schecter/nova-render";
export const requiredFeatures = [
  "static-scenes",
  "camera-viewport",
  "scene-picking",
  "material-slots",
  "material-alpha",
  "weighted-oit",
  "scene-bvh-shadows",
  "raster-fog",
  "environment-clear",
  "application-ui",
  "scene-lights",
  "ray-scene-instances",
  "ray-scene-lights",
  "ray-local-source-emission",
];
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export const isHash = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function version(value) {
  const v = String(value).replace(/^v/, "");
  if (!/^0\.(?:8|9|10)\.(0|[1-9]\d*)$/.test(v))
    throw Error(
      "Specify an exact stable Nova version in 0.8.x, 0.9.x or 0.10.x",
    );
  return v;
}
export function releaseURL(v) {
  return `https://github.com/${repository}/releases/download/v${version(v)}/manifest.json`;
}
export function parseReleaseURL(input) {
  const url = new URL(input),
    match = url.pathname.match(
      /^\/Eric-Schecter\/nova-render\/releases\/download\/v(0\.(?:8|9|10)\.(?:0|[1-9]\d*))\/manifest\.json$/,
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
const mobilePlatforms = {
  "ios-arm64": "iOS",
  "ios-simulator-arm64": "iOS-Simulator",
  "android-arm64": "Android",
};
export const sdkTarget = () =>
  process.env.NOVA_SDK_TARGET || `${process.platform}-${process.arch}`;
const mobileRequiredFeatures = requiredFeatures.filter(
  (feature) => feature !== "application-ui" && !feature.startsWith("ray-"),
);
export function validateManifest(m, { platform, arch, expectedVersion } = {}) {
  const target = platform ? `${platform}-${arch ?? process.arch}` : sdkTarget();
  const mobilePlatform = Object.hasOwn(mobilePlatforms, target)
    ? mobilePlatforms[target]
    : undefined;
  if (
    m?.schemaVersion !== 1 ||
    m.sourceDirty !== false ||
    !/^[a-f0-9]{40}$/.test(m.sourceCommit ?? "") ||
    version(m.version) !== m.version ||
    !Array.isArray(m.features)
  )
    throw Error("A clean, versioned Nova SDK manifest is required");
  if (expectedVersion && m.version !== expectedVersion)
    throw Error("Release tag and manifest version mismatch");

  const native = mobilePlatform ? m.nativeTargets?.[target] : m.native;
  const desktopTarget = /^(darwin|win32|linux)-(arm64|x64)$/.exec(target);
  const expectedPlatform = mobilePlatform ?? {
    darwin: "Darwin", win32: "Windows", linux: "Linux",
  }[desktopTarget?.[1]];
  const expectedArch = target.split("-").at(-1);
  const nativeArch = {
    aarch64: "arm64", x86_64: "x64", AMD64: "x64",
  }[native?.architecture] ?? native?.architecture;
  if (!native || !expectedPlatform || native.platform !== expectedPlatform || nativeArch !== expectedArch)
    throw Error(`No matching native package for ${target}. No fallback to another version or platform.`);
  artifact(native);
  artifact(m.web);
  const features = mobilePlatform ? native.features : m.features;
  if (
    !Array.isArray(features) ||
    !(mobilePlatform ? mobileRequiredFeatures : requiredFeatures).every((f) => features.includes(f)) ||
    (!m.version.startsWith("0.8.") &&
      !["scene-animation", "scene-animation-queries", "hybrid-rendering"].every((f) => features.includes(f)))
  )
    throw Error("SDK package is missing required editor features");
  if (
    (mobilePlatform ? typeof native.uiEnabled !== "boolean" : native.uiEnabled !== true) ||
    native.configuration !== "Release" ||
    m.web.packageName !== "@nova/render-web"
  )
    throw Error("Expected a compatible Release SDK and @nova/render-web package");
  return { ...m, native };
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
    native.uiEnabled !== m.native.uiEnabled ||
    native.platform !== m.native.platform ||
    native.architecture !== m.native.architecture ||
    native.configuration !== m.native.configuration ||
    !(m.native.features ?? requiredFeatures).every((f) => native.features?.includes(f))
  )
    throw Error("Native build metadata does not match manifest");
  if (pkg && (pkg.name !== m.web.packageName || pkg.version !== m.version))
    throw Error("Web module package metadata does not match shaders");
}
export function assertLockedManifest(lock, bytes, m, { switchingTarget = false } = {}) {
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
    if (!(switchingTarget && name === "native") &&
        JSON.stringify(m[name]) !== JSON.stringify(lock.package[name]))
      throw Error("Locked artifact descriptor changed");
}
export function validateLockedRelease(lock) {
  if (
    !lock ||
    lock.channel !== "github-release" ||
    lock.sourceDirty !== false ||
    lock.extensions?.length !== 0 ||
    lock.target !== sdkTarget()
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
