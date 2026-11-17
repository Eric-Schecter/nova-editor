import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
  rename,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  sha256,
  requiredFeatures,
  validateManifest,
  assertPaired,
  assertLockedManifest,
  parseReleaseURL,
  validateArchiveEntries,
  releaseURL,
} from "../tools/sdk/core.mjs";
import {
  cachedBytes,
  resumableBytes,
  resolveRelease,
  checkUpdates,
} from "../tools/sdk/download.mjs";
import {
  replaceInstall,
  withInstallLock,
  recoverInstall,
} from "../tools/sdk/transaction.mjs";
import {
  installPair,
  restoreLocked,
  updateRelease,
} from "../tools/sdk/install.mjs";
import { verify } from "../tools/sdk/verify.mjs";
import {
  layout,
  sdkTargets,
  cachePath,
  stateRoot,
  currentLayoutLock,
} from "../tools/sdk/paths.mjs";
import { syncWeb } from "../tools/sdk/sync-web.mjs";
const info = {
  version: "0.3.0",
  sourceCommit: "1".repeat(40),
  sourceDirty: false,
  uiEnabled: true,
  platform: { darwin: "Darwin", linux: "Linux", win32: "Windows" }[
    process.platform
  ],
  architecture: process.arch,
  configuration: "Release",
  features: requiredFeatures,
};
const makeManifest = () => ({
  schemaVersion: 1,
  version: info.version,
  sourceCommit: info.sourceCommit,
  sourceDirty: false,
  features: requiredFeatures,
  native: {
    file: "native.zip",
    sha256: "a".repeat(64),
    platform: info.platform,
    architecture: info.architecture,
    configuration: "Release",
    uiEnabled: true,
  },
  web: {
    file: "web.tgz",
    sha256: "b".repeat(64),
    packageName: "@nova/render-web",
  },
});
async function temporary(fn) {
  const root = await mkdtemp(join(tmpdir(), "nova-sdk-test-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
async function put(root, path, bytes) {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), bytes);
}
function releaseData(m, bytes) {
  return {
    id: 42,
    tag_name: "v" + m.version,
    draft: false,
    prerelease: false,
    assets: [
      {
        id: 1,
        name: "manifest.json",
        digest: "sha256:" + sha256(bytes),
        browser_download_url: releaseURL(m.version),
      },
      ...["native", "web"].map((k, i) => ({
        id: i + 2,
        name: m[k].file,
        digest: "sha256:" + m[k].sha256,
        browser_download_url: new URL(m[k].file, releaseURL(m.version)).href,
      })),
    ],
  };
}
async function fixtures(root, v = "0.3.0") {
  const buildInfo = { ...info, version: v };
  const files = {
    "n/sdk/include/imgui.h": "//imgui",
    "n/sdk/include/render/Renderer.hpp": "//Renderer",
    "n/sdk/lib/cmake/Nova/NovaConfig.cmake": "# CMake",
    "n/sdk/share/nova-render/build-info.json": JSON.stringify(buildInfo),
    "w/package/package.json": JSON.stringify({
      name: "@nova/render-web",
      version: v,
    }),
    "w/package/src/Nova.js": `export const version="${v}";`,
    "w/package/assets/model.json": "{}",
    "w/package/assets/manifest.json": JSON.stringify({
      ...buildInfo,
      assets: { "model.json": sha256("{}") },
    }),
  };
  for (const [path, data] of Object.entries(files)) await put(root, path, data);
  execFileSync(
    "cmake",
    ["-E", "tar", "cf", join(root, "native.zip"), "--format=zip", "sdk"],
    { cwd: join(root, "n") },
  );
  execFileSync(
    "cmake",
    ["-E", "tar", "czf", join(root, "web.tgz"), "package"],
    { cwd: join(root, "w") },
  );
  const archives = {
      native: await readFile(join(root, "native.zip")),
      web: await readFile(join(root, "web.tgz")),
    },
    m = makeManifest();
  m.version = v;
  for (const key of ["native", "web"]) m[key].sha256 = sha256(archives[key]);
  return { m, bytes: Buffer.from(JSON.stringify(m)), archives };
}

test("SDK contract rejects incompatible versions, platforms, missing features and mixed module/shader provenance", () => {
  validateManifest(makeManifest());
  for (const change of [
    (m) => (m.version = "0.4.0"),
    (m) => (m.sourceDirty = true),
    (m) => (m.native.platform = "wrong"),
    (m) => (m.native.architecture = "wrong"),
    (m) => (m.native.configuration = "Debug"),
    (m) => (m.features = []),
    (m) => (m.web.file = "../web.tgz"),
    (m) => (m.native.sha256 = "oops"),
  ]) {
    const m = structuredClone(makeManifest());
    change(m);
    assert.throws(() => validateManifest(m));
  }
  const m = makeManifest();
  assertPaired(m, info, info, {
    name: "@nova/render-web",
    version: info.version,
  });
  assert.throws(() =>
    assertPaired(m, info, { ...info, sourceCommit: "2".repeat(40) }),
  );
  assert.throws(() =>
    assertPaired(m, info, info, { name: "@nova/render-web", version: "0.3.1" }),
  );
  assert.equal(parseReleaseURL(releaseURL("0.3.0")), "0.3.0");
  for (const url of [
    "http://github.com/Eric-Schecter/nova-render/releases/download/v0.3.0/manifest.json",
    releaseURL("0.3.0") + "?x=1",
    "https://example.org/manifest.json",
  ])
    assert.throws(() => parseReleaseURL(url));
  const bytes = Buffer.from(JSON.stringify(m)),
    lock = {
      version: m.version,
      sourceCommit: m.sourceCommit,
      package: { manifestSha256: sha256(bytes), native: m.native, web: m.web },
    };
  assertLockedManifest(lock, bytes, m);
  assert.throws(() => assertLockedManifest(lock, Buffer.from("{}"), m));
});
test("SDK cache is hash-addressed, supports offline reuse, and rejects corruption and failed downloads", () =>
  temporary(async (root) => {
    const data = Buffer.from("archive"),
      digest = sha256(data);
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return new Response(data);
    };
    assert.deepEqual(
      await cachedBytes(root, "https://example.test/archive", digest, {
        fetcher,
      }),
      data,
    );
    assert.deepEqual(
      await cachedBytes(root, "ignored", digest, { offline: true }),
      data,
    );
    assert.equal(calls, 1);
    await assert.rejects(
      cachedBytes(root, "ignored", "a".repeat(64), { offline: true }),
      /cache miss/,
    );
    await writeFile(join(root, digest), "tampered");
    await assert.rejects(
      cachedBytes(root, "ignored", digest, { offline: true }),
      /checksum/,
    );
    await assert.rejects(
      cachedBytes(root, "url", "b".repeat(64), { fetcher }),
      /checksum/,
    );
    await assert.rejects(
      cachedBytes(root, "url", "c".repeat(64), {
        fetcher: async () => new Response("", { status: 503 }),
      }),
      /503/,
    );
  }));
test("Release discovery verifies manifest/asset digests and checking never installs", () =>
  temporary(async (root) => {
    const m = makeManifest(),
      bytes = Buffer.from(JSON.stringify(m)),
      data = releaseData(m, bytes);
    const fetcher = async (url) =>
      new Response(url.includes("/tags/") ? JSON.stringify(data) : bytes);
    assert.equal(
      (await resolveRelease("0.3.0", root, { fetcher })).manifest.version,
      "0.3.0",
    );
    data.assets[1].digest = "sha256:" + "f".repeat(64);
    await assert.rejects(resolveRelease("0.3.0", root, { fetcher }), /asset/);
    const before = await readdir(root),
      result = await checkUpdates("0.3.0", {
        fetcher: async () =>
          new Response(
            JSON.stringify([
              data,
              { ...data, tag_name: "v0.4.0" },
              { ...data, tag_name: "v0.3.9", prerelease: true },
            ]),
          ),
      });
    assert.equal(result.latest, "0.3.0");
    assert.deepEqual(await readdir(root), before);
  }));
test("SDK archive guard rejects traversal and symlinks before extracting", () => {
  validateArchiveEntries("sdk/\nsdk/file\n", "drwxr-xr-x dir\n-rw-r--r-- file");
  for (const path of [
    "../escape",
    "/absolute",
    "C:/windows",
    "sdk/../escape",
    "sdk\\escape",
  ])
    assert.throws(() => validateArchiveEntries(path, "-rw file"));
  assert.throws(() =>
    validateArchiveEntries("sdk/link", "lrwxrwxrwx link -> target"),
  );
});
test("Installation restores all previous paths and lock on a mid-swap failure, and recovers an interrupted install", () =>
  temporary(async (root) => {
    const targets = [
      "deps/nova/native",
      "deps/nova/web",
      "deps/nova/package",
      "apps/web/public/sdk",
      "nova-sdk.lock.json",
    ];
    for (const p of targets)
      await put(root, p, p === "nova-sdk.lock.json" ? "old-lock" : "old-" + p);
    const work = join(root, ".cache/nova/transactions", randomUUID());
    await mkdir(work, { recursive: true });
    for (let i = 0; i < 5; i++)
      await writeFile(join(work, "new-" + i), "new-" + i);
    let calls = 0;
    await assert.rejects(
      replaceInstall(root, work, {
        renameFile: async (a, b) => {
          if (++calls === 4) throw Error("simulated disk failure");
          return rename(a, b);
        },
      }),
      /disk failure/,
    );
    for (const p of targets)
      assert.equal(
        await readFile(join(root, p), "utf8"),
        p === "nova-sdk.lock.json" ? "old-lock" : "old-" + p,
      );
    const work2 = join(root, ".cache/nova/transactions", randomUUID());
    await mkdir(work2, { recursive: true });
    for (let i = 0; i < 5; i++) await writeFile(join(work2, "new-" + i), "new");
    await rename(join(root, targets[0]), join(work2, "old-0"));
    await rename(join(work2, "new-0"), join(root, targets[0]));
    await writeFile(
      join(root, ".cache/nova/install-state.json"),
      JSON.stringify({
        id: work2.split("/").at(-1),
        hadOriginal: [true, true, true, true, true],
        committed: false,
      }),
    );
    await recoverInstall(root);
    assert.equal(
      await readFile(join(root, targets[0]), "utf8"),
      "old-" + targets[0],
    );
  }));
test("SDK installer rejects concurrent replacement", () =>
  temporary(async (root) => {
    await withInstallLock(root, async () => {
      await assert.rejects(
        withInstallLock(root, async () => {}),
        /Another SDK/,
      );
    });
  }));
test("Real package extraction installs a paired Release, replays lock offline exactly, and leaves active SDK intact on bad updates", () =>
  temporary(async (root) => {
    const f = await fixtures(root),
      data = releaseData(f.m, f.bytes),
      release = { data, url: releaseURL("0.3.0") };
    await mkdir(join(root, "apps/web/public"), { recursive: true });
    const lock = await installPair(root, f.bytes, f.archives, { release });
    assert.equal(lock.channel, "github-release");
    await verify(root);
    const lockBytes = await readFile(join(root, "nova-sdk.lock.json"));
    for (const [bytes, digest] of [
      [f.bytes, sha256(f.bytes)],
      [f.archives.native, f.m.native.sha256],
      [f.archives.web, f.m.web.sha256],
    ])
      await put(root, ".cache/nova/sha256/" + digest, bytes);
    await rm(join(root, "apps/web/public/sdk"), { recursive: true });
    await restoreLocked(root, { offline: true });
    assert.deepEqual(
      await readFile(join(root, "nova-sdk.lock.json")),
      lockBytes,
    );
    await verify(root);
    const legacy = JSON.parse(lockBytes);
    legacy.formatVersion = 2;
    legacy.releaseId = null;
    await writeFile(join(root, "nova-sdk.lock.json"), JSON.stringify(legacy));
    await updateRelease(root, "0.3.0", {
      fetcher: async (url) =>
        new Response(url.includes("/tags/") ? JSON.stringify(data) : f.bytes),
    });
    assert.deepEqual(
      await readFile(join(root, "nova-sdk.lock.json")),
      lockBytes,
    );
    await assert.rejects(
      installPair(
        root,
        f.bytes,
        { ...f.archives, web: Buffer.from("corrupt") },
        { release },
      ),
      /checksum/,
    );
    assert.deepEqual(
      await readFile(join(root, "nova-sdk.lock.json")),
      lockBytes,
    );
    const badManifest = { ...f.m, sourceCommit: "2".repeat(40) },
      badBytes = Buffer.from(JSON.stringify(badManifest)),
      badRelease = releaseData(badManifest, badBytes);
    await assert.rejects(
      updateRelease(root, "0.3.0", {
        fetcher: async (url) =>
          new Response(
            url.includes("/tags/") ? JSON.stringify(badRelease) : badBytes,
          ),
      }),
      /Locked Release manifest changed/,
    );
    assert.deepEqual(
      await readFile(join(root, "nova-sdk.lock.json")),
      lockBytes,
    );
    // Valid archive checksums do not excuse conflicting embedded provenance.
    await put(
      root,
      "w/package/assets/manifest.json",
      JSON.stringify({ ...info, sourceCommit: "3".repeat(40) }),
    );
    execFileSync(
      "cmake",
      ["-E", "tar", "czf", join(root, "wrong-web.tgz"), "package"],
      { cwd: join(root, "w") },
    );
    const wrong = await readFile(join(root, "wrong-web.tgz")),
      m = { ...f.m, web: { ...f.m.web, sha256: sha256(wrong) } };
    await assert.rejects(
      installPair(
        root,
        Buffer.from(JSON.stringify(m)),
        { native: f.archives.native, web: wrong },
        { release },
      ),
      /provenance/,
    );
    await verify(root);
  }));

test("Explicit version update changes both package versions together and pins the new revision", () =>
  temporary(async (root) => {
    const old = await fixtures(join(root, "old")),
      next = await fixtures(join(root, "next"), "0.3.1");
    await mkdir(join(root, "apps/web/public"), { recursive: true });
    await installPair(root, old.bytes, old.archives, {
      release: {
        data: releaseData(old.m, old.bytes),
        url: releaseURL("0.3.0"),
      },
    });
    const data = releaseData(next.m, next.bytes),
      fetcher = async (url) =>
        new Response(
          url.includes("/tags/")
            ? JSON.stringify(data)
            : url.endsWith("manifest.json")
              ? next.bytes
              : url.endsWith("native.zip")
                ? next.archives.native
                : next.archives.web,
        );
    await updateRelease(root, "0.3.1", { fetcher });
    const lock = await verify(root);
    assert.equal(lock.version, "0.3.1");
    assert.equal(lock.package.manifestUrl, releaseURL("0.3.1"));
    assert.equal(
      JSON.parse(
        await readFile(
          join(root, "apps/web/public/sdk/generated/manifest.json"),
        ),
      ).version,
      "0.3.1",
    );
    assert.equal(
      JSON.parse(
        await readFile(
          join(root, "deps/nova/native/share/nova-render/build-info.json"),
        ),
      ).version,
      "0.3.1",
    );
  }));

test("A failed first install removes newly placed SDK paths and never leaves a partial lock", () =>
  temporary(async (root) => {
    const targets = [
        "deps/nova/native",
        "deps/nova/web",
        "deps/nova/package",
        "apps/web/public/sdk",
        "nova-sdk.lock.json",
      ],
      work = join(root, ".cache/nova/transactions", randomUUID());
    await mkdir(work, { recursive: true });
    await mkdir(join(root, "apps/web/public"), { recursive: true });
    for (let i = 0; i < 5; i++) await writeFile(join(work, "new-" + i), "new");
    let n = 0;
    await assert.rejects(
      replaceInstall(root, work, {
        renameFile: async (a, b) => {
          if (++n === 3) throw Error("first install failure");
          return rename(a, b);
        },
      }),
      /first install failure/,
    );
    for (const p of targets)
      await assert.rejects(access(join(root, p)), { code: "ENOENT" });
  }));

test("CLI restores a clean checkout from only its lock and cached artifacts without the old support directory", () =>
  temporary(async (root) => {
    const f = await fixtures(join(root, "fixtures")),
      data = releaseData(f.m, f.bytes),
      installed = join(root, "installed");
    await mkdir(join(installed, "apps/web/public"), { recursive: true });
    await installPair(installed, f.bytes, f.archives, {
      release: { data, url: releaseURL("0.3.0") },
    });
    const bytes = await readFile(join(installed, "nova-sdk.lock.json"));
    const clean = join(root, "clean");
    await mkdir(join(clean, "apps/web/public"), { recursive: true });
    await writeFile(join(clean, "nova-sdk.lock.json"), bytes);
    for (const [payload, digest] of [
      [f.bytes, sha256(f.bytes)],
      [f.archives.native, f.m.native.sha256],
      [f.archives.web, f.m.web.sha256],
    ])
      await put(clean, ".cache/nova/sha256/" + digest, payload);
    execFileSync(
      process.execPath,
      [
        new URL("../tools/sdk/install.mjs", import.meta.url).pathname,
        "--offline",
      ],
      { cwd: clean, stdio: "pipe" },
    );
    await verify(clean);
    assert.deepEqual(await readFile(join(clean, "nova-sdk.lock.json")), bytes);
    await assert.rejects(access(join(clean, ".sdk/support")), {
      code: "ENOENT",
    });
  }));

test("Partial downloads resume across interrupted transfers and never accept unchecked bytes", () =>
  temporary(async (root) => {
    const bytes = Buffer.from("complete SDK archive"),
      path = join(root, "partial/package.part");
    let attempts = 0;
    const result = await resumableBytes(
      "https://github.com/Eric-Schecter/nova-render/releases/download/v0.3.0/native.zip",
      path,
      sha256(bytes),
      {
        runner: async (_cmd, args) => {
          assert.equal(args[args.indexOf("--continue-at") + 1], "-");
          if (++attempts === 1) {
            await writeFile(path, bytes.subarray(0, 5));
            const e = Error("connection closed");
            e.code = 18;
            throw e;
          }
          assert.equal((await readFile(path)).length, 5);
          await writeFile(path, bytes);
        },
      },
    );
    assert.deepEqual(result, bytes);
    assert.equal(attempts, 2);
    await rm(path);
    await assert.rejects(
      resumableBytes("https://github.com/x/wrong.zip", path, sha256(bytes), {
        runner: async () => {
          await writeFile(path, "wrong bytes");
        },
      }),
      /checksum/,
    );
    await assert.rejects(access(path), { code: "ENOENT" });
  }));

function oldLayout(lock) {
  const result = structuredClone(lock);
  result.formatVersion = 3;
  delete result.layout;
  result.files = Object.fromEntries(
    Object.entries(lock.files).map(([p, h]) => [
      p
        .replace("deps/nova/native/", ".sdk/native/")
        .replace("deps/nova/package/", ".sdk/package/")
        .replace("deps/nova/web/", "apps/web/public/sdk/"),
      h,
    ]),
  );
  return result;
}
test("Legacy path migration keeps every artifact pin and uses the previous offline cache", () =>
  temporary(async (root) => {
    const f = await fixtures(root),
      release = { data: releaseData(f.m, f.bytes), url: releaseURL("0.3.0") };
    const modern = await installPair(root, f.bytes, f.archives, { release }),
      legacy = oldLayout(modern);
    await writeFile(join(root, "nova-sdk.lock.json"), JSON.stringify(legacy));
    await rm(join(root, "deps"), { recursive: true });
    await rm(join(root, layout.webPublic), { recursive: true });
    for (const [bytes, digest] of [
      [f.bytes, sha256(f.bytes)],
      [f.archives.native, f.m.native.sha256],
      [f.archives.web, f.m.web.sha256],
    ])
      await put(root, ".sdk/cache/sha256/" + digest, bytes);
    await restoreLocked(root, { offline: true });
    const migrated = await verify(root);
    assert.equal(migrated.formatVersion, 4);
    assert.deepEqual(migrated.package, legacy.package);
    assert.deepEqual(migrated.release, legacy.release);
    assert.deepEqual(migrated.files, modern.files);
    assert.deepEqual(currentLayoutLock(legacy), modern);
    assert.ok(
      Object.keys(migrated.files).every((p) => p.startsWith("deps/nova/")),
    );
    await access(join(root, cachePath, sha256(f.bytes)));
  }));
test("Web deployment repairs from visible packages, keeps the lock unchanged and refuses corrupt canonical sources", () =>
  temporary(async (root) => {
    const f = await fixtures(root);
    await installPair(root, f.bytes, f.archives, {
      release: { data: releaseData(f.m, f.bytes), url: releaseURL("0.3.0") },
    });
    const before = await readFile(join(root, "nova-sdk.lock.json"));
    await writeFile(
      join(root, layout.webPublic, "src/Nova.js"),
      "bad deployment",
    );
    await assert.rejects(verify(root), /deployment differs/);
    await syncWeb(root);
    await verify(root);
    assert.deepEqual(await readFile(join(root, "nova-sdk.lock.json")), before);
    await rm(join(root, layout.webPublic), { recursive: true });
    await syncWeb(root);
    await verify(root);
    await writeFile(
      join(root, layout.web, "src/Nova.js"),
      "bad canonical source",
    );
    await assert.rejects(syncWeb(root), /checksum/);
    assert.notEqual(
      await readFile(join(root, layout.webPublic, "src/Nova.js"), "utf8"),
      "bad canonical source",
    );
  }));
test("Interrupted legacy installation is recovered before migrating to the visible layout", () =>
  temporary(async (root) => {
    const targets = [
        ".sdk/native",
        "apps/web/public/sdk",
        ".sdk/package",
        "nova-sdk.lock.json",
      ],
      work = join(root, ".sdk/transactions", randomUUID());
    await mkdir(work, { recursive: true });
    for (const p of targets) await put(root, p, "old-" + p);
    for (let i = 0; i < 4; i++) await writeFile(join(work, "new-" + i), "new");
    await rename(join(root, targets[0]), join(work, "old-0"));
    await rename(join(work, "new-0"), join(root, targets[0]));
    await writeFile(
      join(root, ".sdk/install-state.json"),
      JSON.stringify({
        id: work.split("/").at(-1),
        hadOriginal: [true, true, true, true],
        committed: false,
      }),
    );
    await withInstallLock(root, async () => {});
    assert.equal(
      await readFile(join(root, targets[0]), "utf8"),
      "old-" + targets[0],
    );
    await assert.rejects(access(join(root, ".sdk/install-state.json")), {
      code: "ENOENT",
    });
  }));
