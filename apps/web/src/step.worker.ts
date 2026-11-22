import { stepMeshToGLB, stepMeshing } from "../../../packages/asset-system/step";
import createOCCT from "occt-import-js";
import wasm from "occt-import-js/dist/occt-import-js.wasm?url";

self.onmessage = async ({ data }: MessageEvent<ArrayBuffer>) => {
  try {
    const occt = await createOCCT({ locateFile: () => wasm });
    const bytes = stepMeshToGLB(occt.ReadStepFile(new Uint8Array(data), stepMeshing));
    self.postMessage({ output: bytes.buffer }, { transfer: [bytes.buffer] });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
