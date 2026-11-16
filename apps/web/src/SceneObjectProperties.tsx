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
  ) => void;
  onPrimary: (enabled: boolean) => void;
  onCapture: () => void;
  onPreview: () => void;
}) {
  const aim = localAim(node),
    [yaw, setYaw] = useState(aim.yaw),
    [pitch, setPitch] = useState(aim.pitch),
    [component, setComponent] = useState<CameraComponent | LightComponent>(
      structuredClone((node.camera ?? node.light)!),
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
  ) => (
    <label className="asset-property-field">
      {label}
      <input
        aria-label={label}
        type="number"
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
      <h3>{node.camera ? "场景相机" : "方向光"}</h3>
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
          <small>固定视场角 45° · 无滚转 · 裁剪 0.01–200</small>
        </>
      ) : (
        <>
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
          {number("节点阴影柔和度", "softness", 0, 4)}
          <small>当前 SDK 同时使用一个方向光；摄影棚环境补光保留。</small>
        </>
      )}
      <button onClick={() => onApply(component, yaw, pitch)}>
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
          {node.light!.active ? "改用默认摄影棚" : "设为场景光源"}
        </button>
      )}
    </fieldset>
  );
}
