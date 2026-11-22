import { tr } from "./language";
import { useState } from "react";
import {
  defaultWorld,
  type WorldSettings,
} from "../../../packages/editor-core/src/world";
export function WorldPanel({
  value,
  busy,
  onApply,
  onImport,
}: {
  value?: WorldSettings;
  busy: boolean;
  onApply: (world: WorldSettings) => void;
  onImport: (bytes: Uint8Array, name: string) => void;
}) {
  const [draft, setDraft] = useState<WorldSettings>(
      structuredClone(value ?? defaultWorld()),
    ),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const field = (
    label: string,
    value: number,
    change: (v: number) => void,
    min: number,
    max: number,
    step = 0.1,
  ) => (
    <label className="asset-property-field">
      {label}
      <input
        aria-label={label}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => change(Number(e.target.value))}
      />
    </label>
  );
  const update = <K extends keyof WorldSettings>(
    kind: K,
    field: string,
    value: unknown,
  ) => setDraft((w) => ({ ...w, [kind]: { ...w[kind], [field]: value } }));
  async function importMap(bytes: Uint8Array, name: string) {
    try {
      onImport(bytes, name);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  async function preset(name: string) {
    setLoading(true);
    try {
      const r = await fetch(new URL("environments/" + name, document.baseURI));
      if (!r.ok) throw Error("Environment preset unavailable");
      await importMap(new Uint8Array(await r.arrayBuffer()), name);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }
  return (
    <section className="world-properties" aria-label={tr("Scene environment settings", "场景环境设置")}>
      <h3>{tr("Scene environment", "场景环境")}</h3>
      <fieldset className="object-fields" disabled={busy || loading}>
        <h3>{tr("Environment map", "环境贴图")}</h3>
        <p className="compact-status">
          {draft.environment.map
            ? draft.environment.name
            : tr("Default studio · No map", "默认摄影棚 · 无贴图")}
        </p>
        <div className="project-buttons">
          <button onClick={() => void preset("studio_small_09.nenv")}>{tr("Studio map", "摄影棚贴图")}</button>
          <button onClick={() => void preset("venice_sunset.nenv")}>{tr("Sunset map", "日落贴图")}</button>
        </div>
        <label className="field">{tr("Import .nenv", "导入 .nenv")}<input
            aria-label={tr("Environment map file", "环境贴图文件")}
            type="file"
            accept=".nenv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setLoading(true);
                void f
                  .arrayBuffer()
                  .then((b) => importMap(new Uint8Array(b), f.name))
                  .catch((e) => setError(String(e)))
                  .finally(() => setLoading(false));
              }
              e.target.value = "";
            }}
          />
        </label>
        <button
          disabled={!draft.environment.map}
          onClick={() =>
            setDraft((w) => ({
              ...w,
              environment: { ...w.environment, map: null, name: "" },
              background: { ...w.background, mode: "color" },
            }))
          }
        >{tr("Remove environment map", "移除环境贴图")}</button>
        <fieldset disabled={!draft.environment.map} className="object-fields">
          {field(
            tr("Environment rotation", "环境旋转"),
            draft.environment.rotation,
            (v) => update("environment", "rotation", v),
            -180,
            180,
            1,
          )}
          {field(
            tr("Environment intensity", "环境光强度"),
            draft.environment.intensity,
            (v) => update("environment", "intensity", v),
            0,
            16,
          )}
          {field(
            tr("Background intensity", "背景亮度"),
            draft.environment.backgroundIntensity,
            (v) => update("environment", "backgroundIntensity", v),
            0,
            16,
          )}
        </fieldset>
        <h3>{tr("Scene background", "场景背景")}</h3>
        <label className="asset-property-field">{tr("Type", "类型")}<select
            aria-label={tr("Background type", "场景背景类型")}
            value={draft.background.mode}
            onChange={(e) => update("background", "mode", e.target.value)}
          >
            <option value="color">{tr("Solid color", "纯色")}</option>
            <option value="environment" disabled={!draft.environment.map}>{tr("Environment map", "环境贴图")}</option>
          </select>
        </label>
        <label className="asset-property-field">{tr("Background color", "背景颜色")}<input
            aria-label={tr("Scene background color", "场景背景颜色")}
            maxLength={7}
            value={draft.background.color}
            onChange={(e) => update("background", "color", e.target.value)}
          />
        </label>
        <h3>{tr("Fog", "雾效")}</h3>
        <label className="asset-property-field">{tr("Type", "类型")}<select
            aria-label={tr("Fog type", "雾效类型")}
            value={draft.fog.mode}
            onChange={(e) => update("fog", "mode", e.target.value)}
          >
            <option value="none">{tr("Off", "关闭")}</option>
            <option value="linear">{tr("Linear fog", "线性雾")}</option>
            <option value="exp2">{tr("Exponential squared fog", "指数平方雾")}</option>
          </select>
        </label>
        <label className="asset-property-field">{tr("Fog color", "雾颜色")}<input
            aria-label={tr("Fog color", "雾颜色")}
            maxLength={7}
            value={draft.fog.color}
            onChange={(e) => update("fog", "color", e.target.value)}
          />
        </label>
        {draft.fog.mode === "linear" ? (
          <>
            {field(
              tr("Fog start", "雾起点"),
              draft.fog.near,
              (v) => update("fog", "near", v),
              0,
              1000,
              1,
            )}
            {field(
              tr("Fog end", "雾终点"),
              draft.fog.far,
              (v) => update("fog", "far", v),
              0.001,
              2000,
              1,
            )}
          </>
        ) : draft.fog.mode === "exp2" ? (
          field(
            tr("Fog density", "雾密度"),
            draft.fog.density,
            (v) => update("fog", "density", v),
            0,
            1,
            0.005,
          )
        ) : null}
        <button
          onClick={() => {
            try {
              onApply(draft);
              setError("");
            } catch (e) {
              setError(String(e));
            }
          }}
        >{tr("Apply scene environment", "应用场景环境")}</button>
        <small>{tr("Saved with the project. Fog affects models and ground.", "设置随项目保存；雾作用于模型与地面，天空保持原贴图。")}</small>
        {error && (
          <p role="alert" className="notice">
            {error}
          </p>
        )}
      </fieldset>
    </section>
  );
}
