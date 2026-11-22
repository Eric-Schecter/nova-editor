export async function convertFBX(file: File, target: "fbx" | "glb") {
  const input = await file.arrayBuffer();
  const worker = new Worker(new URL("./fbx.worker.ts", import.meta.url), {
    type: "module",
  });
  try {
    return await new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("FBX 转换超时")), 120000);
      const finish = (callback: () => void) => {
        clearTimeout(timer);
        callback();
      };
      worker.onmessage = ({ data }) =>
        finish(() => data.error ? reject(Error(data.error)) : resolve(new Uint8Array(data.output)));
      worker.onerror = () => finish(() => reject(Error("无法启动 FBX 转换器")));
      worker.postMessage({
        input,
        target,
        moduleURL: new URL("fbx/nova_fbx.mjs", document.baseURI).href,
      }, [input]);
    });
  } finally {
    worker.terminate();
  }
}
