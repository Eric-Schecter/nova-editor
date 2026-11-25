import { tr } from "./language";
import { sceneGlyphs } from "../../../packages/editor-core/src/scene-objects";
import {
  selectionGizmo,
  selectionEdits,
  type SelectionFrame,
  type TransformSpace,
} from "../../../packages/editor-core/src/selection-transform";
import { subtreeIds } from "../../../packages/editor-core/src/hierarchy";
import { inheritedFlag } from "../../../packages/editor-core/src/hierarchy";
import { surfaceQuery } from "../../../packages/editor-core/src/placement";
import { PlacementPreview, type ResourceDrag } from "./PlacementPreview";
import {
  panCamera,
  type AssetBounds,
} from "../../../packages/editor-core/src/navigation";
import { cubeFaces } from "../../../packages/editor-core/src/view-cube";
import React, { useEffect, useRef, useState } from "react";
import type { Scene, Transform } from "../../../packages/scene-schema/index";
import {
  cameraFrame,
  dot,
  gizmoFor,
  hitGizmo,
  beginDrag,
  updateDrag,
  rayAt,
  project,
  type Camera,
  type Mode,
  type Point,
  type Drag,
  type Size,
} from "../../../packages/editor-core/src/viewport";
export type ViewportRenderer = {
  setSceneOutlines: (options: { hoveredId: string; selectedIds: string[] }) => void;
  pickScene: (ray: {
    origin: number[];
    direction: number[];
    includeIds?: string[];
  }) => { id: string; position: number[] } | null;
  setCamera: (camera: Camera) => void;
  drawFrame: () => Promise<unknown>;
};
type Props = {
  scene: Scene;
  resourceDrag: ResourceDrag | null;
  snap: boolean;
  moveSnap: boolean;
  aimLight: boolean;
  onAimLight: (target?: number[]) => void;
  step: number;
  onResourceEnd: (consumed: boolean) => void;
  onPlace: (assetId: string, t: Transform, name: string) => void;
  bounds: AssetBounds;
  onFrame: (all: boolean) => void;
  selection: string | null;
  selections: string[];
  tool: Mode | "select";
  onTool: (tool: Mode | "select") => void;
  space: TransformSpace;
  onSpace: (space: TransformSpace) => void;
  onError: (error: string) => void;
  camera: Camera;
  renderer: React.RefObject<ViewportRenderer | null>;
  ready: boolean;
  readOnly: boolean;
  previewing: boolean;
  onSelect: (id: string | null, additive?: boolean) => void;
  onCamera: (camera: Camera) => void;
  onBegin: () => void;
  onPreview: (edits: Record<string, Transform>) => void;
  onFinish: () => void;
  onCancel: () => void;
  onUndo: (redo: boolean) => void;
};
const colors = ["#f16369", "#7bda93", "#68a8ff"];
export function Viewport(props: Props) {
  const mode = props.tool === "select" ? "translate" : props.tool;
  const [panTool, setPanTool] = useState(false),
    [size, setSize] = useState<Size>({ width: 1, height: 1 }),
    [hot, setHot] = useState<number | null>(null),
    [hoveredId, setHoveredId] = useState<string | null>(null),
    [dragging, setDragging] = useState(false);
  useEffect(() => setPanTool(false), [props.tool]);
  const svg = useRef<SVGSVGElement>(null),
    drag = useRef<
      | (Drag & {
          pointerId: number;
          frame: SelectionFrame;
          base: Scene;
          selectionKey: string;
          space: TransformSpace;
        })
      | null
    >(null),
    orbit = useRef<{
      id: number;
      start: Point;
      camera: Camera;
      pan: boolean;
    } | null>(null),
    latest = useRef(props);
  latest.current = props;
  const selectionKey = props.selections.join("|");
  const selectionGeometry = props.readOnly || props.tool === "select"
    ? null
    : selectionGizmo(
        props.scene,
        props.selections,
        props.selection,
        props.space,
        mode,
        props.camera,
        size,
        props.bounds,
      );
  const touchPoints = useRef(new Map<number, Point>());
  const touchGesture = useRef<{ camera: Camera; start: Point; span: number; tap: boolean } | null>(null);
  function resetTouch(camera: Camera, tap = false) {
    const [a, b] = [...touchPoints.current.values()];
    touchGesture.current = a ? {
      camera,
      start: b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a,
      span: b ? Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)) : 0,
      tap,
    } : null;
  }
  const geometry = selectionGeometry?.gizmo ?? null;
  const pointer = (e: React.PointerEvent): Point => {
    const r = svg.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  function release(id: number) {
    if (svg.current?.hasPointerCapture(id))
      svg.current.releasePointerCapture(id);
  }
  function cancel() {
    const ids = [...touchPoints.current.keys()];
    touchPoints.current.clear();
    touchGesture.current = null;
    for (const id of ids) release(id);
    const active = drag.current;
    drag.current = null;
    orbit.current = null;
    if (active) {
      latest.current.onCancel();
      release(active.pointerId);
    }
    setDragging(false);
  }
  useEffect(() => {
    const element = svg.current!;
    const observer = new ResizeObserver(() => {
      const r = element.getBoundingClientRect();
      if (
        drag.current &&
        (drag.current.g.size.width !== r.width ||
          drag.current.g.size.height !== r.height)
      )
        cancel();
      setSize({ width: r.width, height: r.height });
      const p = latest.current;
      if (p.renderer.current)
        void p.renderer.current.drawFrame().catch(() => {});
    });
    observer.observe(element);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = latest.current;
      if (p.resourceDrag || p.readOnly) return;
      if (!p.ready || drag.current || orbit.current) return;
      p.onCamera({
        ...p.camera,
        distance: Math.max(
          0.05,
          Math.min(100, p.camera.distance * Math.exp(e.deltaY * 0.001)),
        ),
      });
    };
    const key = (e: KeyboardEvent) => {
      const p = latest.current;
      if (p.resourceDrag || p.readOnly) return;
      if (e.key === "Escape" && p.aimLight) {
        e.preventDefault();
        p.onAimLight();
        return;
      }
      if (e.key === "Escape" && drag.current) {
        e.preventDefault();
        cancel();
        return;
      }
      if (
        ["INPUT", "TEXTAREA", "SELECT"].includes(
          (e.target as HTMLElement)?.tagName,
        )
      )
        return;
      if (
        !e.metaKey &&
        !e.ctrlKey &&
        !drag.current &&
        !orbit.current &&
        (e.key.toLowerCase() === "f" || e.key === "Home")
      ) {
        e.preventDefault();
        p.onFrame(e.shiftKey || e.key === "Home");
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (drag.current) cancel();
        else p.onUndo(e.shiftKey);
        return;
      }
      if (!e.metaKey && !e.ctrlKey && e.key.toLowerCase() === "x") {
        e.preventDefault();
        cancel();
        p.onSpace(p.space === "local" ? "world" : "local");
        return;
      }
      if (!e.metaKey && !e.ctrlKey && !drag.current) {
        if (e.key.toLowerCase() === "p" && !orbit.current) {
          e.preventDefault();
          p.onCamera({ ...p.camera, orthographic: !p.camera.orthographic });
          return;
        }
        if (e.key.toLowerCase() === "h") {
          e.preventDefault();
          setPanTool(true);
          return;
        }
        const next = ({ w: "translate", e: "rotate", r: "scale" } as const)[
          e.key.toLowerCase() as "w"
        ];
        if (next) {
          e.preventDefault();
          p.onTool(next);
          setPanTool(false);
        }
      }
    };
    const blur = () => cancel();
    element.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", key);
    window.addEventListener("blur", blur);
    return () => {
      observer.disconnect();
      element.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", blur);
      if (drag.current) latest.current.onCancel();
    };
  }, []);
  useEffect(() => {
    if (
      drag.current &&
      (drag.current.selectionKey !== selectionKey ||
        drag.current.space !== props.space ||
        !props.previewing)
    )
      cancel();
  }, [selectionKey, props.space, props.previewing]);
  function aimAt(p: Point) {
    if (props.aimLight) {
      const ray = rayAt(p, props.camera, size);
      const includeIds = props.scene.nodes
        .filter(n => n.assetId && !inheritedFlag(props.scene, n.id, "hidden"))
        .map(n => n.id);
      const hit = includeIds.length ? props.renderer.current?.pickScene({ ...ray, includeIds }) : null;
      const t = Math.abs(ray.direction[1]) > 1e-6 ? -ray.origin[1] / ray.direction[1] : -1;
      const target = hit?.position ?? (t > 0 ? ray.origin.map((v, i) => v + t * ray.direction[i]) : null);
      if (target) props.onAimLight(target);
      else props.onError(tr("Click a model surface or the ground.", "请点击模型表面或地面"));
      return true;
    }
    return false;
  }
  function targetAt(p: Point) {
    const selectable = props.scene.nodes
      .filter(
        (n) =>
          n.assetId &&
          !inheritedFlag(props.scene, n.id, "locked") &&
          !inheritedFlag(props.scene, n.id, "hidden"),
      )
      .map((n) => n.id);
    const hit = selectable.length
      ? props.renderer.current?.pickScene({
          ...rayAt(p, props.camera, size),
          includeIds: selectable,
        })
      : null;
    const glyph = sceneGlyphs(props.scene, size.width / size.height)
      .filter((g) => !inheritedFlag(props.scene, g.id, "locked"))
      .map((g) => ({ id: g.id, p: project(g.position, props.camera, size) }))
      .filter((g) => g.p && Math.hypot(g.p.x - p.x, g.p.y - p.y) < 18)
      .sort(
        (a, b) =>
          Math.hypot(a.p!.x - p.x, a.p!.y - p.y) -
          Math.hypot(b.p!.x - p.x, b.p!.y - p.y),
      )[0];
    if (glyph) return glyph.id;
    return hit && props.scene.nodes.some((n) => n.id === hit.id) &&
      project(hit.position, props.camera, size) ? hit.id : null;
  }
  function pickAt(p: Point, additive = false) {
    props.onSelect(targetAt(p), additive);
  }
  const touchCamera = useRef<Camera | null>(null);
  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    setHoveredId(null);
    if (e.pointerType === "touch") {
      if (props.readOnly || props.resourceDrag || !props.ready || drag.current ||
          orbit.current || touchPoints.current.size >= 2) return;
      e.preventDefault();
      touchPoints.current.set(e.pointerId, pointer(e));
      if (touchPoints.current.size === 1) touchCamera.current = props.camera;
      resetTouch(touchCamera.current ?? props.camera, touchPoints.current.size === 1);
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (
      props.readOnly ||
      props.resourceDrag ||
      !props.ready ||
      drag.current ||
      orbit.current ||
      !e.isPrimary
    )
      return;
    const p = pointer(e);
    e.currentTarget.focus();
    if (
      e.button === 1 ||
      e.button === 2 ||
      (e.button === 0 && (e.altKey || panTool))
    ) {
      e.preventDefault();
      orbit.current = {
        id: e.pointerId,
        start: p,
        camera: { ...props.camera },
        pan: panTool || e.button === 1 || (e.button === 2 && e.shiftKey),
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    if (aimAt(p)) return;
    const hit = geometry ? hitGizmo(geometry, p) : null;
    if (hit !== null && geometry) {
      const next = beginDrag(geometry, hit, p);
      if (next) {
        props.onBegin();
        drag.current = {
          ...next,
          pointerId: e.pointerId,
          frame: selectionGeometry!.frame,
          base: structuredClone(props.scene),
          selectionKey,
          space: props.space,
        };
        setDragging(true);
        e.currentTarget.setPointerCapture(e.pointerId);
      }
    } else {
      pickAt(p, e.ctrlKey || e.metaKey || e.shiftKey);
    }
  };
  const dragTransform = (active: Drag, p: Point, shift: boolean) =>
    updateDrag(active, p, active.g.mode === "translate" ? props.moveSnap !== shift : shift,
      props.step, props.space === "world");
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = pointer(e);
    if (touchPoints.current.has(e.pointerId)) {
      const gesture = touchGesture.current;
      touchPoints.current.set(e.pointerId, p);
      if (!gesture) return;
      const [a, b] = [...touchPoints.current.values()];
      const center = b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a;
      const dx = center.x - gesture.start.x, dy = center.y - gesture.start.y;
      const camera = gesture.camera;
      if (gesture.tap && Math.hypot(dx, dy) < 7) return;
      gesture.tap = false;
      if (b) {
        const span = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
        const ratio = gesture.span / span;
        const zoomed = {
          ...camera,
          distance: Math.max(.05, Math.min(100, camera.distance * ratio)),
        };
        touchCamera.current = panCamera(zoomed, dx, dy, size);
      } else {
        touchCamera.current = {
          ...camera,
          yaw: (((camera.yaw - dx * .35 + 180) % 360 + 360) % 360) - 180,
          pitch: Math.max(-90, Math.min(90, camera.pitch + dy * .35)),
        };
      }
      props.onCamera(touchCamera.current);
      return;
    }
    if (orbit.current?.id === e.pointerId) {
      const o = orbit.current;
      if (o.pan) {
        props.onCamera(
          panCamera(o.camera, p.x - o.start.x, p.y - o.start.y, size),
        );
        return;
      }
      props.onCamera({
        ...o.camera,
        yaw:
          ((((o.camera.yaw - (p.x - o.start.x) * 0.35 + 180) % 360) + 360) %
            360) -
          180,
        pitch: Math.max(
          -90,
          Math.min(90, o.camera.pitch + (p.y - o.start.y) * 0.35),
        ),
      });
      return;
    }
    if (drag.current?.pointerId === e.pointerId) {
      try {
        props.onPreview(
          selectionEdits(
            drag.current.base,
            drag.current.frame,
            dragTransform(drag.current, p, e.shiftKey),
          ),
        );
      } catch (error) {
        cancel();
        props.onError(String(error));
      }
      return;
    }
    const handle = geometry ? hitGizmo(geometry, p) : null;
    setHot(handle);
    setHoveredId(
      handle === null && !e.buttons && !e.altKey && e.pointerType !== "touch" &&
        props.ready && !props.resourceDrag && !props.readOnly && !props.aimLight && !panTool
        ? targetAt(p) : null,
    );
  };
  const up = (e: React.PointerEvent<SVGSVGElement>) => {
    if (touchPoints.current.has(e.pointerId)) {
      const gesture = touchGesture.current;
      const point = pointer(e);
      const tap = gesture?.tap && Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) < 7;
      touchPoints.current.delete(e.pointerId);
      resetTouch(touchCamera.current ?? props.camera);
      release(e.pointerId);
      if (tap && !aimAt(point)) pickAt(point);
      return;
    }
    if (orbit.current?.id === e.pointerId) {
      orbit.current = null;
      release(e.pointerId);
    }
    if (drag.current?.pointerId === e.pointerId) {
      const active = drag.current;
      try {
        props.onPreview(
          selectionEdits(
            active.base,
            active.frame,
            dragTransform(active, pointer(e), e.shiftKey),
          ),
        );
      } catch (error) {
        cancel();
        props.onError(String(error));
        return;
      }
      drag.current = null;
      props.onFinish();
      setDragging(false);
      release(e.pointerId);
    }
  };
  const hover = props.readOnly || props.resourceDrag || props.aimLight || panTool
    ? null : hoveredId;
  const { scene, selections, ready, readOnly, renderer, onError } = props;
  useEffect(() => {
    if (!renderer.current || (!ready && !readOnly)) return;
    const selected = readOnly ? new Set<string>() : subtreeIds(scene, selections);
    const visible = scene.nodes.filter((node) =>
      node.assetId && (node.id === hover || selected.has(node.id)) &&
      !inheritedFlag(scene, node.id, "hidden"),
    );
    try {
      renderer.current.setSceneOutlines({
        hoveredId: hover && !selected.has(hover) && visible.some((node) => node.id === hover) ? hover : "",
        selectedIds: visible.filter((node) => selected.has(node.id)).map((node) => node.id),
      });
    } catch (error) {
      onError(String(error));
    }
  }, [scene, selections, hover, ready, readOnly, renderer, onError]);
  const path = (points: Point[]) =>
    points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  return (
    <>
      <svg
        ref={svg}
        className="gizmo-surface"
        tabIndex={0}
        aria-label={tr("Scene viewport", "场景交互视口")}
        viewBox={`0 0 ${size.width} ${size.height}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancel}
        onLostPointerCapture={(e) => {
          if (touchPoints.current.has(e.pointerId)) cancel();
          if (drag.current) cancel();
          orbit.current = null;
        }}
        onPointerLeave={() => {
          if (!drag.current) setHot(null);
          setHoveredId(null);
        }}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          cursor: props.aimLight ? "crosshair" : panTool
            ? "grab"
            : dragging || hot !== null
              ? "move"
              : orbit.current
                ? "grabbing"
                : "default",
        }}
      >
        {!props.readOnly &&
          sceneGlyphs(props.scene, size.width / size.height).map((g) => {
            const selected = props.selections.includes(g.id);
            const showRange = selected || (hover === g.id &&
              (g.lightType === "spot" || g.lightType === "point"));
            const p = project(g.position, props.camera, size),
              color = selected
                ? "#f0c55a"
                : hover === g.id ? "#85eaff"
                : g.type === "camera"
                  ? "#9ed5ff"
                  : "#ffcf58";
            return (
              <g
                key={g.id}
                data-testid={`scene-object-${g.id}`}
                pointerEvents="none"
                stroke={color}
                fill="none"
              >
                {showRange && g.lines.map(([a, b], k) => {
                  const x = project(a, props.camera, size),
                    y = project(b, props.camera, size);
                  return x && y ? (
                    <path key={k} d={path([x, y])} strokeWidth={selected ? 2.5 : 1.8}
                      opacity={selected ? 1 : 0.9} />
                  ) : null;
                })}
                {p && (
                  <>
                    {g.type === "camera" ? (
                      <path data-camera-icon="" transform={`translate(${p.x} ${p.y}) scale(1.65)`}
                        d="M-8 -5H3V5H-8Z M3 -2L8 -5V5L3 2Z"
                        strokeWidth={1.5} strokeLinejoin="round" />
                    ) : (
                      <g data-light-icon={g.lightType} transform={`translate(${p.x} ${p.y}) scale(1.65)`}
                        strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                        {g.lightType === "spot" ? (
                          <path d="M-6 -5H0L5 -8V5L0 2H-6Z M2 7L5 9 M7 0H9" />
                        ) : g.lightType === "rectangle" ? (
                          <path d="M-7 -5H7V5H-7Z M-4 -2H4V2H-4Z" />
                        ) : g.lightType === "point" ? (
                          <path d="M-3 3C-9 -4 -2 -9 2 -7C7 -5 6 -1 3 3V7H-3Z M-2 9H2" />
                        ) : (
                          <><circle r={3.5} /><path d="M0 -8V-6 M0 6V8 M-8 0H-6 M6 0H8 M-6 -6L-4 -4 M6 6L4 4 M-6 6L-4 4 M6 -6L4 -4" /></>
                        )}
                      </g>
                    )}
                    {(selected || g.type === "camera") && <text
                      x={p.x + 19}
                      y={p.y - 8}
                      fill={color}
                      stroke="#25292e" strokeWidth={2.5} paintOrder="stroke"
                      fontSize="12"
                    >
                      {g.name}
                      {g.active && g.type === "camera" ? tr(" · Main", " · 主") : ""}
                    </text>}
                  </>
                )}
              </g>
            );
          })}
        {geometry && (
          <g pointerEvents="none">
            {geometry.lines.map((line) => {
              const active =
                  drag.current?.axis === line.axis ||
                  (!drag.current && hot === line.axis),
                color = active ? "#ffe175" : colors[line.axis],
                end = line.points.at(-1);
              return (
                <g key={line.axis} data-testid={`gizmo-${"xyz"[line.axis]}`}>
                  <path
                    d={path(line.points)}
                    fill="none"
                    stroke="#0f1217"
                    strokeWidth="6"
                  />
                  <path
                    d={path(line.points)}
                    fill="none"
                    stroke={color}
                    strokeWidth={active ? 3.5 : 2.5}
                  />
                  {end &&
                    mode !== "rotate" &&
                    Math.hypot(
                      end.x - geometry.pivot.x,
                      end.y - geometry.pivot.y,
                    ) > 18 &&
                    (mode === "scale" ? (
                      <rect
                        x={end.x - 5}
                        y={end.y - 5}
                        width={10}
                        height={10}
                        fill={color}
                      />
                    ) : (
                      <circle cx={end.x} cy={end.y} r={5} fill={color} />
                    ))}
                  {end && (
                    <text
                      x={end.x + 7}
                      y={end.y - 8}
                      fill={color}
                      fontSize="12"
                      fontWeight="600"
                    >
                      {"XYZ"[line.axis]}
                    </text>
                  )}
                </g>
              );
            })}
            {mode !== "rotate" &&
              (mode === "scale" ? (
                <rect
                  x={geometry.pivot.x - 5}
                  y={geometry.pivot.y - 5}
                  width={10}
                  height={10}
                  fill="#e9eef6"
                />
              ) : (
                <circle
                  cx={geometry.pivot.x}
                  cy={geometry.pivot.y}
                  r={5}
                  fill="#e9eef6"
                />
              ))}
          </g>
        )}
      </svg>
      <PlacementPreview
        drag={props.resourceDrag}
        scene={props.scene}
        query={surfaceQuery(
          props.scene,
          (ray) => props.renderer.current?.pickScene(ray) ?? null,
        )}
        viewport={svg}
        camera={props.camera}
        size={size}
        bounds={props.bounds}
        snap={props.snap}
        step={props.step}
        onPlace={props.onPlace}
        onEnd={props.onResourceEnd}
      />
      <svg
        className="world-tripod"
        viewBox="0 0 100 90"
        aria-label={tr("World axes X Y Z", "世界坐标系 X Y Z")}
      >
        {[0, 1, 2].map((k) => {
          const a = [0, 0, 0];
          a[k] = 1;
          const f = cameraFrame(props.camera),
            x = 43 + dot(a, f.right) * 27,
            y = 47 - dot(a, f.up) * 27;
          return (
            <g key={k}>
              <line
                x1="43"
                y1="47"
                x2={x}
                y2={y}
                stroke={["#be414d", "#2b8b48", "#3568c8"][k]}
                strokeWidth="2"
              />
              <text
                x={x + 3}
                y={y + 4}
                fill={["#be414d", "#2b8b48", "#3568c8"][k]}
                fontSize="11"
              >
                {"XYZ"[k]}
              </text>
            </g>
          );
        })}
        <circle cx="43" cy="47" r="3" fill="#6e7a8b" />
      </svg>
      <div
        className="view-cube"
        aria-label={tr("View cube", "视图立方体")}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <svg viewBox="0 0 120 84" aria-label={tr("Camera orientation", "相机朝向")}>
          {cubeFaces(props.camera).map((face) => (
            <g
              key={face.title}
              role="button"
              tabIndex={dragging || props.readOnly ? -1 : 0}
              aria-label={tr((face.sign > 0 ? ["Right", "Top", "Front"] : ["Left", "Bottom", "Back"])[face.axis], face.title)}
              onClick={() => {
                if (!dragging && !props.readOnly)
                  props.onCamera({
                    ...props.camera,
                    yaw: face.yaw,
                    pitch: face.pitch,
                    orthographic: true,
                  });
              }}
              onKeyDown={(e) => {
                if (
                  !dragging &&
                  !props.readOnly &&
                  (e.key === "Enter" || e.key === " ")
                ) {
                  e.preventDefault();
                  props.onCamera({
                    ...props.camera,
                    yaw: face.yaw,
                    pitch: face.pitch,
                    orthographic: true,
                  });
                }
              }}
            >
              <polygon
                points={face.points.map((p) => `${p.x},${p.y}`).join(" ")}
                fill={["#2a2c30", "#474a50", "#36393f"][face.axis]}
              />
              <text x={face.center.x} y={face.center.y + 4} textAnchor="middle">
                {tr((face.sign > 0 ? ["R", "T", "F"] : ["L", "B", "B"])[face.axis], face.label)}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </>
  );
}
