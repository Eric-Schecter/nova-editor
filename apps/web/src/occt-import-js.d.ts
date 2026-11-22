declare module "occt-import-js" {
  export default function createOCCT(options: { locateFile: () => string }): Promise<{
    ReadStepFile(input: Uint8Array, params: object): import("../../../packages/asset-system/step").StepResult;
  }>;
}
