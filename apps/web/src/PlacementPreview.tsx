import { tr } from "./language";
import React, { useEffect, useRef, useState } from "react";
import type { Transform } from "../../../packages/scene-schema/index";
import { localMatrix } from "../../../packages/scene-schema/transforms";
import {
  boundsCorners,
  type AssetBounds,
} from "../../../packages/editor-core/src/navigation";
import {
  placementAt,
  type SurfaceQuery,
} from "../../../packages/editor-core/src/placement";
import {
  project,
  transform,
  type Camera,
  type Size,
  type Point,
} from "../../../packages/editor-core/src/viewport";
export type ResourceDrag = {
  assetId: string;
  name: string;
  pointerId: number;
  startX: number;
  startY: number;
  source: HTMLElement;
};
type Props = {
  drag: ResourceDrag | null;
  scene: import("../../../packages/scene-schema/index").Scene;
  query: SurfaceQuery;
  viewport: React.RefObject<SVGSVGElement | null>;
  camera: Camera;
  size: Size;
  bounds: AssetBounds;
  snap: boolean;
  step: number;
  onPlace: (assetId: string, t: Transform, name: string) => void;
  onEnd: (consumed: boolean) => void;
};
export function PlacementPreview(props: Props) {
  const latest = useRef(props);
  latest.current = props;
  const [preview, setPreview] = useState<{
    t: Transform | null;
    inside: boolean;
    snapped: boolean;
  } | null>(null);
  useEffect(() => {
    const drag = props.drag;
    if (!drag) {
      setPreview(null);
      return;
    }
    let moved = false,
      ended = false;
    function locate(e: PointerEvent) {
      const p = latest.current,
        r = p.viewport.current!.getBoundingClientRect(),
        point = { x: e.clientX - r.left, y: e.clientY - r.top },
        inside =
          point.x >= 0 &&
          point.y >= 0 &&
          point.x < r.width &&
          point.y < r.height;
      // Reserve orientation and navigation controls; drops only target the canvas surface.
      const control = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest(
          ".view-cube,.placement-controls",
        );
      const b = p.bounds[drag!.assetId],
        snapped = p.snap !== e.shiftKey;
      return {
        inside: inside && !control,
        t:
          inside && !control && b
            ? placementAt(
                point,
                p.camera,
                { width: r.width, height: r.height },
                b,
                snapped,
                p.step,
                { scene: p.scene, assets: p.bounds, query: p.query },
              )
            : null,
        snapped,
      };
    }
    function finish(consumed: boolean) {
      if (ended) return;
      ended = true;
      setPreview(null);
      if (drag!.source.hasPointerCapture(drag!.pointerId))
        drag!.source.releasePointerCapture(drag!.pointerId);
      latest.current.onEnd(consumed);
    }
    const move = (e: PointerEvent) => {
      if (ended || e.pointerId !== drag.pointerId) return;
      if (
        !moved &&
        Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 5
      )
        return;
      moved = true;
      e.preventDefault();
      setPreview(locate(e));
    };
    const up = (e: PointerEvent) => {
      if (ended || e.pointerId !== drag.pointerId) return;
      const drop = moved ? locate(e) : null;
      if (drop?.t) latest.current.onPlace(drag.assetId, drop.t, drag.name);
      finish(moved);
    };
    const cancel = () => finish(true),
      key = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    return () => {
      ended = true;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
      if (drag.source.hasPointerCapture(drag.pointerId))
        drag.source.releasePointerCapture(drag.pointerId);
    };
  }, [props.drag]);
  if (!props.drag || !preview?.inside) return null;
  const b = props.bounds[props.drag.assetId],
    t = preview.t,
    edges: Point[][] = [],
    foot: Point[] = [];
  if (t && b) {
    const m = localMatrix(t),
      points = boundsCorners(b).map((p) =>
        project(transform(m, p), props.camera, props.size),
      );
    for (let i = 0; i < 8; i++)
      for (let k = 0; k < 3; k++)
        if (!(i & (1 << k)) && points[i] && points[i | (1 << k)])
          edges.push([points[i]!, points[i | (1 << k)]!]);
    for (const bits of [0, 1, 5, 4]) {
      const p = project(
        transform(m, boundsCorners(b)[bits]),
        props.camera,
        props.size,
      );
      if (p) foot.push(p);
    }
  }
  return (
    <>
      <svg
        className="placement-preview"
        viewBox={`0 0 ${props.size.width} ${props.size.height}`}
        aria-label={tr("Placement preview", "实例落点预览")}
      >
        {foot.length === 4 && (
          <polygon
            points={foot.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="#bfe9d326"
            stroke="#bfe9d3"
            strokeWidth="2"
          />
        )}
        {edges.map((p, i) => (
          <path
            key={i}
            d={`M${p[0].x},${p[0].y}L${p[1].x},${p[1].y}`}
            fill="none"
            stroke="#bfe9d3"
            strokeWidth="2"
            strokeDasharray="6 4"
          />
        ))}
      </svg>
      <div className={`placement-hint ${t ? "" : "invalid"}`} role="status">
        {t
          ? `${props.drag.name} · ${t.position.map((v) => v.toFixed(2)).join(", ")} · ${preview.snapped ? `吸附 ${props.step} m` : tr("Free placement", "自由摆放")} · 松手创建`
          : tr("No model or ground hit. Adjust the view.", "未命中模型或地面，请调整视角")}
        <small>{tr("Model or ground · Esc cancels · Shift toggles snap", "模型表面 / 地面支撑 · Esc 取消 · Shift 临时切换吸附")}</small>
      </div>
    </>
  );
}
