import {
  createEditorRenderer,
  previewMaterial,
} from "../../../packages/render-contract/bridge";
import { WorldPanel } from "./WorldPanel";
import {
  defaultWorld,
  validateWorld,
  environmentSettings,
  validateEnvironmentBytes,
  type WorldSettings,
} from "../../../packages/editor-core/src/world";
import { SceneObjectProperties } from "./SceneObjectProperties";
import {
  createCamera,
  createLight,
  setPrimary,
  primaryCamera,
  sceneCamera,
  sceneDirectional,
  captureCamera,
  aimObject,
} from "../../../packages/editor-core/src/scene-objects";
import { GroupTransform } from "./GroupTransform";
import {
  selectionFrame,
  selectionEdits,
  applySelectionEdits,
  readNodeTransform,
  writeNodeTransform,
  type TransformSpace,
} from "../../../packages/editor-core/src/selection-transform";
import { decodeModel, expandModel } from "../../../packages/asset-system/model";
import { AssetProperties } from "./AssetProperties";
import {
  defaultGeometry,
  makePrimitive,
  groundOffset,
  primitives,
  type PrimitiveType,
} from "../../../packages/asset-system/index";
import {
  defaultLighting,
  rendererLight,
  type LightingSettings,
} from "../../../packages/editor-core/src/lighting";
import { Menu } from "./Menu";
import { LightingPanel } from "./LightingPanel";
import {
  gridSteps,
  groundedTransform,
  surfaceQuery,
} from "../../../packages/editor-core/src/placement";
import type { ResourceDrag } from "./PlacementPreview";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { SceneTree, type TreeCommand } from "./SceneTree";
import {
  inheritedFlag,
  subtreeIds,
  selectionRoots,
  assertEditable,
  reparentNodes,
  deleteNodes,
  duplicateNodes,
  groupNodes,
  ungroupNodes,
  setNodeFlag,
} from "../../../packages/editor-core/src/hierarchy";
import {
  packProject,
  unpackProject,
  type Recovery,
} from "../../../packages/editor-core/src/project";
import { listRecoveries, writeRecovery, removeRecovery } from "./recovery";
import { EditorHistory } from "../../../packages/editor-core/src/index";
import {
  identity,
  emptyScene,
  validateScene,
  type SceneNode,
  type Transform,
} from "../../../packages/scene-schema/index";
import {
  worldMatrices,
  eulerQuaternion,
  quaternionEuler,
} from "../../../packages/scene-schema/transforms";
import {
  frameBounds,
  sceneBounds,
  type AssetBounds,
} from "../../../packages/editor-core/src/navigation";
import { Viewport } from "./Viewport";
import type { Camera } from "../../../packages/editor-core/src/viewport";
import { Icon } from "./Icon";
import "./style.css";
import "./theme.css";

type Renderer = {
  getSceneAssetBounds: (
    id: string,
  ) => { minimum: number[]; maximum: number[] } | null;
  pickScene: (ray: {
    origin: number[];
    direction: number[];
    includeIds?: string[];
    excludeIds?: string[];
  }) => { id: string; position: number[] } | null;
  setScene: (
    assets: { id: string; url: string; sourceSpace?: boolean }[],
    instances: {
      id: string;
      assetId: string;
      world: number[];
      castShadow?: boolean;
    }[],
  ) => Promise<unknown>;
  setCamera: (camera: Camera) => void;
  drawFrame: () => Promise<unknown>;
  enableOrbitControls: () => void;
  dispose: () => void;
  setClearColor: (c: number[]) => void;
  setLighting: (mode: "pbr" | "unlit") => void;
  setShadows: (settings: { enabled: boolean; softness: number }) => void;
  setDirectionalLight: (light: {
    direction: number[];
    color: number[];
    intensity: number;
  }) => void;
  loadEnvironment: (url: string | null) => Promise<unknown>;
  setEnvironment: (settings: {
    fogMode?: number;
    fogColor?: number[];
    fogNear?: number;
    fogFar?: number;
    fogDensity?: number;
    rotation: number;
    intensity: number;
    backgroundIntensity: number;
    showBackground: boolean;
  }) => void;
};
function NumberField({
  value,
  label,
  step = 0.1,
  onValue,
}: {
  value: number;
  label: string;
  step?: number;
  onValue: (value: number) => void;
}) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(String(value));
  const update = (raw: string) => setDraft(raw);
  const commit = (raw: string) => {
    setEditing(false);
    if (
      raw.trim() !== "" &&
      Number.isFinite(Number(raw)) &&
      Number(raw) !== value
    )
      onValue(Number(raw));
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      role="spinbutton"
      aria-label={label}
      aria-valuenow={value}
      value={editing ? draft : String(Number(value.toFixed(6)))}
      onFocus={() => {
        setDraft(String(value));
        setEditing(true);
      }}
      onInput={(e) => update(e.currentTarget.value)}
      onChange={(e) => update(e.currentTarget.value)}
      onBlur={(e) => commit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const current = Number(draft);
          update(
            String(
              (Number.isFinite(current) ? current : value) +
                (e.key === "ArrowUp" ? step : -step),
            ),
          );
        }
      }}
    />
  );
}
function NameField({
  id,
  value,
  onCommit,
}: {
  id: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [id, value]);
  const commit = () => {
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
    else setDraft(value);
  };
  return (
    <input
      aria-label="名称"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value);
          e.preventDefault();
        }
      }}
    />
  );
}
const history = new EditorHistory();
function App() {
  const [, render] = useState(0),
    [selection, setPrimarySelection] = useState<string | null>(null),
    [selections, setSelections] = useState<string[]>([]),
    [mainPreview, setMainPreview] = useState(false),
    [cameraNotice, setCameraNotice] = useState(""),
    [transformSpace, setTransformSpace] = useState<TransformSpace>("local"),
    [recoveries, setRecoveries] = useState<Recovery[]>([]),
    [recoveryDismissed, setRecoveryDismissed] = useState(false),
    [recoveryReady, setRecoveryReady] = useState(false),
    [recoveryStatus, setRecoveryStatus] = useState("恢复存储初始化中"),
    [status, setStatus] = useState("准备就绪"),
    [preview, setPreview] = useState("尚未加载模型"),
    [renderingBusy, setBusy] = useState(false),
    [projectBusy, setProjectBusy] = useState(false),
    [resourceDrag, setResourceDrag] = useState<ResourceDrag | null>(null),
    [gridSnap, setGridSnap] = useState(true),
    [lit, setLit] = useState(true),
    [light, setLight] = useState<LightingSettings>(defaultLighting),
    [sidebarTab, setSidebarTab] = useState<"scene" | "project" | "settings">(
      "scene",
    ),
    [assetsOpen, setAssetsOpen] = useState(false),
    [inspectorTab, setInspectorTab] = useState<
      "object" | "geometry" | "material" | "lighting" | "world"
    >("object"),
    [gridStep, setGridStep] = useState(1),
    [assetBounds, setAssetBounds] = useState<AssetBounds>({}),
    [camera, setCamera] = useState<Camera>({
      yaw: 25,
      pitch: 20,
      distance: 8,
      exposure: 1,
    });
  const busy = renderingBusy || projectBusy;
  const environmentCache = useRef<{ bytes?: Uint8Array; url?: string }>({});
  const documentIO = useRef(false);
  const canvas = useRef<HTMLCanvasElement>(null),
    renderer = useRef<Renderer | null>(null),
    urls = useRef<string[]>([]),
    assets = useRef<Record<string, Uint8Array>>({}),
    saved = useRef(JSON.stringify(history.scene)),
    generation = useRef(0),
    alive = useRef(true),
    renderQueue = useRef<Promise<void>>(Promise.resolve()),
    assetURLs = useRef(new Map<string, { bytes: Uint8Array; url: string }>()),
    helperData = useRef<Promise<{ name: string; world: number[] }[]> | null>(
      null,
    );
  const recoveryId = useRef(crypto.randomUUID());
  const selectMany = (ids: string[]) => {
    history.cancelPreview();
    setSelections(ids);
    if (
      ids.length > 1 ||
      history.scene.nodes.some(
        (n) => n.id === ids.at(-1) && (n.camera || n.light),
      )
    )
      setInspectorTab("object");
    setPrimarySelection(ids.at(-1) ?? null);
  };
  const select = (id: string | null) => selectMany(id ? [id] : []);
  const consumeAssetClick = useRef(false);
  const pendingFocus = useRef<string | null>(null),
    cameraLatest = useRef(camera);
  cameraLatest.current = camera;
  const modelInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null);
  const scene = history.scene,
    node = scene.nodes.find((n) => n.id === selection),
    dirty = JSON.stringify(scene) !== saved.current,
    modelDescendants = node ? subtreeIds(scene, [node.id]) : new Set<string>();
  let previewCamera: Camera | null = null;
  if (mainPreview)
    try {
      previewCamera = sceneCamera(scene);
    } catch {}
  const viewCamera = previewCamera ?? camera,
    activeSceneLight = sceneDirectional(scene);
  const refresh = () => render((n) => n + 1);
  const changeCamera = (value: Camera) => {
    if (mainPreview) return;
    try {
      renderer.current?.setCamera(value);
      cameraLatest.current = value;
      setCamera(value);
      if (renderer.current)
        void renderer.current.drawFrame().catch((e) => setStatus(String(e)));
    } catch (e) {
      setStatus(String(e));
    }
  };
  function changeLight(value: LightingSettings) {
    if (sceneDirectional(history.scene)) return;
    try {
      renderer.current?.setDirectionalLight(rendererLight(value));
      renderer.current?.setShadows({
        enabled: value.shadows,
        softness: value.softness,
      });
      setLight(value);
      if (renderer.current)
        void renderer.current.drawFrame().catch((e) => setStatus(String(e)));
    } catch (e) {
      setStatus(String(e));
    }
  }
  function changeLit(value: boolean) {
    try {
      renderer.current?.setLighting(value ? "pbr" : "unlit");
      setLit(value);
      if (renderer.current)
        void renderer.current.drawFrame().catch((e) => setStatus(String(e)));
    } catch (e) {
      setStatus(String(e));
    }
  }
  const edit = (fn: Parameters<EditorHistory["commit"]>[0]) => {
    if (documentIO.current) return;
    try {
      history.commit(fn);
      refresh();
      setStatus("场景已更新");
    } catch (e) {
      setStatus(String(e));
    }
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
      void renderQueue.current.finally(() => renderer.current?.dispose());
      urls.current.forEach(URL.revokeObjectURL);
      if (environmentCache.current.url)
        URL.revokeObjectURL(environmentCache.current.url);
    };
  }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur();
      if (JSON.stringify(history.scene) !== saved.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const sceneKey = JSON.stringify(scene);
  useEffect(() => {
    let active = true;
    void listRecoveries()
      .then((v) => {
        if (active) {
          setRecoveries(v);
          setRecoveryReady(true);
          setRecoveryStatus("本机恢复已就绪");
        }
      })
      .catch((e) => {
        if (active) {
          setRecoveryReady(true);
          setRecoveryStatus(`恢复不可用：${e}`);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!recoveryReady || history.isPreviewing || projectBusy) return;
    let active = true;
    const snapshot = history.scene,
      baseline = saved.current,
      bytes = { ...assets.current };
    if (JSON.stringify(snapshot) !== baseline)
      setRecoveryStatus("恢复副本更新中…");
    const timer = setTimeout(() => {
      const operation =
        JSON.stringify(snapshot) === baseline
          ? removeRecovery(recoveryId.current)
          : writeRecovery({
              id: recoveryId.current,
              updated: Date.now(),
              scene: snapshot,
              assets: bytes,
              savedSnapshot: baseline,
            });
      void operation
        .then(
          () =>
            active &&
            setRecoveryStatus(
              JSON.stringify(snapshot) === baseline
                ? "项目已保存"
                : "恢复副本已更新",
            ),
        )
        .catch((e) => {
          if (active) setRecoveryStatus(`恢复副本失败：${e}`);
        });
    }, 800);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    sceneKey,
    dirty,
    recoveryReady,
    history.isPreviewing,
    saved.current,
    projectBusy,
  ]);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (document.activeElement instanceof HTMLElement)
          document.activeElement.blur();
        void exportProject();
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  });
  useEffect(() => {
    const valid = selections.filter((id) =>
      scene.nodes.some((n) => n.id === id),
    );
    if (valid.length !== selections.length) selectMany(valid);
  }, [sceneKey, selection]);
  useEffect(() => {
    const snapshot = history.scene,
      bytes = { ...assets.current },
      token = ++generation.current;
    renderQueue.current = renderQueue.current
      .catch(() => {})
      .then(async () => {
        if (!alive.current || token !== generation.current) return;
        setBusy(true);
        try {
          if (!renderer.current) {
            const sdk = await import(
              /* @vite-ignore */ new URL("sdk/src/Nova.js", document.baseURI)
                .href
            );
            const next: Renderer = createEditorRenderer(
              await sdk.createRenderer({
                canvas: canvas.current,
                shaderDirectory: new URL("sdk/generated/", document.baseURI)
                  .href,
              }),
            );
            if (!alive.current) {
              next.dispose();
              return;
            }
            next.setClearColor([0.6, 0.6, 0.6, 1]);
            next.setLighting(lit ? "pbr" : "unlit");
            next.setDirectionalLight(rendererLight(light));
            next.setShadows({
              enabled: light.shadows,
              softness: light.softness,
            });
            next.setEnvironment({
              rotation: 0,
              intensity: 1,
              backgroundIntensity: 1,
              showBackground: false,
            });
            next.setCamera(camera);
            renderer.current = next;
          }
          const definitions = Object.entries(snapshot.assets).map(([id, a]) => {
            const data = bytes[a.path];
            if (!data) throw Error(`缺少资产 ${a.path}`);
            let cached = assetURLs.current.get(a.path);
            if (cached?.bytes !== data) {
              if (cached) URL.revokeObjectURL(cached.url);
              cached = {
                bytes: data,
                url: URL.createObjectURL(new Blob([new Uint8Array(data)])),
              };
              assetURLs.current.set(a.path, cached);
              urls.current.push(cached.url);
            }
            return { id, url: cached!.url, sourceSpace: !!a.sourceSpace };
          });
          const activePaths = new Set(
            Object.values(snapshot.assets).map((a) => a.path),
          );
          for (const [path, cached] of assetURLs.current)
            if (!activePaths.has(path)) {
              URL.revokeObjectURL(cached.url);
              assetURLs.current.delete(path);
            }
          const worlds = worldMatrices(snapshot),
            instances = snapshot.nodes
              .filter(
                (n) => n.assetId && !inheritedFlag(snapshot, n.id, "hidden"),
              )
              .map((n) => ({
                id: n.id,
                assetId: n.assetId!,
                world: worlds.get(n.id)!,
              }));
          const unusedResources: ((typeof instances)[number] & {
            castShadow?: boolean;
          })[] = [];
          const resourceIds = new Set(instances.map((i) => i.id));
          for (const definition of definitions)
            if (!instances.some((i) => i.assetId === definition.id)) {
              let id = `__nova_resource_${definition.id}`;
              while (
                resourceIds.has(id) ||
                definitions.some((a) => a.id === id)
              )
                id += "_";
              resourceIds.add(id);
              unusedResources.push({
                id,
                assetId: definition.id,
                castShadow: false,
                world: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
              });
            }
          // Helpers only enter the renderer; history/export retain the user document.
          helperData.current ??= fetch(
            new URL("viewport/manifest.json", document.baseURI),
          )
            .then((r) => {
              if (!r.ok) throw Error("缺少视口辅助资源");
              return r.json();
            })
            .catch((e) => {
              helperData.current = null;
              throw e;
            });
          const helperManifest = await helperData.current;
          const helperAssets: typeof definitions = [],
            helperInstances: ((typeof instances)[number] & {
              castShadow?: boolean;
            })[] = [];
          const used = new Set([
            ...definitions.map((x) => x.id),
            ...instances.map((x) => x.id),
            ...unusedResources.map((x) => x.id),
          ]);
          for (const helper of helperManifest) {
            let id = `__nova_viewport_${helper.name}`;
            while (used.has(id)) id += "_";
            used.add(id);
            helperAssets.push({
              id,
              sourceSpace: false,
              url: new URL(`viewport/${helper.name}.glb`, document.baseURI)
                .href,
            });
            helperInstances.push({
              id,
              assetId: id,
              world: helper.world,
              castShadow: false,
            });
          }
          await renderer.current.setScene(
            [...definitions, ...helperAssets],
            [...instances, ...unusedResources, ...helperInstances],
          );
          const world = snapshot.world ?? defaultWorld();
          const envBytes = world.environment.map
            ? bytes[world.environment.map]
            : undefined;
          if (world.environment.map && !envBytes) throw Error("缺少环境贴图");
          if (environmentCache.current.bytes !== envBytes) {
            if (envBytes) validateEnvironmentBytes(envBytes);
            const url = envBytes
              ? URL.createObjectURL(new Blob([envBytes.slice().buffer]))
              : undefined;
            try {
              await renderer.current.loadEnvironment(url ?? null);
            } catch (e) {
              if (url) URL.revokeObjectURL(url);
              throw e;
            }
            if (environmentCache.current.url)
              URL.revokeObjectURL(environmentCache.current.url);
            environmentCache.current = { bytes: envBytes, url };
          }
          renderer.current.setEnvironment(environmentSettings(world));
          renderer.current.setClearColor([
            ...[1, 3, 5].map(
              (k) => parseInt(world.background.color.slice(k, k + 2), 16) / 255,
            ),
            1,
          ]);
          const sceneLight = sceneDirectional(snapshot);
          renderer.current.setDirectionalLight(
            sceneLight ?? rendererLight(light),
          );
          renderer.current.setShadows(
            sceneLight
              ? { enabled: sceneLight.shadows, softness: sceneLight.softness }
              : { enabled: light.shadows, softness: light.softness },
          );
          if (mainPreview) {
            try {
              const view = sceneCamera(snapshot);
              if (!view) {
                setMainPreview(false);
                renderer.current.setCamera(cameraLatest.current);
              } else renderer.current.setCamera(view);
            } catch (e) {
              setCameraNotice(String(e));
              setMainPreview(false);
              renderer.current.setCamera(cameraLatest.current);
            }
          } else renderer.current.setCamera(cameraLatest.current);
          const bounds: AssetBounds = {};
          for (const id of Object.keys(snapshot.assets)) {
            const b = renderer.current.getSceneAssetBounds(id);
            if (b) bounds[id] = b;
          }
          if (alive.current && token === generation.current) {
            setAssetBounds(bounds);
            if (pendingFocus.current && !mainPreview) {
              const root =
                pendingFocus.current === "*" ? null : pendingFocus.current;
              pendingFocus.current = null;
              const r = canvas.current!.getBoundingClientRect();
              changeCamera(
                frameBounds(
                  cameraLatest.current,
                  sceneBounds(snapshot, bounds, root),
                  { width: r.width, height: r.height },
                ),
              );
            }
          }
          await renderer.current.drawFrame();
          if (alive.current && token === generation.current) {
            setPreview(
              instances.length
                ? `${instances.length} 个模型实例`
                : snapshot.nodes.some((n) => n.assetId)
                  ? "0 个可见模型实例"
                  : "尚未加载模型",
            );
            setStatus((previous) =>
              previous === "准备就绪" ? "就绪" : previous,
            );
          }
        } catch (e) {
          if (alive.current) setStatus(`场景渲染失败：${e}`);
        } finally {
          if (alive.current && token === generation.current) setBusy(false);
        }
      });
  }, [sceneKey, mainPreview]);
  function applyWorld(world: WorldSettings) {
    const valid = validateWorld(world);
    history.commit((s) => {
      s.schemaVersion = 4;
      s.world = valid;
    });
    refresh();
    setStatus("场景环境已更新");
  }
  function importEnvironment(bytes: Uint8Array, name: string) {
    validateEnvironmentBytes(bytes);
    const path = `assets/${crypto.randomUUID()}.nenv`,
      world = structuredClone(history.scene.world ?? defaultWorld());
    world.environment.map = path;
    world.environment.name = name;
    world.background.mode = "environment";
    assets.current[path] = bytes;
    try {
      applyWorld(world);
    } catch (e) {
      delete assets.current[path];
      throw e;
    }
  }
  async function importGLB(file?: File) {
    if (documentIO.current) return;
    if (!file) return;
    try {
      if (
        !file.name.toLowerCase().endsWith(".glb") ||
        file.size > 128 * 1024 * 1024
      )
        throw Error("请选择小于 128 MiB 的 GLB");
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (documentIO.current) return;
      const model = decodeModel(bytes),
        id = crypto.randomUUID();
      let files: Record<string, Uint8Array> = {};
      edit((s) => {
        s.nodes.push({
          id,
          parentId: null,
          name: file.name.replace(/\.glb$/i, ""),
          transform: identity(),
        });
        files = expandModel(s, id, model, () => crypto.randomUUID());
      });
      Object.assign(assets.current, files);
      pendingFocus.current = id;
      select(id);
      setSidebarTab("scene");
    } catch (e) {
      setStatus(String(e));
    }
  }
  async function openProject(file?: File) {
    if (!file || documentIO.current || history.isPreviewing) return;
    documentIO.current = true;
    setProjectBusy(true);
    try {
      const next = unpackProject(new Uint8Array(await file.arrayBuffer()));
      if (
        JSON.stringify(history.scene) !== saved.current &&
        !window.confirm("当前项目尚未保存。是否放弃修改并打开？")
      )
        return;
      await removeRecovery(recoveryId.current);
      setMainPreview(false);
      setCameraNotice("");
      history.replace(next.scene);
      assets.current = next.assets;
      saved.current = JSON.stringify(next.scene);
      pendingFocus.current = "*";
      select(null);
      refresh();
      setSidebarTab("scene");
      setStatus("已打开项目归档");
    } catch (e) {
      setStatus(`打开失败：${e}`);
    } finally {
      documentIO.current = false;
      setProjectBusy(false);
    }
  }
  async function exportProject(downloadOnly = false) {
    if (documentIO.current) return;
    if (history.isPreviewing) {
      setStatus("请先结束当前拖动再保存");
      return;
    }
    const snapshot = history.scene;
    documentIO.current = true;
    setProjectBusy(true);
    try {
      const data = packProject({ scene: snapshot, assets: assets.current });
      type SaveWindow = Window & {
        showSaveFilePicker?: (options: unknown) => Promise<{
          createWritable: () => Promise<{
            write: (data: Blob) => Promise<void>;
            close: () => Promise<void>;
            abort: () => Promise<void>;
          }>;
        }>;
      };
      const picker = downloadOnly
        ? undefined
        : (window as SaveWindow).showSaveFilePicker;
      let handle:
        | Awaited<ReturnType<NonNullable<SaveWindow["showSaveFilePicker"]>>>
        | undefined;
      if (picker)
        try {
          handle = await picker.call(window, {
            suggestedName: "nova-project.zip",
            types: [
              {
                description: "Nova 项目",
                accept: { "application/zip": [".zip"] },
              },
            ],
          });
        } catch (e) {
          if (
            !(
              e instanceof DOMException &&
              ["SecurityError", "NotAllowedError"].includes(e.name)
            )
          )
            throw e;
        }
      if (handle) {
        const writer = await handle.createWritable();
        try {
          await writer.write(new Blob([new Uint8Array(data)]));
          await writer.close();
        } catch (e) {
          await writer.abort().catch(() => {});
          throw e;
        }
        saved.current = JSON.stringify(snapshot);
        refresh();
        if (JSON.stringify(history.scene) === saved.current)
          await removeRecovery(recoveryId.current);
        setStatus("项目已保存，可解压后用桌面端打开 project.json");
      } else {
        const url = URL.createObjectURL(new Blob([new Uint8Array(data)])),
          a = document.createElement("a");
        a.href = url;
        a.download = "nova-project.zip";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setStatus("已发起下载，落盘未确认；恢复副本已保留");
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        setStatus(`保存失败：${e}`);
    } finally {
      documentIO.current = false;
      setProjectBusy(false);
    }
  }
  function treeCommand(command: TreeCommand, ids = selections) {
    if (documentIO.current) return;
    try {
      let nextSelection = ids;
      history.commit((s) => {
        if (command === "group")
          nextSelection = [groupNodes(s, ids, crypto.randomUUID())];
        else if (command === "ungroup") nextSelection = ungroupNodes(s, ids);
        else if (command === "duplicate")
          nextSelection = duplicateNodes(s, ids, () => crypto.randomUUID());
        else if (command === "delete") {
          deleteNodes(s, ids);
          nextSelection = [];
        } else if (command === "up" || command === "down") {
          if (ids.length !== 1)
            throw Error("排序按钮请单选节点，批量排序可拖动");
          const n = s.nodes.find((n) => n.id === ids[0])!,
            siblings = s.nodes.filter((c) => c.parentId === n.parentId),
            i = siblings.findIndex((c) => c.id === n.id);
          if (command === "up" && i > 0)
            reparentNodes(s, ids, n.parentId, siblings[i - 1].id);
          if (command === "down" && i < siblings.length - 1)
            reparentNodes(s, ids, n.parentId, siblings[i + 2]?.id ?? null);
        } else
          setNodeFlag(
            s,
            ids,
            command === "hide" || command === "show" ? "hidden" : "locked",
            command === "hide" || command === "lock",
          );
      });
      selectMany(nextSelection);
      refresh();
      setStatus("场景树已更新");
    } catch (e) {
      setStatus(String(e));
    }
  }
  async function restoreRecovery(value: Recovery) {
    if (documentIO.current || history.isPreviewing) return;
    if (dirty && !window.confirm("恢复将替换当前修改，是否继续？")) return;
    documentIO.current = true;
    setProjectBusy(true);
    try {
      await writeRecovery({
        ...value,
        id: recoveryId.current,
        updated: Date.now(),
      });
      setMainPreview(false);
      setCameraNotice("");
      history.replace(value.scene);
      assets.current = value.assets;
      saved.current = value.savedSnapshot;
      select(null);
      pendingFocus.current = "*";
      refresh();
      await removeRecovery(value.id);
      setRecoveries((v) => v.filter((r) => r.id !== value.id));
      setStatus("已恢复；请保存项目以完成落盘");
    } catch (e) {
      setStatus(`恢复失败：${e}`);
    } finally {
      documentIO.current = false;
      setProjectBusy(false);
    }
  }
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement)?.closest(
          "input,textarea,select,[contenteditable=true]",
        )
      )
        return;
      if (busy || history.isPreviewing || resourceDrag) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        treeCommand("duplicate");
      }
      if (e.key === "Delete" && selections.length) {
        e.preventDefault();
        treeCommand("delete");
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  });
  function placeResource(assetId: string, transform: Transform, name: string) {
    if (!history.scene.assets[assetId]) return;
    const id = crypto.randomUUID();
    edit((s) => {
      s.assets[assetId].name ??= name;
      const base = s.assets[assetId].name!;
      let label = base,
        index = 2;
      while (s.nodes.some((n) => n.name === label))
        label = `${base} ${index++}`;
      s.nodes.push({ id, parentId: null, name: label, assetId, transform });
    });
    select(id);
    setStatus("已创建模型实例");
  }
  function landSelection() {
    if (!selection || inheritedFlag(scene, selection, "locked")) return;
    const t = groundedTransform(
      history.scene,
      selection,
      assetBounds,
      surfaceQuery(
        history.scene,
        (ray) => renderer.current?.pickScene(ray) ?? null,
      ),
    );
    if (!t) {
      setStatus("无法落地：没有模型边界，或父节点缩放不可逆");
      return;
    }
    edit((s) => {
      s.nodes.find((n) => n.id === selection)!.transform = t;
    });
    setStatus("已落到下方模型或地面");
  }
  function resourceName(id: string) {
    const a = scene.assets[id];
    return (
      a.name ??
      scene.nodes.find((n) => n.assetId === id)?.name ??
      a.path
        .split("/")
        .pop()!
        .replace(/\.glb$/i, "")
    );
  }
  function frameSelection(all = false) {
    const r = canvas.current!.getBoundingClientRect();
    let selectedBounds = sceneBounds(
      history.scene,
      assetBounds,
      all ? null : selection,
    );
    if (!all && selections.length === 1 && (node?.camera || node?.light)) {
      const p = worldMatrices(history.scene).get(node.id)!.slice(12, 15);
      selectedBounds = {
        minimum: p.map((v) => v - 1),
        maximum: p.map((v) => v + 1),
      };
    }
    if (!all && selections.length > 1) {
      const boxes = selectionRoots(history.scene, selections)
        .map((id) => sceneBounds(history.scene, assetBounds, id))
        .filter((b): b is NonNullable<typeof b> => !!b);
      if (boxes.length)
        selectedBounds = {
          minimum: [0, 1, 2].map((k) =>
            Math.min(...boxes.map((b) => b.minimum[k])),
          ),
          maximum: [0, 1, 2].map((k) =>
            Math.max(...boxes.map((b) => b.maximum[k])),
          ),
        };
    }
    changeCamera(
      frameBounds(cameraLatest.current, selectedBounds, {
        width: r.width,
        height: r.height,
      }),
    );
  }
  useEffect(() => {
    if (!node && (inspectorTab === "geometry" || inspectorTab === "material"))
      setInspectorTab("object");
  }, [node?.id, inspectorTab]);
  function addSceneObject(kind: "camera" | "light") {
    if (busy) return;
    const id = crypto.randomUUID(),
      n = kind === "camera" ? createCamera(id, viewCamera) : createLight(id);
    edit((s) => {
      s.schemaVersion = Math.max(s.schemaVersion, 3) as 3 | 4;
      s.nodes.push(n);
      if (
        !s.nodes.some((x) =>
          kind === "camera" ? x.camera?.primary : x.light?.active,
        )
      )
        setPrimary(s, id, kind);
    });
    select(id);
    setInspectorTab("object");
    setSidebarTab("scene");
  }
  function toggleMainPreview() {
    if (mainPreview) {
      setMainPreview(false);
      return;
    }
    try {
      if (!sceneCamera(history.scene)) throw Error("请先设置主相机");
      history.cancelPreview();
      setCameraNotice("");
      setMainPreview(true);
      refresh();
    } catch (e) {
      setCameraNotice(String(e));
      setStatus(String(e));
    }
  }
  function addPrimitive(type: PrimitiveType) {
    if (busy) return;
    try {
      const geometry = defaultGeometry(type),
        bytes = makePrimitive(geometry),
        id = crypto.randomUUID(),
        path = `assets/${crypto.randomUUID()}.glb`,
        name = primitives[type].name;
      assets.current[path] = bytes;
      history.commit((s) => {
        s.schemaVersion = s.schemaVersion < 2 ? 2 : s.schemaVersion;
        s.assets[id] = { path, sourceSpace: true, name };
        const transform = identity();
        transform.position[1] = groundOffset(geometry);
        s.nodes.push({ id, parentId: null, name, assetId: id, transform });
      });
      pendingFocus.current = id;
      select(id);
      setSidebarTab("scene");
      setInspectorTab("geometry");
      refresh();
      setStatus("已创建几何体");
    } catch (e) {
      setStatus(String(e));
    }
  }
  function expandSelectedModel() {
    if (!node?.assetId || busy) return;
    try {
      const model = decodeModel(
        assets.current[scene.assets[node.assetId].path],
      );
      let files: Record<string, Uint8Array> = {};
      history.commit((s) => {
        files = expandModel(s, node.id, model, () => crypto.randomUUID());
      });
      Object.assign(assets.current, files);
      refresh();
      setStatus("已展开模型层级与独立材质槽，可撤销");
    } catch (e) {
      setStatus(String(e));
    }
  }
  function applyAsset(bytes: Uint8Array) {
    if (!node?.assetId || busy) return;
    try {
      assertEditable(history.scene, [node.id]);
      const assetId = node.assetId,
        path = `assets/${crypto.randomUUID()}.glb`;
      assets.current[path] = bytes;
      history.commit((s) => {
        s.assets[assetId].path = path;
      });
      refresh();
      setStatus("资源已更新，支持撤销");
    } catch (e) {
      setStatus(String(e));
    }
  }
  function uniqueAsset() {
    if (!node?.assetId || busy) return;
    try {
      assertEditable(history.scene, [node.id]);
      history.commit((s) => {
        const n = s.nodes.find((n) => n.id === node.id)!,
          id = crypto.randomUUID();
        s.assets[id] = {
          ...s.assets[n.assetId!],
          name: resourceName(n.assetId!) + " 独立",
        };
        n.assetId = id;
      });
      refresh();
      setStatus("已创建独立资源副本");
    } catch (e) {
      setStatus(String(e));
    }
  }
  function addEmpty() {
    if (busy) return;
    const id = crypto.randomUUID();
    edit((s) =>
      s.nodes.push({
        id,
        parentId: node && !inheritedFlag(s, node.id, "locked") ? node.id : null,
        name: "Empty",
        transform: identity(),
      }),
    );
    select(id);
    setSidebarTab("scene");
  }
  function openLightSettings() {
    setSidebarTab("scene");
    setInspectorTab("lighting");
  }
  async function openExample(units = false) {
    try {
      const r = await fetch(
        new URL(
          units ? "demo/units-project.zip" : "demo/project.zip",
          document.baseURI,
        ),
      );
      if (!r.ok) throw Error("示例资源缺失");
      await openProject(new File([await r.blob()], "example.zip"));
      setSidebarTab("scene");
    } catch (e) {
      setStatus(String(e));
    }
  }
  async function importModelExample() {
    try {
      const r = await fetch(new URL("examples/model.glb", document.baseURI));
      if (!r.ok) throw Error("请运行 fixtures:model 生成示例");
      await importGLB(new File([await r.blob()], "Assembly.glb"));
    } catch (e) {
      setStatus(String(e));
    }
  }
  async function openSceneObjectsExample() {
    try {
      const r = await fetch(
        new URL("examples/scene-objects.zip", document.baseURI),
      );
      if (!r.ok) throw Error("请运行 fixtures:scene-objects");
      await openProject(new File([await r.blob()], "scene-objects.zip"));
    } catch (e) {
      setStatus(String(e));
    }
  }
  async function openGeometryExample() {
    try {
      const r = await fetch(
        new URL("examples/primitives.zip", document.baseURI),
      );
      if (!r.ok) throw Error("请运行 fixtures:primitives 生成示例");
      await openProject(new File([await r.blob()], "primitives.zip"));
    } catch (e) {
      setStatus(String(e));
    }
  }
  async function newProject() {
    if (documentIO.current || history.isPreviewing) return;
    if (dirty && !window.confirm("放弃未保存修改并新建项目？")) return;
    documentIO.current = true;
    setProjectBusy(true);
    try {
      await removeRecovery(recoveryId.current);
      setMainPreview(false);
      setCameraNotice("");
      history.replace(emptyScene());
      assets.current = {};
      saved.current = JSON.stringify(history.scene);
      select(null);
      refresh();
      setSidebarTab("scene");
      setStatus("已新建项目");
    } catch (e) {
      setStatus(`新建失败：${e}`);
    } finally {
      documentIO.current = false;
      setProjectBusy(false);
    }
  }
  function changeTransformSpace(space: TransformSpace) {
    history.cancelPreview();
    setTransformSpace(space);
    refresh();
  }
  function transformSpaceControl() {
    return (
      <label className="asset-property-field">
        坐标系
        <select
          aria-label="变换坐标系"
          value={transformSpace}
          onChange={(e) =>
            changeTransformSpace(e.target.value as TransformSpace)
          }
        >
          <option value="local">局部</option>
          <option value="world">世界</option>
        </select>
      </label>
    );
  }
  let displayedTransform: Transform | null = null,
    transformError = "";
  if (node)
    try {
      displayedTransform = readNodeTransform(scene, node.id, transformSpace);
    } catch {
      transformError = "当前世界变换包含剪切，请切到局部坐标编辑数值。";
    }
  let groupError = "";
  if (node && selections.length > 1)
    try {
      selectionFrame(scene, selections, node.id, transformSpace, assetBounds);
    } catch (e) {
      groupError = String(e);
    }
  function vector(n: SceneNode, key: "position" | "scale") {
    return (
      <fieldset>
        <legend>{key === "position" ? "位置" : "缩放"}</legend>
        <div className="vector">
          {displayedTransform![key].map((v, i) => (
            <label key={i}>
              {"XYZ"[i]}
              <NumberField
                label={`${key}-${i}`}
                value={v}
                onValue={(value) => {
                  edit((s) => {
                    const t = readNodeTransform(s, n.id, transformSpace);
                    t[key][i] = value;
                    writeNodeTransform(s, n.id, transformSpace, t);
                  });
                }}
              />
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  return (
    <div className="editor">
      <header className="menubar">
        <strong className="menu-brand">NOVA</strong>
        <nav aria-label="主菜单">
          <Menu
            label="文件"
            items={[
              {
                label: "新建项目",
                action: () => void newProject(),
                disabled: busy,
              },
              {
                label: "打开项目",
                action: () => projectInput.current?.click(),
                disabled: busy,
              },
              {
                label: "保存项目",
                action: () => void exportProject(),
                disabled: busy,
                shortcut: "⌘ / Ctrl S",
              },
              {
                label: "导入 GLB",
                action: () => modelInput.current?.click(),
                disabled: busy,
              },
              {
                label: "示例项目",
                action: () => void openExample(),
                disabled: busy,
              },
              {
                label: "尺寸示例",
                action: () => void openExample(true),
                disabled: busy,
              },
              {
                label: "几何体示例",
                action: () => void openGeometryExample(),
                disabled: busy,
              },
              {
                label: "模型结构示例",
                action: () => void importModelExample(),
                disabled: busy,
              },
              {
                label: "灯光与相机示例",
                action: () => void openSceneObjectsExample(),
                disabled: busy,
              },
            ]}
          />
          <Menu
            label="编辑"
            items={[
              {
                label: "撤销",
                action: () => {
                  history.undo();
                  refresh();
                },
                disabled: busy || !history.canUndo,
                shortcut: "⌘ / Ctrl Z",
              },
              {
                label: "重做",
                action: () => {
                  history.redo();
                  refresh();
                },
                disabled: busy || !history.canRedo,
                shortcut: "⇧ ⌘ / Ctrl Z",
              },
              {
                label: "复制",
                action: () => treeCommand("duplicate"),
                disabled: busy || !selections.length,
                shortcut: "⌘ / Ctrl D",
              },
              {
                label: "删除",
                action: () => treeCommand("delete"),
                disabled: busy || !selections.length,
                shortcut: "Delete",
              },
              {
                label: "分组",
                action: () => treeCommand("group"),
                disabled: busy || !selections.length,
              },
              {
                label: "解组",
                action: () => treeCommand("ungroup"),
                disabled: busy || !selections.length,
              },
            ]}
          />
          <Menu
            label="添加"
            items={[
              { label: "空节点", action: addEmpty, disabled: busy },
              ...Object.entries(primitives).map(([type, p]) => ({
                label: p.name,
                action: () => addPrimitive(type as PrimitiveType),
                disabled: busy,
              })),
              {
                label: "方向光",
                action: () => addSceneObject("light"),
                disabled: busy,
              },
              {
                label: "相机",
                action: () => addSceneObject("camera"),
                disabled: busy,
              },
              {
                label: "模型…",
                action: () => modelInput.current?.click(),
                disabled: busy,
              },
            ]}
          />
          <Menu
            label="视图"
            items={[
              {
                label:
                  transformSpace === "local" ? "切换世界坐标" : "切换局部坐标",
                shortcut: "X",
                action: () =>
                  changeTransformSpace(
                    transformSpace === "local" ? "world" : "local",
                  ),
              },
              {
                label: mainPreview ? "返回编辑视角" : "预览主相机",
                action: toggleMainPreview,
                disabled: !primaryCamera(scene),
              },
              {
                label: "聚焦选中",
                action: () => frameSelection(),
                disabled: busy,
                shortcut: "F",
              },
              {
                label: "显示全景",
                action: () => frameSelection(true),
                disabled: busy,
                shortcut: "Shift F",
              },
              {
                label: camera.orthographic ? "切换透视" : "切换正交",
                action: () =>
                  changeCamera({
                    ...camera,
                    orthographic: !camera.orthographic,
                  }),
                disabled: history.isPreviewing,
                shortcut: "P",
              },
              {
                label: assetsOpen ? "收起资源库" : "展开资源库",
                action: () => setAssetsOpen((v) => !v),
              },
              { label: "光照设置", action: openLightSettings },
              {
                label: "恢复默认视角",
                action: () =>
                  changeCamera({
                    ...camera,
                    yaw: 25,
                    pitch: 20,
                    distance: 8,
                    target: [0, 0, 0],
                    orthographic: false,
                  }),
                disabled: history.isPreviewing,
              },
            ]}
          />
        </nav>
        <span className="document-name">
          {scene.name}
          {dirty ? " *" : ""}
        </span>
        <span className="menu-save-status" title={recoveryStatus}>
          {dirty ? "未保存" : "已保存"}
        </span>
      </header>
      {recoveries.length > 0 && !recoveryDismissed && (
        <section className="recovery-banner" aria-label="恢复未保存项目">
          <div className="recovery-heading">
            <strong>可恢复项目</strong>
            <button onClick={() => setRecoveryDismissed(true)}>稍后</button>
          </div>
          {recoveries.map((r) => (
            <span key={r.id}>
              {r.scene.name} · {new Date(r.updated).toLocaleString()}{" "}
              <button onClick={() => void restoreRecovery(r)}>恢复</button>
              <button
                onClick={() =>
                  void removeRecovery(r.id)
                    .then(() =>
                      setRecoveries((v) => v.filter((x) => x.id !== r.id)),
                    )
                    .catch((e) => setStatus(String(e)))
                }
              >
                丢弃此副本
              </button>
            </span>
          ))}
        </section>
      )}
      <div className="workspace">
        <main
          className="viewport"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!busy) void importGLB(e.dataTransfer.files[0]);
          }}
        >
          <div className="viewport-bar">
            <span>
              <Icon name="cube" />
              场景
            </span>
            <div className="viewport-actions">
              <button
                className="projection-switch"
                aria-label="光照设置"
                onClick={openLightSettings}
              >
                光照设置
              </button>
              <button
                className="projection-switch"
                aria-label={activeSceneLight ? "场景光照" : "默认光照"}
                aria-pressed={lit}
                disabled={busy}
                title="默认摄影棚光照；关闭可查看材质原色"
                onClick={() => {
                  try {
                    renderer.current?.setLighting(lit ? "unlit" : "pbr");
                    setLit(!lit);
                    if (renderer.current)
                      void renderer.current
                        .drawFrame()
                        .catch((e) => setStatus(String(e)));
                  } catch (e) {
                    setStatus(String(e));
                  }
                }}
              >
                {lit
                  ? activeSceneLight
                    ? "场景光照 · 开"
                    : "默认光照 · 开"
                  : "材质原色"}
              </button>
              <button
                className="projection-switch"
                disabled={history.isPreviewing}
                title="切换透视 / 正交 (P)"
                aria-label={mainPreview ? "返回编辑视角" : "切换投影模式"}
                aria-pressed={!!camera.orthographic}
                onClick={() =>
                  mainPreview
                    ? setMainPreview(false)
                    : changeCamera({
                        ...camera,
                        orthographic: !camera.orthographic,
                      })
                }
              >
                {mainPreview ? "主相机" : camera.orthographic ? "正交" : "透视"}{" "}
                · 实时 ⇄
              </button>
            </div>
          </div>
          <canvas ref={canvas} />
          <div className="placement-controls">
            <label>
              <input
                type="checkbox"
                checked={gridSnap}
                onChange={(e) => setGridSnap(e.target.checked)}
              />
              网格吸附
            </label>
            <select
              aria-label="摆放网格步长"
              value={gridStep}
              onChange={(e) => setGridStep(Number(e.target.value))}
            >
              {gridSteps.map((step) => (
                <option key={step} value={step}>
                  {step} m
                </option>
              ))}
            </select>
            <span>拖入资源摆放</span>
          </div>
          <Viewport
            resourceDrag={resourceDrag}
            snap={gridSnap}
            step={gridStep}
            onResourceEnd={(consumed) => {
              consumeAssetClick.current = consumed;
              setResourceDrag(null);
            }}
            onPlace={placeResource}
            scene={scene}
            bounds={assetBounds}
            onFrame={frameSelection}
            selection={selection}
            selections={selections}
            space={transformSpace}
            onSpace={changeTransformSpace}
            onError={setStatus}
            camera={viewCamera}
            readOnly={mainPreview}
            renderer={renderer}
            ready={!busy && !!renderer.current && !mainPreview}
            previewing={history.isPreviewing}
            onSelect={(id, additive) => {
              if (!id) {
                if (!additive) select(null);
                return;
              }
              if (additive)
                selectMany(
                  selections.includes(id)
                    ? selections.filter((x) => x !== id)
                    : [...selections, id],
                );
              else if (selections.includes(id) && selections.length > 1)
                selectMany([...selections.filter((x) => x !== id), id]);
              else select(id);
            }}
            onCamera={changeCamera}
            onBegin={() => {
              history.beginPreview();
              refresh();
            }}
            onPreview={(edits) => {
              history.preview((s) => applySelectionEdits(s, edits));
              refresh();
            }}
            onFinish={() => {
              history.finishPreview();
              refresh();
            }}
            onCancel={() => {
              history.cancelPreview();
              refresh();
            }}
            onUndo={(redo) => {
              if (documentIO.current) return;
              redo ? history.redo() : history.undo();
              refresh();
            }}
          />
          {preview === "尚未加载模型" && !scene.nodes.length && (
            <div className="welcome">
              <div className="mark">N</div>
              <h1>从一个场景开始</h1>
              <p>导入模型，开始搭建你的世界</p>
              <button
                className="primary"
                disabled={busy}
                onClick={() => modelInput.current?.click()}
              >
                导入模型
              </button>
            </div>
          )}
          <div
            className="viewport-footer"
            title="左键选择 · 中键平移 · 右键环绕 · 滚轮缩放"
          >
            <span>{busy ? "正在加载…" : preview}</span>
            <span>{camera.orthographic ? "正交" : "透视"}</span>
          </div>
        </main>
        <aside className="sidebar" aria-label="编辑侧栏">
          <div className="sidebar-tabs" role="tablist" aria-label="侧栏分类">
            {(["scene", "project", "settings"] as const).map((tab, i) => (
              <button
                role="tab"
                key={tab}
                aria-selected={sidebarTab === tab}
                aria-controls={`sidebar-${tab}`}
                id={`tab-${tab}`}
                onClick={() => setSidebarTab(tab)}
              >
                {["场景", "项目", "设置"][i]}
              </button>
            ))}
          </div>
          <div
            className="sidebar-scene"
            role="tabpanel"
            id="sidebar-scene"
            aria-labelledby="tab-scene"
            hidden={sidebarTab !== "scene"}
          >
            <section className="scene-panel" aria-label="场景层级">
              <div className="panel-title">
                场景 <span>{scene.nodes.length}</span>
              </div>
              <div className="scene-toolbar">
                <button disabled={busy} onClick={addEmpty} title="新建空节点">
                  <Icon name="plus" />
                </button>
                <button onClick={() => select(null)}>取消选择</button>
              </div>
              <div className="scene-name">
                <Icon name="folder" />
                {scene.name}
                {dirty ? " *" : ""}
              </div>
              <SceneTree
                scene={scene}
                selection={selections}
                onSelect={selectMany}
                disabled={busy || history.isPreviewing}
                onCommand={treeCommand}
                onMove={(ids, parent, before) => {
                  if (documentIO.current) return;
                  try {
                    history.commit((s) =>
                      reparentNodes(s, ids, parent, before),
                    );
                    refresh();
                    setStatus("已移动节点，保持世界变换");
                  } catch (e) {
                    setStatus(String(e));
                  }
                }}
                onRename={(id, name) =>
                  edit((s) => {
                    assertEditable(s, [id]);
                    s.nodes.find((n) => n.id === id)!.name = name;
                  })
                }
              />

              {!scene.nodes.length && (
                <p className="hint">导入 GLB 或创建空节点，开始组织场景。</p>
              )}
            </section>
            <section className="inspector" aria-label="对象属性">
              <div
                className="inspector-tabs"
                role="tablist"
                aria-label="检查器分类"
              >
                <button
                  role="tab"
                  aria-selected={inspectorTab === "object"}
                  onClick={() => setInspectorTab("object")}
                >
                  对象
                </button>
                {node &&
                  !node.camera &&
                  !node.light &&
                  (["geometry", "material"] as const).map((tab, i) => (
                    <button
                      key={tab}
                      role="tab"
                      aria-selected={inspectorTab === tab}
                      onClick={() => setInspectorTab(tab)}
                    >
                      {["几何体", "材质"][i]}
                    </button>
                  ))}
                <button
                  role="tab"
                  aria-selected={inspectorTab === "lighting"}
                  onClick={openLightSettings}
                >
                  光照
                </button>
                <button
                  role="tab"
                  aria-selected={inspectorTab === "world"}
                  onClick={() => setInspectorTab("world")}
                >
                  环境
                </button>
              </div>
              {inspectorTab === "world" ? (
                <WorldPanel
                  key={JSON.stringify(scene.world)}
                  value={scene.world}
                  busy={busy}
                  onApply={applyWorld}
                  onImport={importEnvironment}
                />
              ) : inspectorTab === "lighting" ? (
                <>
                  <p className="compact-status">
                    {activeSceneLight
                      ? "当前使用场景光源；请选择方向光节点编辑。"
                      : "摄影棚光照仅用于当前视口。"}
                  </p>
                  <LightingPanel
                    value={light}
                    enabled={lit}
                    busy={busy || !!activeSceneLight}
                    onChange={changeLight}
                    onEnabled={changeLit}
                    onReset={() => {
                      changeLight(defaultLighting());
                      changeLit(true);
                    }}
                  />
                </>
              ) : node?.assetId &&
                (inspectorTab === "geometry" || inspectorTab === "material") ? (
                <AssetProperties
                  key={
                    node.assetId +
                    scene.assets[node.assetId].path +
                    inspectorTab
                  }
                  bytes={assets.current[scene.assets[node.assetId].path]}
                  mode={inspectorTab}
                  users={
                    scene.nodes.filter((n) => n.assetId === node.assetId).length
                  }
                  disabled={busy || inheritedFlag(scene, node.id, "locked")}
                  onPreviewMaterial={async (value, pending) => {
                    if (!renderer.current || !node.assetId) return;
                    const sdk = await import(
                      /* @vite-ignore */ new URL(
                        "sdk/src/Nova.js",
                        document.baseURI,
                      ).href
                    );
                    await previewMaterial(
                      renderer.current,
                      node.assetId,
                      value,
                      pending,
                      sdk.loadMaterialImage,
                    );
                  }}
                  onApply={applyAsset}
                  onUnique={uniqueAsset}
                  onExpand={expandSelectedModel}
                />
              ) : node &&
                (inspectorTab === "geometry" || inspectorTab === "material") ? (
                <div className="asset-properties">
                  <h3>
                    {inspectorTab === "material"
                      ? "子网格材质槽"
                      : "模型内部节点"}
                  </h3>
                  {scene.nodes
                    .filter(
                      (n) =>
                        n.id !== node.id &&
                        modelDescendants.has(n.id) &&
                        (inspectorTab !== "material" || n.assetId),
                    )
                    .map((n) => (
                      <button
                        className="model-part-row"
                        key={n.id}
                        onClick={() => select(n.id)}
                      >
                        {scene.nodes.find((p) => p.id === n.parentId)?.name} /{" "}
                        {n.name}
                      </button>
                    ))}
                  {!scene.nodes.some((n) => n.parentId === node.id) && (
                    <p className="hint">此节点没有子网格。</p>
                  )}
                </div>
              ) : node && selections.length > 1 ? (
                <div className="properties">
                  {transformSpaceControl()}
                  {groupError && (
                    <p role="alert" className="notice">
                      {groupError}
                    </p>
                  )}
                  <GroupTransform
                    key={sceneKey + selections.join("|") + transformSpace}
                    count={selections.length}
                    disabled={busy || !!groupError || history.isPreviewing}
                    onApply={(delta) =>
                      edit((s) => {
                        const f = selectionFrame(
                          s,
                          selections,
                          node.id,
                          transformSpace,
                          assetBounds,
                        );
                        applySelectionEdits(s, selectionEdits(s, f, delta));
                      })
                    }
                  />
                </div>
              ) : node ? (
                <div className="properties">
                  {inheritedFlag(scene, node.id, "locked") && (
                    <p className="notice">已锁定</p>
                  )}
                  <fieldset
                    className="object-fields"
                    disabled={busy || inheritedFlag(scene, node.id, "locked")}
                  >
                    <div className="object-identity" title={node.id}>
                      <Icon name={node.assetId ? "cube" : "circle"} />
                      <div>
                        <strong>{node.name}</strong>
                        <small>
                          {node.camera
                            ? "相机"
                            : node.light
                              ? "方向光"
                              : node.assetId
                                ? "模型实例"
                                : "空节点"}
                        </small>
                      </div>
                    </div>
                    <label className="field">
                      名称
                      <NameField
                        id={node.id}
                        value={node.name}
                        onCommit={(value) =>
                          edit((s) => {
                            assertEditable(s, [node.id]);
                            s.nodes.find((n) => n.id === node.id)!.name = value;
                          })
                        }
                      />
                    </label>
                    <h3>
                      变换
                      <span>
                        {transformSpace === "local" ? "局部坐标" : "世界坐标"}
                      </span>
                    </h3>
                    {node.assetId && assetBounds[node.assetId] && (
                      <p className="asset-dimensions">
                        {scene.assets[node.assetId].sourceSpace
                          ? "原始尺寸（米）"
                          : "兼容旧项目 · 归一化尺寸"}
                        <br />
                        {assetBounds[node.assetId].maximum
                          .map((v, k) =>
                            (v - assetBounds[node.assetId!].minimum[k]).toFixed(
                              3,
                            ),
                          )
                          .join(" × ")}
                      </p>
                    )}
                    {(node.camera || node.light) && (
                      <SceneObjectProperties
                        key={JSON.stringify(node)}
                        node={node}
                        disabled={
                          busy ||
                          inheritedFlag(scene, node.id, "locked") ||
                          history.isPreviewing
                        }
                        viewing={mainPreview}
                        notice={cameraNotice}
                        onApply={(component, yaw, pitch) =>
                          edit((s) => {
                            aimObject(s, node.id, yaw, pitch);
                            const n = s.nodes.find((n) => n.id === node.id)!;
                            if (n.camera) {
                              n.camera = component as NonNullable<
                                SceneNode["camera"]
                              >;
                            } else
                              n.light = component as NonNullable<
                                SceneNode["light"]
                              >;
                          })
                        }
                        onPrimary={(enabled) =>
                          edit((s) =>
                            setPrimary(
                              s,
                              node.id,
                              node.camera ? "camera" : "light",
                              enabled,
                            ),
                          )
                        }
                        onCapture={() =>
                          edit((s) =>
                            captureCamera(s, node.id, cameraLatest.current),
                          )
                        }
                        onPreview={toggleMainPreview}
                      />
                    )}
                    {transformSpaceControl()}
                    {transformError && (
                      <p className="notice">{transformError}</p>
                    )}
                    {displayedTransform && (
                      <>
                        {vector(node, "position")}
                        {vector(node, "scale")}
                        <fieldset>
                          <legend>旋转（度）</legend>
                          <div className="vector">
                            {quaternionEuler(displayedTransform.rotation).map(
                              (angle, i) => (
                                <label key={i}>
                                  {"XYZ"[i]}
                                  <NumberField
                                    label={`rotation-${i}`}
                                    step={1}
                                    value={Math.round(angle * 1000) / 1000}
                                    onValue={(value) => {
                                      edit((s) => {
                                        const t = readNodeTransform(
                                            s,
                                            node.id,
                                            transformSpace,
                                          ),
                                          angles = quaternionEuler(t.rotation);
                                        angles[i] = value;
                                        t.rotation = eulerQuaternion(angles);
                                        writeNodeTransform(
                                          s,
                                          node.id,
                                          transformSpace,
                                          t,
                                        );
                                      });
                                    }}
                                  />
                                </label>
                              ),
                            )}
                          </div>
                        </fieldset>
                      </>
                    )}
                    <button
                      disabled={busy || history.isPreviewing || !!resourceDrag}
                      onClick={landSelection}
                      title="将选中对象及子树下落到下方模型表面；无支撑时落到地面"
                    >
                      一键落地
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => treeCommand("duplicate")}
                    >
                      <Icon name="duplicate" />
                      复制实例
                    </button>
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() => treeCommand("delete")}
                    >
                      <Icon name="trash" />
                      删除节点及子节点
                    </button>
                  </fieldset>
                </div>
              ) : (
                <p className="hint">选择场景节点，查看并编辑属性。</p>
              )}
            </section>
          </div>
          <section
            className="sidebar-page"
            role="tabpanel"
            id="sidebar-project"
            aria-labelledby="tab-project"
            hidden={sidebarTab !== "project"}
          >
            <h3>项目</h3>
            <strong className="project-title-text">{scene.name}</strong>
            <div className="project-summary">
              <span>节点</span>
              <strong>{scene.nodes.length}</strong>
              <span>资源</span>
              <strong>{Object.keys(scene.assets).length}</strong>
            </div>
            <button disabled={busy} onClick={() => void exportProject()}>
              保存项目
            </button>
            <button disabled={busy} onClick={() => void exportProject(true)}>
              下载项目包
            </button>
            <button
              disabled={busy}
              onClick={() => projectInput.current?.click()}
            >
              打开项目
            </button>
            <h3>资源</h3>
            <button onClick={() => setAssetsOpen((v) => !v)}>
              {assetsOpen ? "收起资源库" : "展开资源库"}
            </button>
            <button disabled={busy} onClick={() => modelInput.current?.click()}>
              导入 GLB
            </button>
            {recoveries.length > 0 && (
              <button onClick={() => setRecoveryDismissed(false)}>
                恢复副本（{recoveries.length}）
              </button>
            )}
            <p className="compact-status">{recoveryStatus}</p>
          </section>
          <section
            className="sidebar-page"
            role="tabpanel"
            id="sidebar-settings"
            aria-labelledby="tab-settings"
            hidden={sidebarTab !== "settings"}
          >
            <h3>视图</h3>
            <label className="setting-row">
              资源库
              <input
                type="checkbox"
                checked={assetsOpen}
                onChange={(e) => setAssetsOpen(e.target.checked)}
              />
            </label>
            <label className="setting-row">
              网格吸附
              <input
                type="checkbox"
                checked={gridSnap}
                onChange={(e) => setGridSnap(e.target.checked)}
              />
            </label>
            <label className="setting-row">
              吸附步长
              <select
                aria-label="设置吸附步长"
                value={gridStep}
                onChange={(e) => setGridStep(Number(e.target.value))}
              >
                {gridSteps.map((v) => (
                  <option key={v} value={v}>
                    {v} m
                  </option>
                ))}
              </select>
            </label>
            <label className="setting-row">
              默认光照
              <input
                type="checkbox"
                checked={lit}
                disabled={busy}
                onChange={(e) => changeLit(e.target.checked)}
              />
            </label>
            <h3>快捷键</h3>
            <dl className="shortcuts">
              <dt>移动 / 旋转 / 缩放</dt>
              <dd>W / E / R</dd>
              <dt>局部 / 世界坐标</dt>
              <dd>X</dd>
              <dt>聚焦 / 全景</dt>
              <dd>F / Shift F</dd>
              <dt>平移 / 投影</dt>
              <dd>H / P</dd>
              <dt>保存</dt>
              <dd>Ctrl / ⌘ S</dd>
              <dt>撤销 / 重做</dt>
              <dd>Ctrl / ⌘ Z / Shift Z</dd>
            </dl>
          </section>
        </aside>
        <section
          className={`assets ${assetsOpen ? "expanded" : "collapsed"}`}
          aria-label="资源库抽屉"
        >
          <div className="panel-title">
            <button
              className="asset-drawer-toggle"
              aria-expanded={assetsOpen}
              aria-controls="asset-drawer-content"
              onClick={() => setAssetsOpen((v) => !v)}
            >
              {assetsOpen ? "▾" : "▸"} 资源库{" "}
              <span>{Object.keys(scene.assets).length}</span>
            </button>
            <button disabled={busy} onClick={() => modelInput.current?.click()}>
              ＋ 导入 GLB
            </button>
          </div>
          <div
            className="asset-list"
            id="asset-drawer-content"
            hidden={!assetsOpen}
          >
            {Object.entries(scene.assets).map(([id, a]) => (
              <button
                className={
                  "asset " +
                  (node?.assetId === id ? "selected " : "") +
                  (resourceDrag?.assetId === id ? "dragging" : "")
                }
                key={id}
                title="拖入视口创建实例；单击选择已有实例"
                onPointerDown={(e) => {
                  if (
                    e.button !== 0 ||
                    busy ||
                    history.isPreviewing ||
                    !assetBounds[id]
                  )
                    return;
                  consumeAssetClick.current = false;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setResourceDrag({
                    assetId: id,
                    name: resourceName(id),
                    pointerId: e.pointerId,
                    startX: e.clientX,
                    startY: e.clientY,
                    source: e.currentTarget,
                  });
                }}
                disabled={busy}
                onClick={() => {
                  if (consumeAssetClick.current) {
                    consumeAssetClick.current = false;
                    return;
                  }
                  const n = scene.nodes.find((n) => n.assetId === id);
                  if (n) select(n.id);
                }}
              >
                <span className="asset-icon">
                  <Icon name="cube" />
                </span>
                <span className="asset-info">
                  <strong>{resourceName(id)}</strong>
                  <small>GLB 模型</small>
                </span>
              </button>
            ))}
            {!Object.keys(scene.assets).length && (
              <p className="hint">
                资产随项目归档一起保存，桌面端与网页端使用相同相对路径。
              </p>
            )}
          </div>
        </section>
      </div>

      <footer>
        <span className="status-dot" />
        {status}
        <span className="spacer" />
        <span>
          {recoveryStatus} · {scene.nodes.length} 个节点
        </span>
      </footer>
      <input
        hidden
        type="file"
        accept=".glb"
        ref={modelInput}
        onChange={(e) => {
          void importGLB(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        hidden
        type="file"
        accept=".zip"
        ref={projectInput}
        onChange={(e) => {
          void openProject(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
