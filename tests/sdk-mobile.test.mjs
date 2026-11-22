import assert from "node:assert/strict";
import test from "node:test";
import {
  assertLockedManifest,
  assertPaired,
  requiredFeatures,
  sha256,
  validateManifest,
} from "../tools/sdk/core.mjs";

const sourceCommit = "a".repeat(40);
const features = [
  ...requiredFeatures,
  "scene-animation",
  "scene-animation-queries",
  "hybrid-rendering",
];
const mobileFeatures = features.filter(
  (feature) => feature !== "application-ui" && !feature.startsWith("ray-"),
);
function native(platform, uiEnabled, file) {
  return {
    file,
    sha256: "b".repeat(64),
    platform,
    architecture: "arm64",
    configuration: "Release",
    uiEnabled,
    features: uiEnabled ? features : mobileFeatures,
  };
}
const manifest = {
  schemaVersion: 1,
  version: "0.10.28",
  sourceCommit,
  sourceDirty: false,
  features,
  native: native("Darwin", true, "desktop.zip"),
  nativeTargets: {
    "ios-arm64": native("iOS", false, "ios.zip"),
    "ios-simulator-arm64": native("iOS-Simulator", false, "sim.zip"),
    "android-arm64": native("Android", false, "android.zip"),
  },
  web: { file: "web.tgz", sha256: "c".repeat(64), packageName: "@nova/render-web" },
};
function select(platform, input = manifest) {
  return validateManifest(input, { platform, arch: "arm64" });
}

test("mobile SDKs have distinct targets and may disable desktop UI and ray features", () => {
  for (const [platform, file] of [
    ["ios", "ios.zip"], ["ios-simulator", "sim.zip"], ["android", "android.zip"],
  ]) {
    const selected = select(platform);
    assert.equal(selected.native.file, file);
    assert.equal(selected.native.uiEnabled, false);
    assert.doesNotThrow(() =>
      assertPaired(selected, { ...selected, ...selected.native }, selected));
  }
  assert.equal(select("darwin").native.file, "desktop.zip");
  assert.throws(() => select("ios", { ...manifest, nativeTargets: undefined }), /No matching/);
  assert.throws(() => select("ios-unknown"), /No matching/);
});

test("same-release target switch preserves the manifest and Web pin", () => {
  const bytes = Buffer.from(JSON.stringify(manifest));
  const ios = select("ios");
  const android = select("android");
  const lock = {
    sourceCommit,
    version: manifest.version,
    package: { manifestSha256: sha256(bytes), native: ios.native, web: ios.web },
  };
  assert.throws(() => assertLockedManifest(lock, bytes, android), /artifact descriptor changed/);
  const options = { switchingTarget: true };
  assert.doesNotThrow(() => assertLockedManifest(lock, bytes, android, options));
  assert.throws(() => assertLockedManifest(lock, Buffer.from("altered"), android, options), /manifest changed/);
  assert.throws(() => assertLockedManifest(lock, bytes, { ...android, web: { ...android.web, file: "other.tgz" } }, options), /artifact descriptor changed/);
});
