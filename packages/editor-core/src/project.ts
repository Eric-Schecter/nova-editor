import { projectPaths, validateEnvironmentBytes } from "./world";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { validateScene, type Scene } from "../../scene-schema/index";
export type ProjectData = { scene: Scene; assets: Record<string, Uint8Array> };
export function validateProject(project: ProjectData): ProjectData {
  const scene = validateScene(project.scene),
    assets: Record<string, Uint8Array> = {};
  for (const path of projectPaths(scene)) {
    const bytes = project.assets[path];
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength)
      throw Error(`缺少资产 ${path}`);
    if (path === scene.world?.environment.map) validateEnvironmentBytes(bytes);
    assets[path] = bytes;
  }
  if (project.assets["LICENSES.txt"])
    assets["LICENSES.txt"] = project.assets["LICENSES.txt"];
  return { scene, assets };
}
export function packProject(project: ProjectData) {
  const { scene, assets } = validateProject(project);
  return zipSync(
    { ...assets, "project.json": strToU8(JSON.stringify(scene, null, 2)) },
    { level: 0 },
  );
}
export function unpackProject(bytes: Uint8Array): ProjectData {
  if (bytes.byteLength > 128 * 1024 * 1024) throw Error("项目归档超过 128 MiB");
  let total = 0;
  const archive = unzipSync(bytes, {
    filter: (f) => {
      total += f.originalSize;
      if (total > 256 * 1024 * 1024) throw Error("解压大小超过 256 MiB");
      return true;
    },
  });
  if (!archive["project.json"]) throw Error("归档缺少 project.json");
  return validateProject({
    scene: JSON.parse(strFromU8(archive["project.json"])),
    assets: archive,
  });
}
export type Recovery = ProjectData & {
  id: string;
  updated: number;
  savedSnapshot: string;
};
export function validateRecovery(value: Recovery): Recovery {
  if (
    !value ||
    typeof value.id !== "string" ||
    typeof value.updated !== "number" ||
    !Number.isFinite(value.updated) ||
    typeof value.savedSnapshot !== "string"
  )
    throw Error("无效恢复记录");
  validateScene(JSON.parse(value.savedSnapshot));
  return {
    ...validateProject(value),
    id: value.id,
    updated: value.updated,
    savedSnapshot: value.savedSnapshot,
  };
}
