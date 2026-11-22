import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

const cache = new WeakMap<Uint8Array, Blob | null>();
const pending = new WeakMap<Uint8Array, Promise<Blob | null>>();
let worker: Worker | undefined;
let queue = Promise.resolve();

function preview(bytes: Uint8Array): Promise<Blob | null> {
  if (cache.has(bytes)) return Promise.resolve(cache.get(bytes) ?? null);
  const existing = pending.get(bytes);
  if (existing) return existing;
  const task = queue.then(() => new Promise<Blob | null>((resolve) => {
    worker ??= new Worker(new URL("./asset-preview.worker.ts", import.meta.url), { type: "module" });
    const current = worker;
    current.onmessage = ({ data }) => resolve(data);
    current.onerror = () => {
      current.terminate();
      worker = undefined;
      resolve(null);
    };
    current.postMessage({ bytes });
  })).catch(() => null).then((image) => {
    cache.set(bytes, image);
    pending.delete(bytes);
    return image;
  });
  queue = task.then(() => {});
  pending.set(bytes, task);
  return task;
}

export function AssetPreview({ bytes }: { bytes?: Uint8Array }) {
  const tile = useRef<HTMLSpanElement>(null);
  const [url, setUrl] = useState("");
  useEffect(() => {
    setUrl("");
    if (!bytes || !tile.current) return;
    let active = true, objectUrl = "";
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      void preview(bytes).then((blob) => {
        if (!active || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      });
    });
    observer.observe(tile.current);
    return () => {
      active = false;
      observer.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [bytes]);
  return (
    <span ref={tile} className="asset-icon" aria-hidden="true">
      {url ? <img className="asset-preview" src={url} alt="" draggable={false} /> : <Icon name="cube" />}
    </span>
  );
}
