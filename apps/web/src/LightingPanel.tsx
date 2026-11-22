import { tr } from "./language";
import React, { useState } from "react";
import type { LightingSettings } from "../../../packages/editor-core/src/lighting";
type Props = {
  value: LightingSettings;
  enabled: boolean;
  busy: boolean;
  onChange: (value: LightingSettings) => void;
  onEnabled: (value: boolean) => void;
  onReset: () => void;
};
export function LightingPanel({
  value,
  enabled,
  busy,
  onChange,
  onEnabled,
  onReset,
}: Props) {
  const [draft, setDraft] = useState(value.color),
    [editing, setEditing] = useState(false);
  function slider(
    key: "azimuth" | "elevation" | "intensity" | "softness",
    label: string,
    min: number,
    max: number,
    step: number,
    unit: string,
  ) {
    return (
      <label className="light-slider">
        <span>
          {label}
          <output>
            {value[key].toFixed(key === "intensity" ? 2 : 1)}
            {unit}
          </output>
        </span>
        <input
          type="range"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={value[key]}
          onChange={(e) =>
            onChange({ ...value, [key]: Number(e.target.value) })
          }
        />
      </label>
    );
  }
  return (
    <div className="lighting-properties">
      <div className="lighting-heading">
        <strong>{tr("Viewport lighting", "视口光照")}</strong>
        <small>{tr("Directional studio light", "方向光 · 摄影棚补光")}</small>
      </div>
      <label className="light-check">
        <input
          type="checkbox"
          aria-label={tr("Enable lighting", "启用光照")}
          checked={enabled}
          disabled={busy}
          onChange={(e) => onEnabled(e.target.checked)}
        />{tr("Enable lighting", "启用光照")}</label>
      <fieldset disabled={!enabled || busy}>
        <legend>{tr("Light source", "光源")}</legend>
        {slider("azimuth", tr("Azimuth", "方位角"), -180, 180, 0.1, "°")}
        {slider("elevation", tr("Elevation", "高度角"), 5, 85, 0.1, "°")}
        <label className="light-color">
          <span>{tr("Color", "颜色")}</span>
          <div>
            <input
              type="color"
              aria-label={tr("Light color", "光照颜色")}
              value={value.color}
              onChange={(e) => onChange({ ...value, color: e.target.value })}
            />
            <input
              type="text"
              aria-label={tr("Light color hex", "光照颜色十六进制")}
              spellCheck={false}
              value={editing ? draft : value.color}
              onFocus={() => {
                setDraft(value.color);
                setEditing(true);
              }}
              onChange={(e) => {
                setDraft(e.target.value);
                if (/^#[0-9a-f]{6}$/i.test(e.target.value))
                  onChange({ ...value, color: e.target.value });
              }}
              onBlur={() => setEditing(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape")
                  e.currentTarget.blur();
              }}
            />
          </div>
        </label>
        {slider("intensity", tr("Light intensity", "光照强度"), 0, 10, 0.05, "")}
      </fieldset>
      <fieldset disabled={!enabled || busy}>
        <legend>{tr("Shadows", "阴影")}</legend>
        <label className="light-check">
          <input
            type="checkbox"
            aria-label={tr("Cast shadows", "投射阴影")}
            checked={value.shadows}
            onChange={(e) => onChange({ ...value, shadows: e.target.checked })}
          />{tr("Cast shadows", "投射阴影")}</label>
        <fieldset className="light-softness" disabled={!value.shadows}>
          {slider("softness", tr("Shadow softness", "阴影柔和程度"), 0, 4, 0.1, "")}
          <div className="light-range-caption">
            <span>{tr("Sharp", "锐利")}</span>
            <span>{tr("Soft", "柔和")}</span>
          </div>
        </fieldset>
      </fieldset>
      <button className="light-reset" disabled={busy} onClick={onReset}>{tr("Reset lighting", "恢复默认光照")}</button>
      <p className="light-note">{tr("Applies to the editor viewport.", "用于当前视口，不写入场景项目。")}</p>
    </div>
  );
}
