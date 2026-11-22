import { tr } from "./language";
import { useState } from "react";
import type {
  SceneNode,
  CameraComponent,
  LightComponent,
} from "../../../packages/scene-schema/index";
import { localAim } from "../../../packages/editor-core/src/scene-objects";
import { linearColor } from "../../../packages/editor-core/src/lighting";
import { colorHex } from "../../../packages/asset-system/index";
export function SceneObjectProperties({
  node,
  disabled,
  viewing,
  notice,
  onApply,
  onPrimary,
  onCapture,
  onPreview,
}: {
  node: SceneNode;
  disabled: boolean;
  viewing: boolean;
  notice: string;
  onApply: (
    component: CameraComponent | LightComponent,
    yaw: number,
    pitch: number,
    roll: number,
  ) => void;
  onPrimary: (enabled: boolean) => void;
  onCapture: () => void;
  onPreview: () => void;
}) {
  const aim = localAim(node),
    [yaw, setYaw] = useState(aim.yaw),
    [pitch, setPitch] = useState(aim.pitch),
    [roll, setRoll] = useState(aim.roll),
    [component, setComponent] = useState<CameraComponent | LightComponent>(
      structuredClone(
        node.camera
          ? {
              ...node.camera,
              verticalFov: node.camera.verticalFov ?? 45,
              nearPlane: node.camera.nearPlane ?? 0.01,
              farPlane: node.camera.farPlane ?? 200,
            }
          : {
              range: 10,
              innerConeAngle: 0.35,
              outerConeAngle: 0.6,
              ...node.light!,
            },
      ),
    ),
    [hex, setHex] = useState(
      node.light ? colorHex(node.light.color) : "#ffffff",
    );
  const change = (key: string, value: unknown) =>
    setComponent((previous) => ({ ...previous, [key]: value }));
  const number = (
    label: string,
    key: string,
    min: number,
    max: number,
    step = 0.1,
    inactive = false,
  ) => (
    <label className="asset-property-field">
      {label}
      <input
        aria-label={label}
        type="number"
        disabled={inactive}
        min={min}
        max={max}
        step={step}
        value={(component as unknown as Record<string, number>)[key]}
        onChange={(e) => change(key, Number(e.target.value))}
      />
    </label>
  );
  return (
    <fieldset className="object-fields" disabled={disabled}>
      <h3>{node.camera ? tr("Scene camera", "场景相机") : tr("Light", "灯光")}</h3>
      <label className="asset-property-field">{tr("Local yaw", "局部方位角")}<input
          aria-label={tr("Node yaw", "节点方位角")}
          type="number"
          min={-180}
          max={180}
          value={Number(yaw.toFixed(4))}
          onChange={(e) => setYaw(Number(e.target.value))}
        />
      </label>
      <label className="asset-property-field">{tr("Local pitch", "局部俯仰角")}<input
          aria-label={tr("Node pitch", "节点俯仰角")}
          type="number"
          min={-90}
          max={90}
          value={Number(pitch.toFixed(4))}
          onChange={(e) => setPitch(Number(e.target.value))}
        />
      </label>
      {node.camera ? (
        <>
          <label className="asset-property-field">{tr("Projection", "投影")}<select
              aria-label={tr("Camera projection", "相机投影")}
              value={(component as CameraComponent).projection}
              onChange={(e) => change("projection", e.target.value)}
            >
              <option value="perspective">{tr("Perspective", "透视")}</option>
              <option value="orthographic">{tr("Orthographic", "正交")}</option>
            </select>
          </label>
          {(component as CameraComponent).projection === "orthographic"
            ? number(tr("Orthographic height", "正交视野高度"), "orthographicSize", 0.05, 80)
            : number(tr("Focus distance", "目标距离"), "focusDistance", 0.05, 100)}
          {number(tr("Camera exposure", "相机曝光"), "exposure", 0.01, 16)}
          {number(tr("Vertical FOV", "垂直视场角 FOV"), "verticalFov", 1, 179, 1)}
          {number(tr("Near clip", "近裁剪面"), "nearPlane", 0.0001, 1e6, 0.01)}
          {number(tr("Far clip", "远裁剪面"), "farPlane", 0.0002, 1e7, 1)}
          <label className="asset-property-field">{tr("Local roll", "局部滚转角")}<input
              aria-label={tr("Camera roll", "相机滚转角")}
              type="number"
              min={-180}
              max={180}
              step={1}
              value={Number(roll.toFixed(4))}
              onChange={(e) => setRoll(Number(e.target.value))}
            />
          </label>
        </>
      ) : (
        <>
          <label className="asset-property-field">{tr("Type", "类型")}<select
              aria-label={tr("Light type", "灯光类型")}
              value={(component as LightComponent).type}
              onChange={(e) =>
                setComponent(
                  (previous) =>
                    ({
                      ...previous,
                      type: e.target.value,
                      shadows: (previous as LightComponent).shadows,
                    }) as LightComponent,
                )
              }
            >
              <option value="directional">{tr("Directional light", "方向光")}</option>
              <option value="point">{tr("Point light", "点光")}</option>
              <option value="spot">{tr("Spotlight", "聚光")}</option>
            </select>
          </label>
          {(component as LightComponent).type !== "directional" &&
            number(tr("Range (0 means unlimited)", "灯光范围（0 为无限）"), "range", 0, 1e7)}
          {(component as LightComponent).type === "spot" &&
            ["innerConeAngle", "outerConeAngle"].map((field, i) => (
              <label key={field} className="asset-property-field">
                {i ? tr("Outer cone (deg)", "外锥半角（度）") : tr("Inner cone (deg)", "内锥半角（度）")}
                <input
                  aria-label={i ? tr("Outer cone", "外锥半角") : tr("Inner cone", "内锥半角")}
                  type="number"
                  min={0}
                  max={89.999}
                  step={1}
                  value={Number(
                    (((component as any)[field] * 180) / Math.PI).toFixed(4),
                  )}
                  onChange={(e) =>
                    change(field, (Number(e.target.value) * Math.PI) / 180)
                  }
                />
              </label>
            ))}
          <label className="asset-property-field">{tr("Color", "颜色")}<input
              aria-label={tr("Light color", "节点灯光颜色")}
              value={hex}
              maxLength={7}
              onChange={(e) => {
                setHex(e.target.value);
                if (/^#[0-9a-f]{6}$/i.test(e.target.value))
                  change("color", linearColor(e.target.value));
              }}
            />
          </label>
          {number(tr("Light intensity", "节点灯光强度"), "intensity", 0, 100)}
          <label>
            <input
              aria-label={tr("Cast shadows", "节点阴影开关")}
              type="checkbox"
              checked={(component as LightComponent).shadows}
              onChange={(e) => change("shadows", e.target.checked)}
            />{" "}{tr("Shadows", "阴影")}</label>
          {number(tr("Shadow softness", "节点阴影柔和度"), "softness", 0, 4, 0.1, false)}
          <small>{tr("Per-light shadows support static opaque scenes. Point and spot softness is in world units.", "三类灯均支持逐灯阴影。点光和聚光柔和度使用世界单位光源圆盘；仅静态不透明场景。")}</small>
        </>
      )}
      <button onClick={() => onApply(component, yaw, pitch, roll)}>{tr("Apply node settings", "应用节点设置")}</button>
      {node.camera ? (
        <>
          <p className="compact-status">
            {node.camera.primary ? tr("Current main camera", "当前主相机") : tr("Secondary camera", "非主相机")}
          </p>
          <button onClick={() => onPrimary(!node.camera!.primary)}>
            {node.camera.primary ? tr("Clear main camera", "取消主相机") : tr("Set as main camera", "设为主相机")}
          </button>
          <button onClick={onCapture} disabled={disabled || viewing}>{tr("Update from editor view", "从编辑视角更新相机")}</button>
          <button
            onClick={onPreview}
            disabled={disabled || !node.camera.primary}
          >
            {viewing ? tr("Return to editor view", "返回编辑视角") : tr("Preview main camera", "预览主相机")}
          </button>
          {notice && (
            <p role="alert" className="notice">
              {notice}
            </p>
          )}
        </>
      ) : (
        <button onClick={() => onPrimary(!node.light!.active)}>
          {node.light!.active ? tr("Disable light", "关闭灯光") : tr("Enable light", "启用灯光")}
        </button>
      )}
    </fieldset>
  );
}
