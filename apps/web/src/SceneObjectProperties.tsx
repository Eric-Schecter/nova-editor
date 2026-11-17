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
      <h3>{node.camera ? "场景相机" : "灯光"}</h3>
      <label className="asset-property-field">
        局部方位角
        <input
          aria-label="节点方位角"
          type="number"
          min={-180}
          max={180}
          value={Number(yaw.toFixed(4))}
          onChange={(e) => setYaw(Number(e.target.value))}
        />
      </label>
      <label className="asset-property-field">
        局部俯仰角
        <input
          aria-label="节点俯仰角"
          type="number"
          min={-90}
          max={90}
          value={Number(pitch.toFixed(4))}
          onChange={(e) => setPitch(Number(e.target.value))}
        />
      </label>
      {node.camera ? (
        <>
          <label className="asset-property-field">
            投影
            <select
              aria-label="相机投影"
              value={(component as CameraComponent).projection}
              onChange={(e) => change("projection", e.target.value)}
            >
              <option value="perspective">透视</option>
              <option value="orthographic">正交</option>
            </select>
          </label>
          {(component as CameraComponent).projection === "orthographic"
            ? number("正交视野高度", "orthographicSize", 0.05, 80)
            : number("目标距离", "focusDistance", 0.05, 100)}
          {number("相机曝光", "exposure", 0.01, 16)}
          {number("垂直视场角 FOV", "verticalFov", 1, 179, 1)}
          {number("近裁剪面", "nearPlane", 0.0001, 1e6, 0.01)}
          {number("远裁剪面", "farPlane", 0.0002, 1e7, 1)}
          <label className="asset-property-field">
            局部滚转角
            <input
              aria-label="相机滚转角"
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
          <label className="asset-property-field">
            类型
            <select
              aria-label="灯光类型"
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
              <option value="directional">方向光</option>
              <option value="point">点光</option>
              <option value="spot">聚光</option>
            </select>
          </label>
          {(component as LightComponent).type !== "directional" &&
            number("灯光范围（0 为无限）", "range", 0, 1e7)}
          {(component as LightComponent).type === "spot" &&
            ["innerConeAngle", "outerConeAngle"].map((field, i) => (
              <label key={field} className="asset-property-field">
                {i ? "外锥半角（度）" : "内锥半角（度）"}
                <input
                  aria-label={i ? "外锥半角" : "内锥半角"}
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
          <label className="asset-property-field">
            颜色
            <input
              aria-label="节点灯光颜色"
              value={hex}
              maxLength={7}
              onChange={(e) => {
                setHex(e.target.value);
                if (/^#[0-9a-f]{6}$/i.test(e.target.value))
                  change("color", linearColor(e.target.value));
              }}
            />
          </label>
          {number("节点灯光强度", "intensity", 0, 100)}
          <label>
            <input
              aria-label="节点阴影开关"
              type="checkbox"
              checked={(component as LightComponent).shadows}
              onChange={(e) => change("shadows", e.target.checked)}
            />{" "}
            阴影
          </label>
          {number("节点阴影柔和度", "softness", 0, 4, 0.1, false)}
          <small>
            三类灯均支持逐灯阴影。点光和聚光柔和度使用世界单位光源圆盘；仅静态不透明场景。
          </small>
        </>
      )}
      <button onClick={() => onApply(component, yaw, pitch, roll)}>
        应用节点设置
      </button>
      {node.camera ? (
        <>
          <p className="compact-status">
            {node.camera.primary ? "当前主相机" : "非主相机"}
          </p>
          <button onClick={() => onPrimary(!node.camera!.primary)}>
            {node.camera.primary ? "取消主相机" : "设为主相机"}
          </button>
          <button onClick={onCapture} disabled={disabled || viewing}>
            从编辑视角更新相机
          </button>
          <button
            onClick={onPreview}
            disabled={disabled || !node.camera.primary}
          >
            {viewing ? "返回编辑视角" : "预览主相机"}
          </button>
          {notice && (
            <p role="alert" className="notice">
              {notice}
            </p>
          )}
        </>
      ) : (
        <button onClick={() => onPrimary(!node.light!.active)}>
          {node.light!.active ? "关闭灯光" : "启用灯光"}
        </button>
      )}
    </fieldset>
  );
}
