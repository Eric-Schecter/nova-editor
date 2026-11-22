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
import { worldMatrices } from "../../../packages/scene-schema/transforms";
import {
  cameraFrame,
  dot,
  gizmoFor,
  hitGizmo,
  beginDrag,
  updateDrag,
  rayAt,
  project,
  transform,
  type Camera,
  type Mode,
  type Point,
  type Drag,
  type Size,
} from "../../../packages/editor-core/src/viewport";
export type ViewportRenderer = {
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
  const down = (e: React.PointerEvent<SVGSVGElement>) => {
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
      return;
    }
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
        .filter((g) => g.p && Math.hypot(g.p.x - p.x, g.p.y - p.y) < 12)
        .sort(
          (a, b) =>
            Math.hypot(a.p!.x - p.x, a.p!.y - p.y) -
            Math.hypot(b.p!.x - p.x, b.p!.y - p.y),
        )[0];
      if (glyph) {
        props.onSelect(glyph.id, e.ctrlKey || e.metaKey || e.shiftKey);
        return;
      }
      props.onSelect(
        hit &&
          props.scene.nodes.some((n) => n.id === hit.id) &&
          project(hit.position, props.camera, size)
          ? hit.id
          : null,
        e.ctrlKey || e.metaKey || e.shiftKey,
      );
    }
  };
  const dragTransform = (active: Drag, p: Point, shift: boolean) =>
    updateDrag(active, p, active.g.mode === "translate" ? props.moveSnap !== shift : shift,
      props.step, props.space === "world");
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = pointer(e);
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
    setHot(geometry ? hitGizmo(geometry, p) : null);
  };
  const up = (e: React.PointerEvent<SVGSVGElement>) => {
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
  const box: Point[][] = [];
  const outlined = subtreeIds(props.scene, props.selections),
    worlds = worldMatrices(props.scene);
  for (const selected of props.scene.nodes)
    if (
      outlined.has(selected.id) &&
      selected.assetId &&
      !inheritedFlag(props.scene, selected.id, "hidden")
    ) {
      const matrix = worlds.get(selected.id)!;
      for (let bits = 0; bits < 8; bits++)
        for (let k = 0; k < 3; k++)
          if (!(bits & (1 << k))) {
            const bounds = props.bounds[selected.assetId];
            if (!bounds) continue;
            const a = [0, 1, 2].map(
                (k) => (bits & (1 << k) ? bounds.maximum : bounds.minimum)[k],
              ),
              b = [...a];
            b[k] = bounds.maximum[k];
            const p = project(transform(matrix, a), props.camera, size),
              q = project(transform(matrix, b), props.camera, size);
            if (p && q) box.push([p, q]);
          }
    }
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
        onLostPointerCapture={() => {
          if (drag.current) cancel();
          orbit.current = null;
        }}
        onPointerLeave={() => {
          if (!drag.current) setHot(null);
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
        <g
          fill="none"
          stroke="#7bb6ee"
          strokeWidth="1.2"
          opacity=".65"
          pointerEvents="none"
        >
          {box.map((points, i) => (
            <path key={i} d={path(points)} />
          ))}
        </g>
        {!props.readOnly &&
          sceneGlyphs(props.scene, size.width / size.height).map((g) => {
            const selected = props.selections.includes(g.id);
            const p = project(g.position, props.camera, size),
              color = selected
                ? "#f0c55a"
                : g.type === "camera"
                  ? "#6396d5"
                  : "#b79c52";
            return (
              <g
                key={g.id}
                data-testid={`scene-object-${g.id}`}
                pointerEvents="none"
                stroke={color}
                fill="none"
              >
                {selected && g.lines.map(([a, b], k) => {
                  const x = project(a, props.camera, size),
                    y = project(b, props.camera, size);
                  return x && y ? (
                    <path key={k} d={path([x, y])} strokeWidth={1.5} />
                  ) : null;
                })}
                {p && (
                  <>
                    <circle cx={p.x} cy={p.y} r={selected ? 5 : 3} fill={color} />
                    {selected && <text
                      x={p.x + 10}
                      y={p.y - 8}
                      fill={color}
                      stroke="none"
                      fontSize="12"
                    >
                      {g.type === "camera" ? tr("Camera", "相机") : tr("Light", "灯光")}
                      {g.active ? tr("· Main", "· 主") : ""}
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
