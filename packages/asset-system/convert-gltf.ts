import { readGLB, writeGLB } from "./index";

const limit = 128 * 1024 * 1024;
const imageTypes: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  webp: "image/webp",
  ktx2: "image/ktx2",
  avif: "image/avif",
};
export function resourcePath(uri: string) {
  const path = decodeURIComponent(uri);
  const parts = path.split("/");
  if (
    /[\\:?#\x00-\x1f]/.test(path) ||
    parts.some((p) => !p || p === "..") || parts.at(-1) === "."
  )
    throw Error("资源必须是模型目录内的相对路径");
  return parts.filter((part) => part !== ".").join("/");
}

export function packGLTF(
  source: Uint8Array,
  load: (path: string) => Uint8Array,
) {
  const json = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(source),
  );
  if (json.asset?.version !== "2.0") throw Error("需要 glTF 2.0");
  const parts: { offset: number; bytes: Uint8Array }[] = [];
  let size = 0;
  function append(bytes: Uint8Array) {
    const offset = Math.ceil(size / 4) * 4;
    size = offset + bytes.length;
    if (size > limit) throw Error("资源总大小超过 128 MiB");
    parts.push({ offset, bytes });
    return offset;
  }
  function read(uri: string) {
    if (typeof uri !== "string") throw Error("缺少资源 URI");
    const data = /^data:([^;,]*);base64,(.*)$/s.exec(uri);
    if (data) {
      if (data[2].length > Math.ceil(limit / 3) * 4)
        throw Error("资源超过 128 MiB");
      return {
        bytes: Uint8Array.from(atob(data[2]), (c) => c.charCodeAt(0)),
        mime: data[1],
      };
    }
    const path = resourcePath(uri);
    return {
      bytes: load(path),
      mime: imageTypes[path.split(".").pop()!.toLowerCase()],
    };
  }
  const buffers = (json.buffers ?? []).map((buffer: any) => {
    const { bytes } = read(buffer.uri);
    if (
      !Number.isSafeInteger(buffer.byteLength) ||
      buffer.byteLength <= 0 ||
      bytes.length < buffer.byteLength
    )
      throw Error("缓冲区长度无效");
    return {
      offset: append(bytes.subarray(0, buffer.byteLength)),
      length: buffer.byteLength,
    };
  });
  const views = json.bufferViews ?? [];
  function relocate(view: any) {
    const buffer = buffers[view.buffer];
    const offset = view.byteOffset ?? 0;
    if (
      !Number.isSafeInteger(view.buffer) ||
      !buffer ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(view.byteLength) ||
      view.byteLength <= 0 ||
      offset + view.byteLength > buffer.length
    )
      throw Error("缓冲视图越界");
    view.buffer = 0;
    view.byteOffset = buffer.offset + offset;
  }
  for (const view of views) {
    relocate(view);
    for (const name of ["EXT_meshopt_compression", "KHR_meshopt_compression"])
      if (view.extensions?.[name]) relocate(view.extensions[name]);
  }
  for (const image of json.images ?? []) {
    if (image.uri === undefined) continue;
    const { bytes, mime } = read(image.uri);
    image.mimeType ??= mime;
    if (!bytes.length || !Object.values(imageTypes).includes(image.mimeType))
      throw Error("不支持的贴图类型");
    image.bufferView = views.length;
    views.push({
      buffer: 0,
      byteOffset: append(bytes),
      byteLength: bytes.length,
    });
    delete image.uri;
  }
  if (views.length) json.bufferViews = views;
  if (size) json.buffers = [{ byteLength: size }];
  else delete json.buffers;
  const bin = new Uint8Array(size);
  for (const part of parts) bin.set(part.bytes, part.offset);
  return writeGLB({ json, bin, extra: [] });
}

// Keep ranges needed by retained views, including compressed meshopt payloads.
function compactSplitBuffer(
  json: any,
  bin: Uint8Array,
  imageViews: Set<number>,
) {
  const views: any[] = json.bufferViews ?? [];
  const references: { owner: any; key: string }[] = [];
  function collect(value: any, metadata = false) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "extras") continue;
      if (
        key === "bufferView" ||
        (metadata &&
          ["values", "arrayOffsets", "stringOffsets"].includes(key) &&
          typeof child === "number")
      ) {
        if (
          !Number.isSafeInteger(child) ||
          Number(child) < 0 ||
          Number(child) >= views.length
        )
          throw Error("无效缓冲视图引用");
        references.push({ owner: value, key });
        imageViews.delete(Number(child));
      } else collect(child, metadata || key === "EXT_structural_metadata");
    }
  }
  collect(json);
  const indices = new Map<number, number>();
  const retained = views.filter((_, index) => {
    if (imageViews.has(index)) return false;
    indices.set(index, indices.size);
    return true;
  });
  const ranges = retained
    .flatMap((view) =>
      [
        view,
        view.extensions?.EXT_meshopt_compression,
        view.extensions?.KHR_meshopt_compression,
      ].filter(Boolean),
    )
    .map((view) => {
      const start = view.byteOffset ?? 0;
      const end = start + view.byteLength;
      if (
        view.buffer !== 0 ||
        !Number.isSafeInteger(start) ||
        start < 0 ||
        !Number.isSafeInteger(view.byteLength) ||
        view.byteLength <= 0 ||
        end > bin.length
      )
        throw Error("缓冲视图越界");
      return { view, start, end };
    })
    .sort((a, b) => a.start - b.start);
  const chunks: { start: number; end: number; offset: number }[] = [];
  let length = 0;
  for (const range of ranges) {
    const start = Math.floor(range.start / 4) * 4;
    let chunk = chunks[chunks.length - 1];
    if (!chunk || start > chunk.end) {
      chunk = { start, end: range.end, offset: Math.ceil(length / 4) * 4 };
      chunks.push(chunk);
    }
    chunk.end = Math.max(chunk.end, range.end);
    length = chunk.offset + chunk.end - chunk.start;
    range.view.byteOffset = chunk.offset + range.start - chunk.start;
  }
  for (const { owner, key } of references) owner[key] = indices.get(owner[key]);
  if (retained.length) json.bufferViews = retained;
  else delete json.bufferViews;
  const result = new Uint8Array(length);
  for (const chunk of chunks)
    result.set(bin.subarray(chunk.start, chunk.end), chunk.offset);
  return result;
}

export function splitGLB(source: Uint8Array) {
  const { json, bin, extra } = readGLB(source);
  if (extra.length) throw Error("GLB 含有无法拆出的自定义数据块");
  const files: Record<string, Uint8Array> = {};
  if (json.buffers?.length) {
    const buffer = json.buffers[0];
    if (
      !Number.isSafeInteger(buffer.byteLength) ||
      buffer.byteLength <= 0 ||
      buffer.byteLength > bin.length
    )
      throw Error("无效 BIN 长度");
    buffer.uri = "model.bin";
    files[buffer.uri] = bin.subarray(0, buffer.byteLength);
  }
  const imageViews = new Set<number>();
  for (const [index, image] of (json.images ?? []).entries()) {
    if (image.bufferView === undefined) {
      const data = /^data:([^;,]*);base64,(.*)$/s.exec(image.uri ?? "");
      const extension =
        data && Object.keys(imageTypes).find((k) => imageTypes[k] === data[1]);
      if (!data || !extension)
        throw Error("GLB 引用了外部贴图或不支持的图片类型");
      image.uri = `image-${index + 1}.${extension}`;
      files[image.uri] = Uint8Array.from(atob(data[2]), (c) => c.charCodeAt(0));
      continue;
    }
    const view = json.bufferViews?.[image.bufferView];
    const extension = Object.keys(imageTypes).find(
      (k) => imageTypes[k] === image.mimeType,
    );
    const start = view?.byteOffset ?? 0;
    if (
      !extension ||
      !view ||
      view.buffer !== 0 ||
      !Number.isSafeInteger(start) ||
      start < 0 ||
      !Number.isSafeInteger(view.byteLength) ||
      view.byteLength <= 0 ||
      start + view.byteLength > (json.buffers?.[0]?.byteLength ?? 0)
    )
      throw Error("内嵌贴图无效");
    image.uri = `image-${index + 1}.${extension}`;
    files[image.uri] = bin.slice(start, start + view.byteLength);
    imageViews.add(image.bufferView);
    delete image.bufferView;
  }
  if (imageViews.size) {
    const packed = compactSplitBuffer(json, files["model.bin"], imageViews);
    if (packed.length) {
      json.buffers[0].byteLength = packed.length;
      files["model.bin"] = packed;
    } else {
      delete json.buffers;
      delete files["model.bin"];
    }
  }
  files["model.gltf"] = new TextEncoder().encode(JSON.stringify(json, null, 2));
  return files;
}
