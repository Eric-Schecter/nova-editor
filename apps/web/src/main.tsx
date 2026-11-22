import { tr, useLanguage, setLanguage } from "./language";
import { previewWorldMatrices } from "../../../packages/editor-core/src/scene-preview";
import {
  glbToOBJ,
  objToGLB,
} from "../../../packages/asset-system/obj-materials";
import {
  glbToMesh,
  meshToGLB,
  type MeshFormat,
} from "../../../packages/asset-system/mesh-formats";
import { zipSync } from "fflate";
import {
  packGLTF,
  resourcePath,
  splitGLB,
} from "../../../packages/asset-system/convert-gltf";
import { prepareGLTFImport } from "../../../packages/asset-system/prepare-gltf-import";
import { exportGLB } from "../../../packages/asset-system/export-glb";
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
  sceneLights,
  captureCamera,
  aimObject,
  aimLightAt,
  applyCameraLens,
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
import { decodeModel, expandModel, ModelExpansionBudgetError } from "../../../packages/asset-system/model";
import { AssetProperties } from "./AssetProperties";
import {
  readGLB,
  writeGLB,
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
import React, { useEffect, useMemo, useRef, useState } from "react";
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
  type Scene,
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
import { AssetPreview } from "./asset-preview";

type Playback = {
  clip: number;
  time: number;
  speed: number;
  playing: boolean;
  loop: boolean;
};

type RenderMode = "raster" | "ray-tracing" | "hybrid";
type RasterPipeline = "forward" | "deferred";

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
    assets: { id: string; url: string; sourceSpace?: boolean; materialVariant?: number }[],
    instances: {
      id: string;
      assetId: string;
      world: number[];
      castShadow?: boolean;
    }[],
  ) => Promise<unknown>;
  setCamera: (camera: Camera) => void;
  getAnimations: (assetId: string) => { name: string; duration: number }[];
  getAnimationState: (id: string) => Playback;
  setAnimationState: (id: string, state: Partial<Playback>) => void;
  updateAnimations: (delta: number) => void;
  drawFrame: () => Promise<unknown>;
  setContinuousRendering: (enabled: boolean) => void;
  enableOrbitControls: () => void;
  dispose: () => void;
  setClearColor: (c: number[]) => void;
  setLights: (lights: ReturnType<typeof sceneLights>) => void;
  getLightingCapabilities: () => {
    maxLights: number;
    directionalShadows: boolean;
    pointShadows: boolean;
    spotShadows: boolean;
    reason: string;
  };
  setRenderMode: (mode: RenderMode) => void;
  getRenderMode: () => RenderMode;
  getHybridCapabilities: () => { supported: boolean; temporalReconstruction: boolean; reason: string };
  setHybrid: (settings: {
    reflections: boolean;
    ambientOcclusion: boolean;
    temporalReconstruction: boolean;
    shadowSamples?: number;
    aoSamples?: number;
  }) => void;
  getRasterSettings: () => { pipeline: RasterPipeline };
  setRasterSettings: (settings: { pipeline: RasterPipeline }) => void;
  getCapabilities: () => {
    rayTracing: boolean;
    softwareRayTracing: boolean;
    reason: string;
  };
  setRayTracing: (settings: any) => void;
  getRayTracing: () => any;
  setLighting: (mode: "pbr" | "unlit") => void;
  setShadows: (settings: {
    enabled?: boolean;
    softness?: number;
    samples?: number;
    halfResolution?: boolean;
  }) => void;
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
      aria-label={tr("Name", "名称")}
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
  const language = useLanguage();
  useEffect(() => { document.documentElement.lang = language === "zh" ? "zh-CN" : "en"; }, [language]);
  const [, render] = useState(0),
    [selection, setPrimarySelection] = useState<string | null>(null),
    [selections, setSelections] = useState<string[]>([]),
    [mainPreview, setMainPreview] = useState(false),
    [cameraNotice, setCameraNotice] = useState(""),
    [viewportTool, setViewportTool] = useState<"select" | "translate" | "rotate" | "scale">("translate"),
    [viewportSettings, setViewportSettings] = useState(false),
    [transformSpace, setTransformSpace] = useState<TransformSpace>("local"),
    [recoveries, setRecoveries] = useState<Recovery[]>([]),
    [recoveryDismissed, setRecoveryDismissed] = useState(false),
    [recoveryReady, setRecoveryReady] = useState(false),
    [recoveryStatus, setRecoveryStatus] = useState(tr("Opening recovery storage", "恢复存储初始化中")),
    [status, setStatus] = useState(tr("Ready", "准备就绪")),
    [preview, setPreview] = useState(tr("Empty scene", "空场景")),
    [renderingBusy, setBusy] = useState(false),
    [projectBusy, setProjectBusy] = useState(false),
    [resourceDrag, setResourceDrag] = useState<ResourceDrag | null>(null),
    [gridSnap, setGridSnap] = useState(true),
    [moveSnap, setMoveSnap] = useState(false),
    [lightAimId, setLightAimId] = useState<string | null>(null),
    [lit, setLit] = useState(true),
    [halfShadows, setHalfShadows] = useState(false),
    [renderMode, setRenderMode] = useState<RenderMode>("raster"),
    [integrator, setIntegrator] = useState("path"),
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
  const performanceLabel = useRef<HTMLOutputElement>(null);
  const frameStats = useRef({ last: 0, average: 0, displayed: 0 });

  function recordViewportFrame() {
    if (!alive.current) return;
    const stats = frameStats.current;
    const now = performance.now();
    const previous = stats.last;
    const interval = now - previous;
    stats.last = now;
    if (!previous || interval <= 0) return;
    if (document.hidden) {
      stats.last = 0;
      stats.average = 0;
      return;
    }
    stats.average = stats.average
      ? stats.average * 0.85 + interval * 0.15
      : interval;
    if (now - stats.displayed < 250 || !performanceLabel.current) return;
    stats.displayed = now;
    performanceLabel.current.textContent = `${Math.round(1000 / stats.average)} FPS · ${stats.average.toFixed(1)} ms`;
  }
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
  const inspectedAsset = node?.assetId ? scene.assets[node.assetId] : undefined;
  const inspectedBytes = inspectedAsset ? assets.current[inspectedAsset.path] : undefined;
  const materialVariants = useMemo(() => {
    if (!inspectedBytes) return [];
    try {
      const variants = readGLB(inspectedBytes).json.extensions?.KHR_materials_variants?.variants;
      return Array.isArray(variants)
        ? variants.map((v: { name?: string }, i: number) => v.name || tr("Material variants", "材质变体") + (i + 1)) : [];
    } catch {
      return [];
    }
  }, [inspectedBytes]);
  let previewCamera: Camera | null = null;
  if (mainPreview)
    try {
      previewCamera = sceneCamera(scene);
    } catch {}
  const viewCamera = previewCamera ?? camera,
    activeSceneLight = scene.nodes.find((n) => n.light);
  const runtime = useRef<{ snapshot: Scene; time: number } | null>(null);
  const restorePreview = useRef(false);
  const submitPreview = useRef<((worlds?: Map<string, number[]>) => Promise<unknown>) | null>(null);
  const [scenePlaying, setScenePlaying] = useState(false);
  const hasBehavior = scene.nodes.some(n => n.previewBehavior);

  function stopScenePreview() {
    runtime.current = null;
    restorePreview.current = true;
    setScenePlaying(false);
  }

  function toggleScenePreview() {
    if (runtime.current) { stopScenePreview(); return; }
    if (busy || history.isPreviewing || !submitPreview.current || !hasBehavior) return;
    runtime.current = { snapshot: history.scene, time: 0 };
    setScenePlaying(true);
  }

  function behaviorControls() {
    if (!node || node.camera || node.light) return null;
    const behavior = node.previewBehavior;
    const apply = (value: typeof behavior) => edit(doc => {
      assertEditable(doc, [node.id]);
      const target = doc.nodes.find(n => n.id === node.id)!;
      if (value) target.previewBehavior = value;
      else delete target.previewBehavior;
    });
    return <fieldset disabled={busy || scenePlaying || inheritedFlag(scene, node.id, "locked")}>
      <legend>{tr("Preview behavior", "预览行为")}</legend>
      <label className="field">{tr("Behavior", "行为")}<select aria-label={tr("Behavior", "行为")} value={behavior?.kind ?? ""} onChange={e => {
        const kind = e.target.value;
        apply(kind === "spin" ? {kind, amount: 60} : kind === "bob" ? {kind, amount: .5} : undefined);
      }}>
        <option value="">{tr("None", "无")}</option><option value="spin">{tr("Spin around local Y", "绕本地 Y 轴旋转")}</option><option value="bob">{tr("Bob up and down", "上下浮动")}</option>
      </select></label>
      {behavior && <label className="field">{behavior.kind === "spin" ? tr("Speed (deg/s)", "速度（度/秒）") : tr("Amplitude (scene units)", "振幅（场景单位）")}
        <input type="number" min={behavior.kind === "spin" ? -360 : 0} max={behavior.kind === "spin" ? 360 : 10}
          step={behavior.kind === "spin" ? 1 : .1} value={behavior.amount} onChange={e => {
            const amount = e.target.valueAsNumber;
            if (Number.isFinite(amount)) apply({...behavior, amount: Math.max(behavior.kind === "spin" ? -360 : 0, Math.min(behavior.kind === "spin" ? 360 : 10, amount))});
          }} />
      </label>}
    </fieldset>;
  }

  const playingAnimations = useRef(new Set<string>());
  const [, refreshPlayback] = useState(0);
  useEffect(() => {
    if (busy) return;
    let frame = 0,
      previous: number | undefined,
      stopped = false;
    let lastPlaybackRefresh = 0;
    const tick = async (now: number) => {
      const raw = renderer.current;
      if (raw) {
        const hadPlayback = playingAnimations.current.size > 0;
        for (const id of playingAnimations.current) {
          try {
            if (raw.getAnimationState(id).playing) continue;
          } catch {
            /* The instance may have been removed or hidden. */
          }
          playingAnimations.current.delete(id);
        }
        try {
          const delta = previous === undefined ? 0 : Math.min(.1, (now - previous) / 1000);
          if (restorePreview.current) {
            restorePreview.current = false;
            await submitPreview.current?.();
          }
          const session = runtime.current;
          if (session && submitPreview.current) {
            session.time += delta;
            await submitPreview.current(previewWorldMatrices(session.snapshot, session.time));
          }
          if (playingAnimations.current.size) {
            raw.updateAnimations(
              previous === undefined
                ? 0
                : Math.min(0.1, (now - previous) / 1000),
            );
          }
          await raw.drawFrame();
          if (
            !stopped &&
            hadPlayback &&
            (now - lastPlaybackRefresh >= 100 ||
              !playingAnimations.current.size)
          ) {
            lastPlaybackRefresh = now;
            refreshPlayback((value) => value + 1);
          }
        } catch (error) {
          if (!stopped) setStatus(String(error));
          playingAnimations.current.clear();
          if (runtime.current) {
            stopScenePreview();
            if (!stopped) frame = requestAnimationFrame(tick);
          }
          return;
        }
      }
      previous = now;
      if (!stopped) frame = requestAnimationFrame(tick);
    };
    const resetFrameStats = () => {
      frameStats.current.last = 0;
      frameStats.current.average = 0;
    };
    document.addEventListener("visibilitychange", resetFrameStats);
    frame = requestAnimationFrame(tick);
    return () => {
      document.removeEventListener("visibilitychange", resetFrameStats);
      resetFrameStats();
      stopped = true;
      cancelAnimationFrame(frame);
    };
  }, [busy, renderMode]);

  function animationControls() {
    const raw = renderer.current;
    if (!raw || !node?.assetId || busy) return null;
    const id = node.id;
    let clips, state;
    try {
      clips = raw.getAnimations(node.assetId);
      if (!clips.length) return null;
      state = raw.getAnimationState(id);
    } catch {
      return null;
    }
    const apply = (patch: Partial<Playback>) => {
      try {
        raw.setAnimationState(id, patch);
        if (raw.getAnimationState(id).playing)
          playingAnimations.current.add(id);
        else playingAnimations.current.delete(id);
        refreshPlayback((value) => value + 1);
        void raw.drawFrame().catch((error) => setStatus(String(error)));
      } catch (error) {
        setStatus(String(error));
      }
    };
    const duration = clips[state.clip].duration;
    return (
      <section aria-label={tr("Animation", "动画")}>
        <h3>{tr("Animation", "动画")}</h3>
        <label className="field">{tr("Clip", "片段")}{" "}
          <select
            value={state.clip}
            onChange={(e) => apply({ clip: Number(e.target.value), time: 0 })}
          >
            {clips.map((clip, index) => (
              <option key={index} value={index}>
                {clip.name || `片段 ${index + 1}`}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() =>
            apply({
              playing: !state.playing,
              ...(!state.playing && state.time >= duration ? { time: 0 } : {}),
            })
          }
        >
          {state.playing ? tr("Pause", "暂停") : tr("Play", "播放")}
        </button>
        <label className="field">{tr("Time (s)", "时间（秒）")}{" "}
          <input
            type="range"
            min={0}
            max={duration}
            step="any"
            value={state.time}
            onChange={(e) => apply({ time: Number(e.target.value) })}
          />
          {state.time.toFixed(2)} / {duration.toFixed(2)}
        </label>
        <label className="field">{tr("Speed", "速度")}{" "}
          <input
            type="range"
            min={0.1}
            max={4}
            step={0.1}
            value={state.speed}
            onChange={(e) => apply({ speed: Number(e.target.value) })}
          />
          {state.speed.toFixed(1)}×
        </label>
      </section>
    );
  }
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
  const rasterBeforeHybrid = useRef<RasterPipeline | null>(null);
  function applyRenderMode(raw: Renderer, mode: RenderMode) {
    if (raw.getRenderMode() === mode) return;
    if (mode === "hybrid") {
      const caps = raw.getHybridCapabilities();
      if (!caps.supported) throw Error(caps.reason);
      const { pipeline } = raw.getRasterSettings();
      raw.setHybrid({
        reflections: true,
        ambientOcclusion: true,
        temporalReconstruction: caps.temporalReconstruction,
        ...(caps.temporalReconstruction ? { shadowSamples: 1, aoSamples: 1 } : {}),
      });
      raw.setRenderMode(mode);
      rasterBeforeHybrid.current = pipeline;
    } else {
      raw.setRenderMode(mode);
      if (rasterBeforeHybrid.current !== null) {
        raw.setRasterSettings({ pipeline: rasterBeforeHybrid.current });
        rasterBeforeHybrid.current = null;
      }
    }
    setRenderMode(mode);
  }
  function changeRenderMode(mode: RenderMode) {
    try {
      const raw = renderer.current;
      if (!raw) return;
      if (mode === "ray-tracing") {
        const caps = raw.getCapabilities();
        if (!caps.rayTracing) throw Error(caps.reason);
        raw.setRayTracing({
          ...raw.getRayTracing(),
          maxBounces: 3,
          resolutionScale: 0.5,
          denoise: true,
        });
      }
      applyRenderMode(raw, mode);
    } catch (e) {
      setStatus(String(e));
    }
  }
  function changeIntegrator(value: string) {
    try {
      const raw = renderer.current;
      if (!raw) return;
      raw.setRayTracing({ ...raw.getRayTracing(), integrator: value });
      setIntegrator(value);
      void raw.drawFrame().catch((e) => setStatus(String(e)));
    } catch (e) {
      setStatus(String(e));
    }
  }
  function changeLight(value: LightingSettings) {
    if (history.scene.nodes.some((n) => n.light)) return;
    try {
      renderer.current?.setLights([
        {
          id: "__studio",
          type: "directional",
          enabled: true,
          ...rendererLight(value),
          position: [0, 0, 0],
          range: 0,
          innerConeAngle: 0.35,
          outerConeAngle: 0.6,
          castShadow: value.shadows,
          shadowSoftness: value.softness,
        },
      ]);
      renderer.current?.setShadows({
        enabled: true,
        softness: 1,
        samples: 2,
      });
      setLight(value);
      if (renderer.current)
        void renderer.current.drawFrame().catch((e) => setStatus(String(e)));
    } catch (e) {
      setStatus(String(e));
    }
  }
  function changeShadowResolution(halfResolution: boolean) {
    try {
      renderer.current?.setShadows({ halfResolution });
      setHalfShadows(halfResolution);
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
    if (documentIO.current || runtime.current) return;
    try {
      history.commit(fn);
      refresh();
      setStatus(tr("Scene updated", "场景已更新"));
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
          setRecoveryStatus(tr("Local recovery ready", "本机恢复已就绪"));
        }
      })
      .catch((e) => {
        if (active) {
          setRecoveryReady(true);
          setRecoveryStatus(`${tr("Recovery unavailable", "恢复不可用")}: ${e}`);
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
      setRecoveryStatus(tr("Updating recovery…", "恢复副本更新中…"));
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
                ? tr("Project saved", "项目已保存")
                : tr("Recovery updated", "恢复副本已更新"),
            ),
        )
        .catch((e) => {
          if (active) setRecoveryStatus(`${tr("Recovery failed", "恢复副本失败")}: ${e}`);
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
    if (runtime.current) stopScenePreview();
    submitPreview.current = null;
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
              recordViewportFrame,
            );
            if (!alive.current) {
              next.dispose();
              return;
            }
            // The editor already schedules frames and advances animation for every instance.
            next.setContinuousRendering(false);
            next.setClearColor([0.6, 0.6, 0.6, 1]);
            next.setLighting(lit ? "pbr" : "unlit");
            next.setDirectionalLight(rendererLight(light));
            next.setShadows({
              enabled: light.shadows,
              softness: light.softness,
              samples: 2,
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
            if (!data) throw Error(`${tr("Missing asset", "缺少资产")} ${a.path}`);
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
            return { id, url: cached!.url, sourceSpace: !!a.sourceSpace,
              ...(a.materialVariant === undefined ? {} : { materialVariant: a.materialVariant }) };
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
              if (!r.ok) throw Error(tr("Missing viewport resources", "缺少视口辅助资源"));
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
          const raw = renderer.current;
          const updateScene = () =>
            raw.setScene(
              [...definitions, ...helperAssets],
              [...instances, ...unusedResources, ...helperInstances],
            );
          try {
            await updateScene();
          } catch (error) {
            if (
              !(error instanceof Error) ||
              error.message !== "Animated scenes require Raster mode"
            )
              throw error;
            applyRenderMode(raw, "raster");
            await updateScene();
          }
          submitPreview.current = (previewWorlds) => raw.setScene(
            [...definitions, ...helperAssets],
            [...instances.map(instance => ({
              ...instance,
              world: previewWorlds?.get(instance.id) ?? instance.world,
            })), ...unusedResources, ...helperInstances],
          );
          const world = snapshot.world ?? defaultWorld();
          const envBytes = world.environment.map
            ? bytes[world.environment.map]
            : undefined;
          if (world.environment.map && !envBytes) throw Error(tr("Missing environment map", "缺少环境贴图"));
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
          const lamps = sceneLights(snapshot);
          renderer.current.setLights(
            snapshot.nodes.some((n) => n.light)
              ? lamps
              : [
                  {
                    id: "__studio",
                    type: "directional",
                    enabled: true,
                    ...rendererLight(light),
                    position: [0, 0, 0],
                    range: 0,
                    innerConeAngle: 0.35,
                    outerConeAngle: 0.6,
                    castShadow: light.shadows,
                    shadowSoftness: light.softness,
                  },
                ],
          );
          renderer.current.setShadows({
            enabled: true,
            softness: 1,
            samples: 2,
          });
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
                ? `${instances.length} ${tr("model instances", "个模型实例")}`
                : snapshot.nodes.some((n) => n.assetId)
                  ? tr("0 visible model instances", "0 个可见模型实例")
                  : tr("Empty scene", "空场景"),
            );
            setStatus((previous) =>
              previous === tr("Ready", "准备就绪") ? tr("Ready", "就绪") : previous,
            );
          }
        } catch (e) {
          if (alive.current) setStatus(`${tr("Scene rendering failed", "场景渲染失败")}: ${e}`);
        } finally {
          if (alive.current && token === generation.current) setBusy(false);
        }
      });
  }, [sceneKey, mainPreview]);
  function applyWorld(world: WorldSettings) {
    const valid = validateWorld(world);
    history.commit((s) => {
      s.schemaVersion = Math.max(4, s.schemaVersion) as Scene["schemaVersion"];
      s.world = valid;
    });
    refresh();
    setStatus(tr("Scene environment updated", "场景环境已更新"));
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
      const extension = file.name.toLowerCase().split(".").pop();
      if (
        (!extension || !["glb", "gltf", "obj", "stl", "step", "stp"].includes(extension)) ||
        file.size > 128 * 1024 * 1024
      )
        throw Error(tr("Choose a glTF, GLB, OBJ, STL, or STEP file under 128 MiB", "请选择小于 128 MiB 的 glTF、GLB、OBJ、STL 或 STEP"));
      let bytes: Uint8Array;
      if (extension === "step" || extension === "stp") {
        documentIO.current = true;
        setProjectBusy(true);
        setStatus(tr("Triangulating STEP…", "正在三角化 STEP…"));
        try {
          const { convertSTEP } = await import("./step");
          bytes = await convertSTEP(file);
        } finally {
          documentIO.current = false;
          setProjectBusy(false);
        }
      } else {
        const raw = new Uint8Array(await file.arrayBuffer());
        bytes = extension === "glb" ? raw : extension === "gltf"
          ? packGLTF(raw, (path) => {
              throw Error(tr("Missing", "缺少") + path + tr(". Use Import glTF folder.", "，请使用「导入 glTF 资源文件夹」"));
            })
          : extension === "obj"
          ? objToGLB(raw, (path) => {
              throw Error(tr("Missing", "缺少") + path + tr(". Select the OBJ resource folder.", "，请选择 OBJ 资源文件夹"));
            })
          : meshToGLB(raw, extension as "stl");
      }
      if (documentIO.current) return;
      const doc = readGLB(bytes);
      const id = crypto.randomUUID();
      const sceneObjects = prepareGLTFImport(doc, id, () => crypto.randomUUID());
      if (sceneObjects.changed) bytes = writeGLB(doc);
      const animated = !!(doc.json.animations?.length || doc.json.skins?.length);
      const hasMeshes = !!doc.json.meshes?.length;
      let model: ReturnType<typeof decodeModel> | null = null;
      let keptWhole = !!doc.json.meshes?.some((mesh: any) =>
        mesh.primitives.some((primitive: any) => primitive.targets?.length));
      keptWhole ||= !!doc.json.nodes?.some((node: any) => node.extensions?.EXT_mesh_gpu_instancing);
      keptWhole ||= !!doc.json.materials?.some((material: any) => material.extensions?.KHR_materials_volume);
      keptWhole ||= !!doc.json.extensions?.KHR_materials_variants;
      if (!animated && !keptWhole && (hasMeshes || !sceneObjects.nodes.length)) {
        try {
          model = decodeModel(bytes);
        } catch (error) {
          if (!(error instanceof ModelExpansionBudgetError)) throw error;
          keptWhole = true;
        }
      }
      if (animated && renderer.current && renderer.current.getRenderMode() !== "raster")
        changeRenderMode("raster");
      let files: Record<string, Uint8Array> = {};
      edit((s) => {
        s.nodes.push({
          id,
          parentId: null,
          name: file.name.replace(/\.(glb|gltf|obj|stl|step|stp)$/i, ""),
          transform: identity(),
        });
        if (model) files = expandModel(s, id, model, () => crypto.randomUUID());
        else if (hasMeshes) {
          const path = `assets/${id}.glb`;
          s.assets[id] = { path, sourceSpace: true, name: file.name };
          s.nodes[s.nodes.length - 1].assetId = id;
          files[path] = bytes;
        }
        if (sceneObjects.nodes.length) {
          s.schemaVersion = 7;
          s.nodes.push(...sceneObjects.nodes);
        }
      });
      Object.assign(assets.current, files);
      if (keptWhole) setStatus(tr("Imported as one asset. Internal nodes and material slots are collapsed.", "模型已整体导入：内部节点和材质槽未展开"));
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
        !window.confirm(tr("Discard unsaved changes and open another project?", "当前项目尚未保存。是否放弃修改并打开？"))
      )
        return;
      await removeRecovery(recoveryId.current);
      setMainPreview(false);
      setCameraNotice("");
      history.replace(next.scene);
      setAssetsOpen(Object.keys(next.scene.assets).length > 0);
      assets.current = next.assets;
      saved.current = JSON.stringify(next.scene);
      pendingFocus.current = "*";
      select(null);
      refresh();
      setSidebarTab("scene");
      setStatus(tr("Project archive opened", "已打开项目归档"));
    } catch (e) {
      setStatus(`${tr("Open failed", "打开失败")}: ${e}`);
    } finally {
      documentIO.current = false;
      setProjectBusy(false);
    }
  }
  const packInput = useRef<HTMLInputElement>(null);
  const importGLTFFolder = useRef(false);
  const splitInput = useRef<HTMLInputElement>(null);
  async function convertModel(files: File[], pack: boolean, importIntoScene = false) {
    if (documentIO.current || !files.length) return;
    documentIO.current = true;
    setProjectBusy(true);
    let imported: File | undefined;
    try {
      const models = files.filter((file) =>
        file.name.toLowerCase().endsWith(pack ? ".gltf" : ".glb"),
      );
      if (models.length !== 1)
        throw Error(
          pack ? tr("Choose a folder containing exactly one .gltf file", "请选择只含一个 .gltf 的模型文件夹") : tr("Choose one GLB file", "请选择一个 GLB"),
        );
      const model = models[0];
      const read = async (file: File) => {
        if (file.size > 128 * 1024 * 1024)
          throw Error(tr("Resource exceeds 128 MiB:", "资源超过 128 MiB：") + file.name);
        return new Uint8Array(await file.arrayBuffer());
      };
      const source = await read(model);
      let converted: Uint8Array;
      if (pack) {
        const relative = model.webkitRelativePath;
        const parent = relative.slice(0, relative.lastIndexOf("/") + 1);
        const available = new Map(
          files.map((file) => [file.webkitRelativePath, file]),
        );
        const json = JSON.parse(new TextDecoder().decode(source));
        if (json.asset?.version !== "2.0") throw Error(tr("glTF 2.0 is required", "需要 glTF 2.0"));
        const resources = new Map<string, Uint8Array>();
        let total = 0;
        for (const entry of [...(json.buffers ?? []), ...(json.images ?? [])]) {
          if (typeof entry.uri !== "string" || entry.uri.startsWith("data:"))
            continue;
          const path = resourcePath(entry.uri);
          if (resources.has(path)) continue;
          const file = available.get(parent + path);
          if (!file) throw Error(tr("Missing resource:", "缺少资源：") + path);
          total += file.size;
          if (total > 128 * 1024 * 1024) throw Error(tr("External resources exceed 128 MiB", "外置资源超过 128 MiB"));
          resources.set(path, await read(file));
        }
        converted = packGLTF(source, (path) => {
          const bytes = resources.get(path);
          if (!bytes) throw Error(tr("Missing resource:", "缺少资源：") + path);
          return bytes;
        });
      } else {
        converted = zipSync(splitGLB(source), { level: 0 });
      }
      if (importIntoScene) {
        const name = model.name.replace(/\.gltf$/i, ".glb");
        imported = new File([new Uint8Array(converted)], name);
      } else {
        downloadModel(converted, model.name.replace(/\.(gltf|glb)$/i, "") +
          (pack ? ".glb" : "-gltf.zip"));
        setStatus(pack ? tr("GLB download started", "已生成 GLB 并发起下载") : tr("glTF archive download started", "已生成 glTF 资源包并发起下载"));
      }
    } catch (error) {
      setStatus(`${importIntoScene ? tr("glTF import failed", "导入 glTF 失败") : tr("Conversion failed", "格式转换失败")}：${error}`);
    } finally {
      documentIO.current = false;
      setProjectBusy(false);
    }
    if (imported) await importGLB(imported);
  }

  const objFolderInput = useRef<HTMLInputElement>(null);
  const objFolderImport = useRef(false);
  async function openOBJFolder(files: File[], importIntoScene: boolean) {
    if (documentIO.current || !files.length) return;
    documentIO.current = true;
    setProjectBusy(true);
    let model: File | undefined;
    try {
      const matches = files.filter((file) => /\.obj$/i.test(file.name));
      if (matches.length !== 1) throw Error(tr("Choose a folder containing exactly one OBJ file", "请选择只含一个 OBJ 的资源文件夹"));
      const source = matches[0];
      const prefix = source.webkitRelativePath.slice(
        0,
        source.webkitRelativePath.lastIndexOf("/") + 1,
      );
      const resources = new Map<string, Uint8Array>();
      let total = 0;
      for (const file of files) {
        if (
          !file.webkitRelativePath.startsWith(prefix) ||
          !/\.(obj|mtl|png|jpe?g)$/i.test(file.name)
        )
          continue;
        total += file.size;
        if (total > 128 * 1024 * 1024) throw Error(tr("OBJ resources exceed 128 MiB", "OBJ 资源超过 128 MiB"));
        resources.set(
          file.webkitRelativePath.slice(prefix.length),
          new Uint8Array(await file.arrayBuffer()),
        );
      }
      const load = (path: string) => {
        const bytes = resources.get(path);
        if (!bytes) throw Error(tr("Missing resource:", "缺少资源：") + path);
        return bytes;
      };
      const bytes = objToGLB(load(source.name), load);
      const name = source.name.replace(/\.obj$/i, ".glb");
      if (importIntoScene) model = new File([new Uint8Array(bytes)], name);
      else {
        downloadModel(bytes, name);
        setStatus(tr("GLB download started with materials and textures", "已发起 GLB 下载（含材质与贴图）"));
      }
    } catch (error) {
      setStatus(`${tr("OBJ processing failed", "OBJ 处理失败")}: ${error}`);
    } finally {
      documentIO.current = false;
      setProjectBusy(false);
    }
    if (model) await importGLB(model);
  }

  const fbxInput = useRef<HTMLInputElement>(null);
  const fbxTarget = useRef<"fbx" | "glb">("fbx");

  function startFBXConversion(target: "fbx" | "glb") {
    fbxTarget.current = target;
    const input = fbxInput.current;
    if (!input) return;
    input.accept = target === "fbx" ? ".glb" : ".fbx";
    input.click();
  }

  async function convertFBXFile(file: File, target: "fbx" | "glb") {
    if (documentIO.current) return;
    documentIO.current = true;
    setProjectBusy(true);
    try {
      const source = target === "fbx" ? "glb" : "fbx";
      if (
        !file.name.toLowerCase().endsWith("." + source) ||
        !file.size ||
        file.size > 128 * 1024 * 1024
      )
        throw Error(
          tr("Choose a file under 128 MiB:", "请选择不超过 128 MiB 的") + source.toUpperCase() + tr("File", "文件"),
        );
      setStatus(tr("Converting model…", "正在转换模型…"));
      const { convertFBX } = await import("./fbx");
      const bytes = await convertFBX(file, target);
      if (target === "glb") readGLB(bytes);
      downloadModel(bytes, file.name.replace(/\.[^.]+$/, "." + target));
      setStatus(tr("Started", "已发起") + target.toUpperCase() + tr("download", "下载"));
    } catch (error) {
      setStatus(`${tr("FBX conversion failed", "FBX 转换失败")}: ${error}`);
    } finally {
      documentIO.current = false;
      setProjectBusy(false);
    }
  }

  const meshConversionInput = useRef<HTMLInputElement>(null);
  const meshConversionTarget = useRef<"glb" | MeshFormat>("glb");

  function startMeshConversion(target: "glb" | MeshFormat) {
    meshConversionTarget.current = target;
    const input = meshConversionInput.current;
    if (input) {
      input.accept = target === "glb" ? ".obj,.stl" : ".glb";
      input.click();
    }
  }

  async function convertMeshFile(file: File, target: "glb" | MeshFormat) {
    if (documentIO.current) return;
    documentIO.current = true;
    setProjectBusy(true);
    try {
      if (file.size > 128 * 1024 * 1024) throw Error(tr("File exceeds 128 MiB", "文件超过 128 MiB"));
      const source = file.name.toLowerCase().split(".").pop();
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (target === "glb" && (source === "obj" || source === "stl")) {
        downloadModel(
          source === "obj"
            ? objToGLB(bytes, (path) => {
                throw Error(tr("Missing", "缺少") + path + tr(". Select the OBJ resource folder.", "，请选择 OBJ 资源文件夹"));
              })
            : meshToGLB(bytes, source),
          file.name.replace(/\.[^.]+$/, ".glb"),
        );
      } else if (source === "glb" && target !== "glb") {
        downloadModel(
          target === "obj"
            ? zipSync(glbToOBJ(bytes), { level: 0 })
            : glbToMesh(bytes, target),
          file.name.replace(/\.[^.]+$/, target === "obj" ? "-obj.zip" : ".stl"),
        );
      } else throw Error(tr("Input file format does not match", "输入文件格式不匹配"));
      setStatus(target === "obj" ? tr("OBJ archive download started", "已发起 OBJ 资源包下载") : tr("Model download started", "已发起模型下载"));
    } catch (error) {
      setStatus(`${tr("Conversion failed", "格式转换失败")}: ${error}`);
    } finally {
      documentIO.current = false;
      setProjectBusy(false);
    }
  }

  function downloadModel(bytes: Uint8Array, name: string) {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function downloadGLB(
    selectedOnly: boolean,
    format: "glb" | MeshFormat = "glb",
  ) {
    if (history.isPreviewing || documentIO.current) {
      setStatus(tr("Finish the current operation before exporting", "请先结束当前操作再导出"));
      return;
    }
    try {
      const bytes = exportGLB(
        history.scene,
        (path) => {
          const data = assets.current[path];
          if (!data) throw Error(tr("Missing resource:", "缺少资源：") + path);
          return data;
        },
        selectedOnly ? selections : undefined,
      );
      downloadModel(
        format === "glb"
          ? bytes
          : format === "obj"
            ? zipSync(glbToOBJ(bytes), { level: 0 })
            : glbToMesh(bytes, format),
        (selectedOnly ? "selection" : "scene") +
          (format === "obj" ? "-obj.zip" : "." + format),
      );
      setStatus(
        format === "glb"
          ? tr("GLB download started", "已发起 GLB 下载")
          : format === "obj"
            ? tr("OBJ archive download started", "已发起 OBJ 资源包下载")
            : tr("STL download started (geometry only)", "已发起 STL 下载（仅几何）"),
      );
    } catch (e) {
      setStatus(`${tr("GLB export failed", "GLB 导出失败")}: ${e}`);
    }
  }
  async function exportProject(downloadOnly = false) {
    if (documentIO.current) return;
    if (history.isPreviewing) {
      setStatus(tr("Finish dragging before saving", "请先结束当前拖动再保存"));
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
                description: tr("Nova project", "Nova 项目"),
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
        setStatus(tr("Project saved. Extract the archive to open project.json in the desktop app.", "项目已保存，可解压后用桌面端打开 project.json"));
      } else {
        const url = URL.createObjectURL(new Blob([new Uint8Array(data)])),
          a = document.createElement("a");
        a.href = url;
        a.download = "nova-project.zip";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setStatus(tr("Download started. Recovery copy retained until save is confirmed.", "已发起下载，落盘未确认；恢复副本已保留"));
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        setStatus(`${tr("Save failed", "保存失败")}: ${e}`);
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
            throw Error(tr("Select one node for the reorder buttons. Drag to reorder multiple nodes.", "排序按钮请单选节点，批量排序可拖动"));
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
      setStatus(tr("Scene tree updated", "场景树已更新"));
    } catch (e) {
      setStatus(String(e));
    }
  }
  async function restoreRecovery(value: Recovery) {
    if (documentIO.current || history.isPreviewing) return;
    if (dirty && !window.confirm(tr("Replace current changes with the recovery copy?", "恢复将替换当前修改，是否继续？"))) return;
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
      setStatus(tr("Recovered. Save the project to keep the changes.", "已恢复；请保存项目以完成落盘"));
    } catch (e) {
      setStatus(`${tr("Recovery failed", "恢复失败")}: ${e}`);
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
      if (busy || history.isPreviewing || resourceDrag || runtime.current) return;
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
    setStatus(tr("Model instance created", "已创建模型实例"));
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
      setStatus(tr("Could not drop: missing model bounds or singular parent scale.", "无法落地：没有模型边界，或父节点缩放不可逆"));
      return;
    }
    edit((s) => {
      s.nodes.find((n) => n.id === selection)!.transform = t;
    });
    setStatus(tr("Dropped to surface", "已落到下方模型或地面"));
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
  function addSceneObject(
    kind: "camera" | "light",
    lightType: "directional" | "point" | "spot" = "directional",
  ) {
    if (busy) return;
    const id = crypto.randomUUID(),
      n =
        kind === "camera"
          ? createCamera(id, viewCamera)
          : createLight(id, lightType);
    edit((s) => {
      s.schemaVersion = Math.max(
        s.schemaVersion,
        kind === "light" ? 6 : 5,
      ) as Scene["schemaVersion"];
      s.nodes.push(n);
      if (kind === "light" || !s.nodes.some((x) => x.camera?.primary))
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
      if (!sceneCamera(history.scene)) throw Error(tr("Set a main camera first", "请先设置主相机"));
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
      setStatus(tr("Primitive created", "已创建几何体"));
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
      setStatus(tr("Model hierarchy and material slots expanded", "已展开模型层级与独立材质槽，可撤销"));
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
      setStatus(tr("Asset updated", "资源已更新，支持撤销"));
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
          name: resourceName(n.assetId!) + tr("Unique", "独立"),
        };
        n.assetId = id;
      });
      refresh();
      setStatus(tr("Unique asset created", "已创建独立资源副本"));
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
      if (!r.ok) throw Error(tr("Missing example resource", "示例资源缺失"));
      await openProject(new File([await r.blob()], "example.zip"));
      setSidebarTab("scene");
    } catch (e) {
      setStatus(String(e));
    }
  }
  async function importModelExample() {
    try {
      const r = await fetch(new URL("examples/model.glb", document.baseURI));
      if (!r.ok) throw Error(tr("Run fixtures:model to generate the example", "请运行 fixtures:model 生成示例"));
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
      if (!r.ok) throw Error(tr("Run fixtures:scene-objects", "请运行 fixtures:scene-objects"));
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
      if (!r.ok) throw Error(tr("Run fixtures:primitives to generate the example", "请运行 fixtures:primitives 生成示例"));
      await openProject(new File([await r.blob()], "primitives.zip"));
    } catch (e) {
      setStatus(String(e));
    }
  }
  async function newProject() {
    if (documentIO.current || history.isPreviewing) return;
    if (dirty && !window.confirm(tr("Discard unsaved changes and create a project?", "放弃未保存修改并新建项目？"))) return;
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
      setStatus(tr("Project created", "已新建项目"));
    } catch (e) {
      setStatus(`${tr("Could not create project", "新建失败")}: ${e}`);
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
  useEffect(() => { setLightAimId(null); }, [selection, selections.length, mainPreview]);
  function transformSpaceControl() {
    return (
      <label className="asset-property-field">{tr("Coordinates", "坐标系")}<select
          aria-label={tr("Transform space", "变换坐标系")}
          value={transformSpace}
          onChange={(e) =>
            changeTransformSpace(e.target.value as TransformSpace)
          }
        >
          <option value="local">{tr("Local", "局部")}</option>
          <option value="world">{tr("World", "世界")}</option>
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
      transformError = tr("The world transform contains shear. Use local space to edit values.", "当前世界变换包含剪切，请切到局部坐标编辑数值。");
    }
  let groupError = "";
  if (node && selections.length > 1)
    try {
      selectionFrame(scene, selections, node.id, transformSpace, assetBounds);
    } catch (e) {
      groupError = String(e);
    }
  function vector(n: SceneNode, key: "position" | "scale") {
    const label = key === "position" ? tr("Position", "位置") : tr("Scale", "缩放");
    return (
      <div className="transform-row" role="group" aria-label={label}>
        <span>{label}</span>
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
      </div>
    );
  }
  return (
    <div className="editor">
      <header className="menubar">
        <strong className="menu-brand">NOVA</strong>
        <nav aria-label={tr("Main menu", "主菜单")} inert={scenePlaying}>
          <Menu
            label={tr("File", "文件")}
            items={[
              {
                label: tr("New project", "新建项目"),
                action: () => void newProject(),
                disabled: busy,
              },
              {
                label: tr("Open project", "打开项目"),
                action: () => projectInput.current?.click(),
                disabled: busy,
              },
              {
                label: tr("Save project", "保存项目"),
                action: () => void exportProject(),
                disabled: busy,
                shortcut: "⌘ / Ctrl S",
              },
              {
                label: tr("Import glTF folder", "导入 glTF 资源文件夹"),
                action: () => {
                  importGLTFFolder.current = true;
                  packInput.current?.click();
                },
                disabled: busy,
              },
              {
                label: tr("glTF → GLB (choose folder)", "glTF → GLB（选择模型文件夹）"),
                action: () => {
                  importGLTFFolder.current = false;
                  packInput.current?.click();
                },
                disabled: busy,
              },
              {
                label: tr("GLB → glTF (download archive)", "GLB → glTF（下载资源包）"),
                action: () => splitInput.current?.click(),
                disabled: busy,
              },
              ...(["glb", "obj", "stl"] as const).map((target) => ({
                label:
                  target === "glb"
                    ? tr("OBJ / STL → GLB (single file)", "OBJ / STL → GLB（单文件）")
                    : target === "obj"
                      ? tr("GLB → OBJ (with MTL and textures)", "GLB → OBJ（含 MTL 和贴图）")
                      : tr("GLB → STL (geometry only)", "GLB → STL（仅几何）"),
                action: () => startMeshConversion(target),
                disabled: busy,
              })),
              ...(["obj", "stl"] as const).flatMap((format) =>
                [true, false].map((selectedOnly) => ({
                  label: `${tr("Export", "导出")} ${selectedOnly ? tr("selected objects", "选中对象") : tr("entire scene", "完整场景")} ${format.toUpperCase()}${format === "obj" ? tr(" (with resources)", "（含资源）") : tr(" (geometry only)", "（仅几何）")}`,
                  action: () => downloadGLB(selectedOnly, format),
                  disabled: busy || (selectedOnly && !selections.length),
                })),
              ),
              {
                label: tr("Export selected objects as GLB", "导出选中对象 GLB"),
                action: () => downloadGLB(true),
                disabled: busy || !selections.length,
              },
              {
                label: tr("Export scene as GLB", "导出完整场景 GLB"),
                action: () => downloadGLB(false),
                disabled: busy,
              },
              ...[true, false].map((importIntoScene) => ({
                label: importIntoScene
                  ? tr("Import OBJ folder", "导入 OBJ 资源文件夹")
                  : tr("OBJ folder → GLB", "OBJ 资源文件夹 → GLB"),
                action: () => {
                  objFolderImport.current = importIntoScene;
                  objFolderInput.current?.click();
                },
                disabled: busy,
              })),
              {
                label: "FBX → GLB",
                action: () => startFBXConversion("glb"),
                disabled: busy,
              },
              {
                label: "GLB → FBX",
                action: () => startFBXConversion("fbx"),
                disabled: busy,
              },
              {
                label: tr("Import GLB / OBJ / STL / STEP", "导入 GLB / OBJ / STL / STEP"),
                action: () => modelInput.current?.click(),
                disabled: busy,
              },
              {
                label: tr("Sample project", "示例项目"),
                action: () => void openExample(),
                disabled: busy,
              },
              {
                label: tr("Dimensions example", "尺寸示例"),
                action: () => void openExample(true),
                disabled: busy,
              },
              {
                label: tr("Geometry example", "几何体示例"),
                action: () => void openGeometryExample(),
                disabled: busy,
              },
              {
                label: tr("Model hierarchy example", "模型结构示例"),
                action: () => void importModelExample(),
                disabled: busy,
              },
              {
                label: tr("Lights and cameras example", "灯光与相机示例"),
                action: () => void openSceneObjectsExample(),
                disabled: busy,
              },
            ]}
          />
          <Menu
            label={tr("Edit", "编辑")}
            items={[
              {
                label: tr("Undo", "撤销"),
                action: () => {
                  history.undo();
                  refresh();
                },
                disabled: busy || !history.canUndo,
                shortcut: "⌘ / Ctrl Z",
              },
              {
                label: tr("Redo", "重做"),
                action: () => {
                  history.redo();
                  refresh();
                },
                disabled: busy || !history.canRedo,
                shortcut: "⇧ ⌘ / Ctrl Z",
              },
              {
                label: tr("Duplicate", "复制"),
                action: () => treeCommand("duplicate"),
                disabled: busy || !selections.length,
                shortcut: "⌘ / Ctrl D",
              },
              {
                label: tr("Delete", "删除"),
                action: () => treeCommand("delete"),
                disabled: busy || !selections.length,
                shortcut: "Delete",
              },
              {
                label: tr("Group", "分组"),
                action: () => treeCommand("group"),
                disabled: busy || !selections.length,
              },
              {
                label: tr("Ungroup", "解组"),
                action: () => treeCommand("ungroup"),
                disabled: busy || !selections.length,
              },
            ]}
          />
          <Menu
            label={tr("Add", "添加")}
            items={[
              { label: tr("Empty node", "空节点"), action: addEmpty, disabled: busy },
              ...Object.entries(primitives).map(([type, p]) => ({
                label: p.name,
                action: () => addPrimitive(type as PrimitiveType),
                disabled: busy,
              })),
              {
                label: tr("Directional light", "方向光"),
                action: () => addSceneObject("light"),
                disabled: busy,
              },
              {
                label: tr("Point light", "点光"),
                action: () => addSceneObject("light", "point"),
                disabled: busy,
              },
              {
                label: tr("Spotlight", "聚光"),
                action: () => addSceneObject("light", "spot"),
                disabled: busy,
              },
              {
                label: tr("Camera", "相机"),
                action: () => addSceneObject("camera"),
                disabled: busy,
              },
              {
                label: tr("Model…", "模型…"),
                action: () => modelInput.current?.click(),
                disabled: busy,
              },
            ]}
          />
          <Menu
            label={tr("View", "视图")}
            items={[
              {
                label:
                  transformSpace === "local" ? tr("Switch to world space", "切换世界坐标") : tr("Switch to local space", "切换局部坐标"),
                shortcut: "X",
                action: () =>
                  changeTransformSpace(
                    transformSpace === "local" ? "world" : "local",
                  ),
              },
              {
                label: mainPreview ? tr("Return to editor view", "返回编辑视角") : tr("Preview main camera", "预览主相机"),
                action: toggleMainPreview,
                disabled: !primaryCamera(scene),
              },
              {
                label: tr("Frame selection", "聚焦选中"),
                action: () => frameSelection(),
                disabled: busy,
                shortcut: "F",
              },
              {
                label: tr("Frame all", "显示全景"),
                action: () => frameSelection(true),
                disabled: busy,
                shortcut: "Shift F",
              },
              {
                label: camera.orthographic ? tr("Switch to perspective", "切换透视") : tr("Switch to orthographic", "切换正交"),
                action: () =>
                  changeCamera({
                    ...camera,
                    orthographic: !camera.orthographic,
                  }),
                disabled: history.isPreviewing,
                shortcut: "P",
              },
              {
                label: assetsOpen ? tr("Collapse library", "收起资源库") : tr("Expand library", "展开资源库"),
                action: () => setAssetsOpen((v) => !v),
              },
              { label: tr("Lighting settings", "光照设置"), action: openLightSettings },
              {
                label: tr("Reset view", "恢复默认视角"),
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
        <button type="button" aria-pressed={scenePlaying} disabled={!scenePlaying && (busy || !hasBehavior || renderMode !== "raster")} onClick={toggleScenePreview}>
          {scenePlaying ? tr("Stop scene preview", "停止场景预览") : tr("Play scene", "播放场景")}
        </button>
        <span className="document-name">
          {scene.name}
          {dirty ? " *" : ""}
        </span>
        <span className="menu-save-status" title={recoveryStatus}>
          {dirty ? tr("Unsaved", "未保存") : tr("Saved", "已保存")}
        </span>
      </header>
      {recoveries.length > 0 && !recoveryDismissed && (
        <section className="recovery-banner" aria-label={tr("Recover unsaved project", "恢复未保存项目")}>
          <div className="recovery-heading">
            <strong>{tr("Recoverable projects", "可恢复项目")}</strong>
            <button onClick={() => setRecoveryDismissed(true)}>{tr("Later", "稍后")}</button>
          </div>
          {recoveries.map((r) => (
            <span key={r.id}>
              {r.scene.name} · {new Date(r.updated).toLocaleString()}{" "}
              <button onClick={() => void restoreRecovery(r)}>{tr("Recover", "恢复")}</button>
              <button
                onClick={() =>
                  void removeRecovery(r.id)
                    .then(() =>
                      setRecoveries((v) => v.filter((x) => x.id !== r.id)),
                    )
                    .catch((e) => setStatus(String(e)))
                }
              >{tr("Discard copy", "丢弃此副本")}</button>
            </span>
          ))}
        </section>
      )}
      <div className="workspace">
        <main
          className="viewport"
          inert={scenePlaying}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!busy) void importGLB(e.dataTransfer.files[0]);
          }}
        >
          <div className="viewport-bar">
            <div className="viewport-tools" role="toolbar" aria-label={tr("Viewport tools", "视口工具")}>
              {([
                ["select", "pointer", tr("Select", "选择")],
                ["translate", "translate", tr("Move (W)", "移动 (W)")],
                ["rotate", "rotate", tr("Rotate (E)", "旋转 (E)")],
                ["scale", "scale", tr("Scale (R)", "缩放 (R)")],
              ] as const).map(([tool, icon, label]) => (
                <button key={tool} type="button" title={label} aria-label={label}
                  aria-pressed={viewportTool === tool}
                  disabled={busy || mainPreview || history.isPreviewing}
                  onClick={() => setViewportTool(tool)}>
                  <Icon name={icon} />
                </button>
              ))}
              <button className="tool-space" title={tr("Toggle transform space (X)", "切换坐标空间 (X)")}
                disabled={mainPreview || history.isPreviewing}
                onClick={() => changeTransformSpace(transformSpace === "local" ? "world" : "local")}>
                {transformSpace === "local" ? tr("Local", "局部") : tr("World", "世界")}
              </button>
              {selections.length === 1 && node?.light && node.light.type !== "point" && (
                <button aria-pressed={lightAimId === node.id}
                  disabled={busy || history.isPreviewing || mainPreview || inheritedFlag(scene, node.id, "locked")}
                  title={tr("Click a model or the ground to aim the light. Esc cancels.", "点击模型或地面设置光源目标，Esc 取消")}
                  onClick={() => setLightAimId(lightAimId === node.id ? null : node.id)}>{tr("Aim light", "瞄准灯光")}</button>
              )}
              <button title={tr("Viewport settings", "视口设置")} aria-label={tr("Viewport settings", "视口设置")}
                aria-controls="viewport-settings" aria-expanded={viewportSettings}
                onClick={() => setViewportSettings((shown) => !shown)}>
                <Icon name="settings" />
              </button>
            </div>
            <div className="viewport-actions" id="viewport-settings" hidden={!viewportSettings}
              onKeyDown={(event) => { if (event.key === "Escape") setViewportSettings(false); }}>
              <select
                className="projection-switch"
                aria-label={tr("Render mode", "渲染模式")}
                value={renderMode}
                disabled={busy || history.isPreviewing}
                onChange={(e) =>
                  changeRenderMode(e.target.value as RenderMode)
                }
              >
                <option value="raster">{tr("Raster", "光栅")}</option>
                <option value="ray-tracing">{tr("Ray tracing", "光追")}</option>
                <option value="hybrid">Hybrid</option>
              </select>
              {renderMode === "ray-tracing" && (
                <select
                  className="projection-switch"
                  aria-label={tr("Ray tracing integrator", "光追积分器")}
                  value={integrator}
                  disabled={busy || history.isPreviewing}
                  onChange={(e) => changeIntegrator(e.target.value)}
                >
                  <option value="path">PT</option>
                  <option value="bidirectional">BDPT</option>
                  <option value="photon-mapping">Photon mapping</option>
                </select>
              )}
              <button
                className="projection-switch"
                aria-label={tr("Lighting settings", "光照设置")}
                onClick={openLightSettings}
              >{tr("Lighting settings", "光照设置")}</button>
              <button
                className="projection-switch"
                aria-label={activeSceneLight ? tr("Scene lighting", "场景光照") : tr("Studio lighting", "默认光照")}
                aria-pressed={renderMode === "ray-tracing" || lit}
                disabled={busy || renderMode === "ray-tracing"}
                title={tr("Toggle studio lighting to inspect material colors.", "默认摄影棚光照；关闭可查看材质原色")}
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
                {renderMode === "ray-tracing"
                  ? tr("Ray-traced lighting", "光追光照")
                  : lit
                    ? activeSceneLight
                      ? tr("Scene lighting on", "场景光照 · 开")
                      : tr("Studio lighting on", "默认光照 · 开")
                    : tr("Unlit", "材质原色")}
              </button>
              <button
                className="projection-switch"
                disabled={history.isPreviewing}
                title={tr("Toggle perspective / orthographic (P)", "切换透视 / 正交 (P)")}
                aria-label={mainPreview ? tr("Return to editor view", "返回编辑视角") : tr("Toggle projection", "切换投影模式")}
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
                {mainPreview ? tr("Main camera", "主相机") : camera.orthographic ? tr("Orthographic", "正交") : tr("Perspective", "透视")}{" "}{tr("· Live ⇄", "· 实时 ⇄")}</button>
              <label><input type="checkbox" checked={moveSnap}
                onChange={(e) => setMoveSnap(e.target.checked)} />{tr("Move snap (Shift toggles)", "移动吸附（Shift 临时切换）")}</label>
              <div className="viewport-snap">
                <label>
                  <input
                    type="checkbox"
                    checked={gridSnap}
                    onChange={(e) => setGridSnap(e.target.checked)}
                  />{tr("Grid snap", "网格吸附")}</label>
                <select
                  aria-label={tr("Placement grid step", "摆放网格步长")}
                  value={gridStep}
                  onChange={(e) => setGridStep(Number(e.target.value))}
                >
                  {gridSteps.map((step) => (
                    <option key={step} value={step}>
                      {step} m
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <canvas ref={canvas} />
          <Viewport
            resourceDrag={resourceDrag}
            snap={gridSnap}
            moveSnap={moveSnap}
            aimLight={!!lightAimId && selections.length === 1 && lightAimId === node?.id}
            onAimLight={(target) => {
              if (target && lightAimId) edit((draft) => aimLightAt(draft, lightAimId, target));
              setLightAimId(null);
            }}
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
            tool={viewportTool}
            onTool={setViewportTool}
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
          <div
            className="viewport-footer"
            title={tr("Left: select · Middle: pan · Right: orbit · Wheel: zoom", "左键选择 · 中键平移 · 右键环绕 · 滚轮缩放")}
          >
            <span>
              {!scene.nodes.length && !projectBusy
                ? tr("Empty scene", "空场景")
                : busy
                  ? tr("Loading…", "正在加载…")
                  : scene.nodes.length && preview.match(/^\d+ /)
                    ? preview.replace(/(model instances|个模型实例)$/, tr("model instances", "个模型实例"))
                    : preview}
            </span>
            <span>
              {renderMode === "ray-tracing" ? tr("Ray tracing · BVH ·", "光追 · 计算 BVH ·") : renderMode === "hybrid" ? "Hybrid · " : tr("Raster ·", "光栅 ·")}
              {camera.orthographic ? tr("Orthographic", "正交") : tr("Perspective", "透视")}
              <output
                ref={performanceLabel}
                className="viewport-performance"
                aria-label={tr("Viewport performance", "视口性能")}
                aria-live="off"
                title={tr("Frame completion interval, including time between frames.", "编辑器提交的渲染帧完成间隔，毫秒数包含帧间等待")}
              >
                — FPS · — ms
              </output>
            </span>
          </div>
        </main>
        <aside className="sidebar" aria-label={tr("Editor sidebar", "编辑侧栏")} inert={scenePlaying}>
          <div className="sidebar-tabs" role="tablist" aria-label={tr("Sidebar tabs", "侧栏分类")}>
            {(["scene", "project", "settings"] as const).map((tab, i) => (
              <button
                role="tab"
                key={tab}
                aria-selected={sidebarTab === tab}
                aria-controls={`sidebar-${tab}`}
                id={`tab-${tab}`}
                onClick={() => setSidebarTab(tab)}
              >
                {[tr("Scene", "场景"), tr("Project", "项目"), tr("Settings", "设置")][i]}
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
            <section className="scene-panel" aria-label={tr("Scene hierarchy", "场景层级")}>
              <div className="panel-title">{tr("Scene", "场景")}<div className="scene-toolbar" aria-label={tr("Scene actions", "场景操作")}>
                  <button disabled={busy} onClick={addEmpty} title={tr("Add empty node", "新建空节点")} aria-label={tr("Add empty node", "新建空节点")}>
                    <Icon name="plus" />
                  </button>
                  <button disabled={busy || !selections.length} onClick={() => treeCommand("duplicate")}
                    title={tr("Duplicate selection", "复制选中对象")} aria-label={tr("Duplicate selection", "复制选中对象")}><Icon name="duplicate" /></button>
                  <button disabled={busy || !selections.length} onClick={() => treeCommand("delete")}
                    title={tr("Delete selection", "删除选中对象")} aria-label={tr("Delete selection", "删除选中对象")}><Icon name="trash" /></button>
                </div>
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
                    setStatus(tr("Nodes moved with world transforms preserved", "已移动节点，保持世界变换"));
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
                <p className="hint">{tr("Import a model or add an empty node.", "导入模型或创建空节点，开始组织场景。")}</p>
              )}
            </section>
            <section className="inspector" aria-label={tr("Object properties", "对象属性")}>
              <div className="panel-title">{tr("Properties", "属性")}</div>
              <div
                className="inspector-tabs"
                role="tablist"
                aria-label={tr("Inspector tabs", "检查器分类")}
              >
                <button
                  role="tab"
                  aria-selected={inspectorTab === "object"}
                  onClick={() => setInspectorTab("object")}
                >{tr("Object", "对象")}</button>
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
                      {[tr("Geometry", "几何体"), tr("Material", "材质")][i]}
                    </button>
                  ))}
                <button
                  role="tab"
                  aria-selected={inspectorTab === "lighting"}
                  onClick={openLightSettings}
                >{tr("Lighting", "光照")}</button>
                <button
                  role="tab"
                  aria-selected={inspectorTab === "world"}
                  onClick={() => setInspectorTab("world")}
                >{tr("Environment", "环境")}</button>
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
                      ? tr("Select a scene light to edit or enable it.", "当前使用场景灯光；选择灯光节点可独立编辑和启用。")
                      : tr("Studio lighting applies to the editor viewport.", "摄影棚光照仅用于当前视口。")}
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
                  <label className="light-check">
                    <input
                      type="checkbox"
                      checked={halfShadows}
                      disabled={busy || !lit || renderMode !== "raster"}
                      onChange={(e) => changeShadowResolution(e.target.checked)}
                    />{tr("Half-resolution shadows", "半分辨率阴影")}</label>
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
                      ? tr("Submesh material slots", "子网格材质槽")
                      : tr("Model hierarchy", "模型内部节点")}
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
                    <p className="hint">{tr("This node has no submeshes.", "此节点没有子网格。")}</p>
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
                    <p className="notice">{tr("Locked", "已锁定")}</p>
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
                            ? tr("Camera", "相机")
                            : node.light
                              ? {
                                  directional: tr("Directional light", "方向光"),
                                  point: tr("Point light", "点光"),
                                  spot: tr("Spotlight", "聚光"),
                                }[node.light.type]
                              : node.assetId
                                ? tr("Model instance", "模型实例")
                                : tr("Empty node", "空节点")}
                        </small>
                      </div>
                    </div>
                    <label className="field">{tr("Name", "名称")}<NameField
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
                    {behaviorControls()}
                    {animationControls()}
                    {node.assetId && materialVariants.length > 0 && (
                      <label>{tr("Material variants", "材质变体")}<select value={inspectedAsset?.materialVariant ?? -1} onChange={(e) => {
                          const index = Number(e.currentTarget.value), assetId = node.assetId!;
                          edit((draft) => {
                            assertEditable(draft, [node.id]);
                            if (index < 0) delete draft.assets[assetId].materialVariant;
                            else draft.assets[assetId].materialVariant = index;
                          });
                        }}>
                          <option value={-1}>{tr("Default material", "默认材质")}</option>
                          {materialVariants.map((name: string, index: number) => (
                            <option key={index} value={index}>{name}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    <h3>{tr("Transform", "变换")}<span>
                        {transformSpace === "local" ? tr("Local space", "局部坐标") : tr("World space", "世界坐标")}
                      </span>
                    </h3>
                    {node.assetId && assetBounds[node.assetId] && (
                      <p className="asset-dimensions">
                        {scene.assets[node.assetId].sourceSpace
                          ? tr("Source dimensions (m)", "原始尺寸（米）")
                          : tr("Legacy normalized dimensions", "兼容旧项目 · 归一化尺寸")}
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
                        onApply={(component, yaw, pitch, roll) =>
                          edit((s) => {
                            aimObject(s, node.id, yaw, pitch, roll);
                            const n = s.nodes.find((n) => n.id === node.id)!;
                            if (n.camera) {
                              applyCameraLens(
                                s,
                                node.id,
                                component as NonNullable<SceneNode["camera"]>,
                              );
                            } else {
                              n.light = component as NonNullable<
                                SceneNode["light"]
                              >;
                              s.schemaVersion = Math.max(
                                s.schemaVersion,
                                n.light.type !== "directional" &&
                                  n.light.shadows
                                  ? 7
                                  : 6,
                              ) as Scene["schemaVersion"];
                            }
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
                        <div className="transform-row" role="group" aria-label={tr("Rotation (degrees)", "旋转（度）")}>
                          <span>{tr("Rotation °", "旋转 °")}</span>
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
                        </div>
                      </>
                    )}
                    <button
                      disabled={busy || history.isPreviewing || !!resourceDrag}
                      onClick={landSelection}
                      title={tr("Drop the selection and descendants onto the surface below or the ground.", "将选中对象及子树下落到下方模型表面；无支撑时落到地面")}
                    >{tr("Drop to surface", "一键落地")}</button>
                    <button
                      disabled={busy}
                      onClick={() => treeCommand("duplicate")}
                    >
                      <Icon name="duplicate" />{tr("Duplicate instance", "复制实例")}</button>
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() => treeCommand("delete")}
                    >
                      <Icon name="trash" />{tr("Delete node and children", "删除节点及子节点")}</button>
                  </fieldset>
                </div>
              ) : (
                <p className="hint">{tr("Select a scene node to edit its properties.", "选择场景节点，查看并编辑属性。")}</p>
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
            <h3>{tr("Project", "项目")}</h3>
            <strong className="project-title-text">{scene.name}</strong>
            <div className="project-summary">
              <span>{tr("Nodes", "节点")}</span>
              <strong>{scene.nodes.length}</strong>
              <span>{tr("Assets", "资源")}</span>
              <strong>{Object.keys(scene.assets).length}</strong>
            </div>
            <button disabled={busy} onClick={() => void exportProject()}>{tr("Save project", "保存项目")}</button>
            <button disabled={busy} onClick={() => void exportProject(true)}>{tr("Download project archive", "下载项目包")}</button>
            <button
              disabled={busy}
              onClick={() => projectInput.current?.click()}
            >{tr("Open project", "打开项目")}</button>
            <h3>{tr("Assets", "资源")}</h3>
            <button onClick={() => setAssetsOpen((v) => !v)}>
              {assetsOpen ? tr("Collapse library", "收起资源库") : tr("Expand library", "展开资源库")}
            </button>
            <button disabled={busy} onClick={() => modelInput.current?.click()}>{tr("Import model", "导入模型")}</button>
            {recoveries.length > 0 && (
              <button onClick={() => setRecoveryDismissed(false)}>{tr("Recovery copies (", "恢复副本（")}{recoveries.length}）
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
            <label className="setting-row">
              {tr("Language", "语言")}
              <select aria-label={tr("Language", "语言")} value={language}
                onChange={event => setLanguage(event.target.value === "zh" ? "zh" : "en")}>
                <option value="en">English</option>
                <option value="zh">简体中文</option>
              </select>
            </label>
            <h3>{tr("View", "视图")}</h3>
            <label className="setting-row">{tr("Asset library", "资源库")}<input
                type="checkbox"
                checked={assetsOpen}
                onChange={(e) => setAssetsOpen(e.target.checked)}
              />
            </label>
            <label className="setting-row">{tr("Grid snap", "网格吸附")}<input
                type="checkbox"
                checked={gridSnap}
                onChange={(e) => setGridSnap(e.target.checked)}
              />
            </label>
            <label className="setting-row">{tr("Snap step", "吸附步长")}<select
                aria-label={tr("Set snap step", "设置吸附步长")}
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
            <label className="setting-row">{tr("Studio lighting", "默认光照")}<input
                type="checkbox"
                checked={lit}
                disabled={busy}
                onChange={(e) => changeLit(e.target.checked)}
              />
            </label>
            <h3>{tr("Shortcuts", "快捷键")}</h3>
            <dl className="shortcuts">
              <dt>{tr("Move / Rotate / Scale", "移动 / 旋转 / 缩放")}</dt>
              <dd>W / E / R</dd>
              <dt>{tr("Local / World space", "局部 / 世界坐标")}</dt>
              <dd>X</dd>
              <dt>{tr("Frame selection / all", "聚焦 / 全景")}</dt>
              <dd>F / Shift F</dd>
              <dt>{tr("Pan / Projection", "平移 / 投影")}</dt>
              <dd>H / P</dd>
              <dt>{tr("Save", "保存")}</dt>
              <dd>Ctrl / ⌘ S</dd>
              <dt>{tr("Undo / Redo", "撤销 / 重做")}</dt>
              <dd>Ctrl / ⌘ Z / Shift Z</dd>
            </dl>
          </section>
        </aside>
        <section
          className={`assets ${assetsOpen ? "expanded" : "collapsed"}`}
          aria-label={tr("Asset drawer", "资源库抽屉")}
          inert={scenePlaying}
        >
          <div className="panel-title">
            <button
              className="asset-drawer-toggle"
              aria-expanded={assetsOpen}
              aria-controls="asset-drawer-content"
              onClick={() => setAssetsOpen((v) => !v)}
            >
              {assetsOpen ? "▾" : "▸"}{tr("Asset library", "资源库")}{" "}
              <span>{Object.keys(scene.assets).length}</span>
            </button>
            <button disabled={busy} onClick={() => modelInput.current?.click()}>{tr("＋ Import model", "＋ 导入模型")}</button>
          </div>
          <div
            className="asset-list"
            id="asset-drawer-content"
            hidden={!assetsOpen}
          >
            {Object.entries(scene.assets).map(([id, a]) => {
              return (
                <button
                  className={
                    "asset " +
                    (node?.assetId === id ? "selected " : "") +
                    (resourceDrag?.assetId === id ? "dragging" : "")
                  }
                  key={id}
                  title={tr("Drag to place a model, or click to select an instance.", "拖入视口创建实例；单击选择已有实例")}
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
                  <AssetPreview bytes={assetsOpen ? assets.current[a.path] : undefined} />
                  <span className="asset-info">
                    <strong>{resourceName(id)}</strong>
                  </span>
                </button>
              );
            })}
            {!Object.keys(scene.assets).length && (
              <p className="hint">{tr("No models yet", "还没有模型")}</p>
            )}
          </div>
        </section>
      </div>

      <footer>
        <span className="status-dot" />
        {status}
        <span className="spacer" />
        <span>
          {recoveryStatus} · {scene.nodes.length}{tr("nodes", "个节点")}</span>
      </footer>
      <input
        type="file"
        hidden
        ref={(element) => {
          packInput.current = element;
          element?.setAttribute("webkitdirectory", "");
        }}
        onChange={(event) => {
          void convertModel(Array.from(event.currentTarget.files ?? []), true, importGLTFFolder.current);
          event.currentTarget.value = "";
        }}
      />
      <input
        type="file"
        hidden
        ref={(element) => {
          objFolderInput.current = element;
          element?.setAttribute("webkitdirectory", "");
        }}
        onChange={(event) => {
          void openOBJFolder(
            Array.from(event.currentTarget.files ?? []),
            objFolderImport.current,
          );
          event.currentTarget.value = "";
        }}
      />
      <input
        type="file"
        hidden
        ref={fbxInput}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void convertFBXFile(file, fbxTarget.current);
          event.currentTarget.value = "";
        }}
      />
      <input
        type="file"
        hidden
        ref={meshConversionInput}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void convertMeshFile(file, meshConversionTarget.current);
          event.currentTarget.value = "";
        }}
      />
      <input
        type="file"
        accept=".glb,model/gltf-binary"
        hidden
        ref={splitInput}
        onChange={(event) => {
          void convertModel(Array.from(event.currentTarget.files ?? []), false);
          event.currentTarget.value = "";
        }}
      />
      <input
        hidden
        type="file"
        id="model-import"
        accept=".glb,.gltf,.obj,.stl,.step,.stp"
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
