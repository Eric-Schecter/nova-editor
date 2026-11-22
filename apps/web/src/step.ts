export async function convertSTEP(file: File) {
  const input = await file.arrayBuffer();
  const worker = new Worker(new URL("./step.worker.ts", import.meta.url), { type: "module" });
  try {
    return await new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("STEP 转换超时")), 120000);
      worker.onmessage = ({ data }) => {
        clearTimeout(timer);
        if (data.error) reject(Error(data.error));
        else resolve(new Uint8Array(data.output));
      };
      worker.onerror = () => {
        clearTimeout(timer);
        reject(Error("无法启动 STEP 转换器"));
      };
      worker.postMessage(input, [input]);
    });
  } finally {
    worker.terminate();
  }
}
