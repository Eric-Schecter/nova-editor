import {
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
  lstat,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  repository,
  version,
  releaseURL,
  sha256,
  isHash,
  validateManifest,
} from "./core.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
async function githubAPI(url, maxBytes) {
  const address = new URL(url);
  const { stdout } = await execFileAsync(
    "gh",
    ["api", address.pathname + address.search, "--hostname", "github.com"],
    { encoding: "buffer", maxBuffer: maxBytes + 1024, timeout: 30000 },
  );
  if (stdout.length > maxBytes) throw Error("SDK download exceeds size limit");
  return stdout;
}
async function fetchWithNode(
  url,
  { fetcher = fetch, maxBytes = 256 * 1024 * 1024 } = {},
) {
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(30000),
    headers: {
      "User-Agent": "nova-editor-sdk",
      ...(url.startsWith("https://api.github.com/") &&
      (process.env.GITHUB_TOKEN || process.env.GH_TOKEN)
        ? {
            Authorization: `Bearer ${process.env.GITHUB_TOKEN || process.env.GH_TOKEN}`,
          }
        : {}),
      Accept: url.startsWith("https://api.github.com/")
        ? "application/vnd.github+json"
        : "application/octet-stream",
    },
  });
  if (!response.ok) {
    if (
      fetcher === fetch &&
      url.startsWith("https://api.github.com/repos/" + repository + "/") &&
      [403, 429].includes(response.status)
    ) {
      console.warn(
        "GitHub API request rejected; trying the existing authenticated gh session.",
      );
      try {
        return await githubAPI(url, maxBytes);
      } catch {
        throw Error(
          "GitHub API limit reached. Set GITHUB_TOKEN/GH_TOKEN or sign in with gh, then retry; installed SDK was not changed.",
        );
      }
    }
    throw Error(`SDK download failed (${response.status}): ${url}`);
  }
  if (Number(response.headers?.get("content-length")) > maxBytes)
    throw Error("SDK download exceeds size limit");
  const chunks = [];
  let size = 0;
  if (response.body) {
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > maxBytes) throw Error("SDK download exceeds size limit");
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw Error("SDK download exceeds size limit");
  return bytes;
}
export async function fetchBytes(url, options = {}) {
  try {
    return await fetchWithNode(url, options);
  } catch (error) {
    // System curl uses the same official URL and normal TLS validation. It helps hosts
    // where Node's connection/redirect handling times out; hashes are still mandatory.
    if (
      (options.fetcher && options.fetcher !== fetch) ||
      !["TypeError", "TimeoutError", "AbortError"].includes(error.name)
    )
      throw error;
    const max = options.maxBytes ?? 256 * 1024 * 1024;
    console.warn(
      "Node download failed; retrying the same official URL with system curl.",
    );
    try {
      const { stdout } = await execFileAsync(
        "curl",
        [
          "--fail",
          "--location",
          "--silent",
          "--show-error",
          "--proto",
          "=https",
          "--proto-redir",
          "=https",
          "--max-time",
          "600",
          "--max-filesize",
          String(max),
          "--user-agent",
          "nova-editor-sdk",
          url,
        ],
        { encoding: "buffer", maxBuffer: max + 1024, timeout: 605000 },
      );
      if (stdout.length > max) throw Error("SDK download exceeds size limit");
      return stdout;
    } catch (curlError) {
      throw Error(
        `SDK download failed with Node and curl: ${curlError.message}`,
      );
    }
  }
}
export async function resumableBytes(
  url,
  path,
  expected,
  { maxBytes = 256 * 1024 * 1024, runner = execFileAsync } = {},
) {
  await mkdir(dirname(path), { recursive: true });
  async function partial() {
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes)
        throw Error("Invalid partial SDK download");
      return await readFile(path);
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const before = await partial();
    if (before && sha256(before) === expected) return before;
    console.log(
      `Downloading ${new URL(url).pathname.split("/").at(-1)} (${before?.length ?? 0} bytes cached; attempt ${attempt}/3)`,
    );
    let error;
    try {
      await runner(
        "curl",
        [
          "--fail",
          "--location",
          "--silent",
          "--show-error",
          "--proto",
          "=https",
          "--proto-redir",
          "=https",
          "--connect-timeout",
          "20",
          "--max-time",
          "600",
          "--max-filesize",
          String(maxBytes),
          "--continue-at",
          "-",
          "--output",
          path,
          "--user-agent",
          "nova-editor-sdk",
          url,
        ],
        { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 605000 },
      );
    } catch (e) {
      error = e;
    }
    const bytes = await partial();
    if (bytes && sha256(bytes) === expected) return bytes;
    if (!error) {
      await rm(path, { force: true });
      throw Error("SDK download checksum mismatch: " + url);
    }
    if (![16, 18, 28, 35, 52, 55, 56, 92].includes(error.code) || attempt === 3)
      throw Error(
        "SDK download interrupted; unverified partial file retained for resume: " +
          error.message,
      );
  }
}
export async function cachedBytes(
  cache,
  url,
  expected,
  { offline = false, fetcher = fetch, maxBytes } = {},
) {
  if (!isHash(expected)) throw Error("Missing pinned download checksum");
  const path = join(cache, expected);
  try {
    const bytes = await readFile(path);
    if (sha256(bytes) !== expected)
      throw Error("SDK cache checksum mismatch: " + path);
    return bytes;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (offline) throw Error("Offline SDK cache miss: " + expected);
  const partialPath = join(cache, "partial", expected + ".part");
  const bytes =
    fetcher === fetch && maxBytes === undefined
      ? await resumableBytes(url, partialPath, expected)
      : await fetchBytes(url, { fetcher, maxBytes });
  if (sha256(bytes) !== expected)
    throw Error("SDK download checksum mismatch: " + url);
  await mkdir(cache, { recursive: true });
  const temp = path + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temp, bytes, { flag: "wx" });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
  await rm(partialPath, { force: true });
  return bytes;
}
export async function releaseMetadata(input, { fetcher = fetch } = {}) {
  const v = version(input),
    data = JSON.parse(
      await fetchBytes(
        `https://api.github.com/repos/${repository}/releases/tags/v${v}`,
        { fetcher, maxBytes: 2 * 1024 * 1024 },
      ),
    );
  if (
    data.tag_name !== `v${v}` ||
    data.draft ||
    data.prerelease ||
    !Number.isSafeInteger(data.id) ||
    data.id <= 0 ||
    !Array.isArray(data.assets)
  )
    throw Error("Expected a published stable versioned Release");
  const entry = data.assets.find((a) => a.name === "manifest.json"),
    digest = entry?.digest?.replace(/^sha256:/, "");
  if (!isHash(digest) || entry.browser_download_url !== releaseURL(v))
    throw Error("Release must provide manifest.json with a SHA-256 digest");
  return { data, version: v, digest, url: entry.browser_download_url };
}
export async function resolveRelease(input, cache, options = {}) {
  const release = await releaseMetadata(input, options),
    bytes = await cachedBytes(cache, release.url, release.digest, {
      ...options,
      maxBytes: 1024 * 1024,
    }),
    manifest = validateManifest(JSON.parse(bytes), {
      expectedVersion: release.version,
    });
  for (const name of ["native", "web"]) {
    const a = manifest[name],
      entry = release.data.assets.find((e) => e.name === a.file),
      url = new URL(a.file, release.url).href;
    if (
      entry?.browser_download_url !== url ||
      entry.digest !== `sha256:${a.sha256}`
    )
      throw Error("Release asset does not match paired manifest: " + a.file);
  }
  return { ...release, bytes, manifest };
}
export async function checkUpdates(current, { fetcher = fetch } = {}) {
  const entries = JSON.parse(
    await fetchBytes(
      `https://api.github.com/repos/${repository}/releases?per_page=100`,
      { fetcher, maxBytes: 4 * 1024 * 1024 },
    ),
  );
  if (!Array.isArray(entries)) throw Error("Invalid release list");
  const candidates = entries
    .filter(
      (r) =>
        !r.draft &&
        !r.prerelease &&
        /^v0\.5\.(0|[1-9]\d*)$/.test(r.tag_name) &&
        r.assets?.some((a) => a.name === "manifest.json"),
    )
    .sort(
      (a, b) =>
        Number(b.tag_name.split(".").at(-1)) -
        Number(a.tag_name.split(".").at(-1)),
    );
  return { current, latest: candidates[0]?.tag_name.slice(1) ?? null };
}
