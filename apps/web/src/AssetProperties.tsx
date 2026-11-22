import { tr } from "./language";
import { useMemo, useState, useEffect } from "react";
import {
  readGLB,
  writeGLB,
  geometryData,
  regenerateGeometry,
  primitives,
  materialData,
  applyMaterial,
  applyTexture,
  hasTexture,
  textureSlots,
  imageType,
  colorHex,
  type Material,
  type TextureSlot,
} from "../../../packages/asset-system/index";
import { linearColor } from "../../../packages/editor-core/src/lighting";
function MaterialColor({
  label,
  value,
  onValue,
}: {
  label: string;
  value: number[];
  onValue: (value: number[]) => void;
}) {
  const [hex, setHex] = useState(colorHex(value));
  useEffect(() => setHex(colorHex(value)), [value]);
  const change = (raw: string) => {
    setHex(raw);
    if (/^#[0-9a-f]{6}$/i.test(raw)) onValue(linearColor(raw));
  };
  return (
    <span className="asset-color-controls">
      <input
        aria-label={label}
        type="color"
        value={colorHex(value)}
        onInput={(e) => change(e.currentTarget.value)}
      />
      <input
        aria-label={label + tr("Hex", "十六进制")}
        value={hex}
        maxLength={7}
        onChange={(e) => change(e.currentTarget.value)}
      />
    </span>
  );
}
export function AssetProperties({
  bytes,
  mode,
  users,
  disabled,
  onApply,
  onPreviewMaterial,
  onUnique,
  onExpand,
}: {
  bytes: Uint8Array;
  mode: "geometry" | "material";
  users: number;
  disabled: boolean;
  onApply: (bytes: Uint8Array) => void;
  onPreviewMaterial?: (
    material: Material,
    pending: Partial<
      Record<TextureSlot, { bytes: Uint8Array; name: string } | null>
    >,
  ) => Promise<void>;
  onUnique: () => void;
  onExpand: () => void;
}) {
  const parsed = useMemo(() => {
    try {
      const doc = readGLB(bytes);
      return {
        doc,
        geometry: geometryData(doc),
        material: materialData(doc),
        error: "",
      };
    } catch (e) {
      return { doc: null, geometry: null, material: null, error: String(e) };
    }
  }, [bytes]);
  const [applying, setApplying] = useState(false);
  const [geometry, setGeometry] = useState(parsed.geometry),
    [material, setMaterial] = useState(parsed.material),
    [status, setStatus] = useState(""),
    [pending, setPending] = useState<
      Partial<Record<TextureSlot, { bytes: Uint8Array; name: string } | null>>
    >({});
  if (!parsed.doc) return <p className="hint">{parsed.error}</p>;
  const doc = parsed.doc;
  const updateMaterial = (
    key: keyof Material,
    value: Material[keyof Material],
  ) =>
    setMaterial((previous) =>
      previous ? { ...previous, [key]: value } : previous,
    );
  const factor = (
    key: keyof Pick<
      Material,
      | "opacity"
      | "alphaCutoff"
      | "metallic"
      | "roughness"
      | "normalScale"
      | "occlusion"
    >,
    label: string,
    max = 1,
  ) => (
    <label className="asset-property-field">
      {label}
      <input
        aria-label={label}
        type="number"
        min="0"
        max={max}
        step="0.05"
        value={material![key]}
        onChange={(e) => updateMaterial(key, Number(e.target.value))}
      />
    </label>
  );
  const apply = async () => {
    if (applying) return;
    setApplying(true);
    try {
      if (mode === "geometry") {
        if (!geometry) return;
        onApply(writeGLB(regenerateGeometry(doc, geometry)));
      } else {
        let next = doc;
        for (const t of textureSlots)
          if (Object.hasOwn(pending, t.key))
            next = applyTexture(next, t.key, pending[t.key]?.bytes ?? null);
        next = applyMaterial(next, material!);
        await onPreviewMaterial?.(material!, pending);
        onApply(writeGLB(next));
      }
      setStatus("");
    } catch (e) {
      setStatus(String(e));
    } finally {
      setApplying(false);
    }
  };
  async function file(slot: TextureSlot, input: HTMLInputElement) {
    const f = input.files?.[0];
    if (!f) return;
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const mime = imageType(bytes),
        bitmap = await createImageBitmap(
          new Blob([new Uint8Array(bytes)], { type: mime }),
        );
      const valid =
        bitmap.width <= 8192 &&
        bitmap.height <= 8192 &&
        bitmap.width * bitmap.height <= 16777216;
      bitmap.close();
      if (!valid) throw Error(tr("Texture exceeds size budget", "贴图尺寸超过预算"));
      setPending((p) => ({ ...p, [slot]: { bytes, name: f.name } }));
      setStatus("");
    } catch (e) {
      setStatus(String(e));
    } finally {
      input.value = "";
    }
  }
  return (
    <div className="asset-properties">
      <div className="asset-sharing">
        <span>{tr("Shared asset ·", "共享资源 ·")}{users}{tr("instances", "个实例")}</span>
        <button disabled={disabled || users < 2} onClick={onUnique}>{tr("Make unique", "独立副本")}</button>
      </div>
      <fieldset disabled={disabled} className="object-fields">
        {mode === "geometry" ? (
          geometry ? (
            <>
              <h3>{primitives[geometry.type].name}</h3>
              {primitives[geometry.type].parameters.map((p) => (
                <label className="asset-property-field" key={p.key}>
                  {p.label}
                  <input
                    aria-label={p.label}
                    type="number"
                    min={p.min}
                    max={p.max}
                    step={p.integer ? 1 : 0.1}
                    value={geometry.parameters[p.key]}
                    onChange={(e) =>
                      setGeometry((previous) =>
                        previous
                          ? {
                              ...previous,
                              parameters: {
                                ...previous.parameters,
                                [p.key]: Number(e.target.value),
                              },
                            }
                          : previous,
                      )
                    }
                  />
                </label>
              ))}
              <button
                className="primary"
                disabled={applying || disabled}
                onClick={apply}
              >{tr("Apply geometry", "应用几何体")}</button>
            </>
          ) : (
            <>
              <h3>{tr("Imported mesh", "导入网格")}</h3>
              {doc.json.extras?.novaEditor?.modelPart ? (
                <p className="compact-status">{tr("Use Object or the gizmo for transform edits and Material for this slot.", "子网格：使用对象页或 gizmo 编辑变换，材质页编辑此槽。")}</p>
              ) : (
                <>
                  <p className="compact-status">{tr("Expand to edit internal nodes, submeshes, and material slots.", "展开后可独立编辑内部节点、子网格变换和材质槽。")}</p>
                  <button onClick={onExpand}>{tr("Expand model", "展开模型")}</button>
                </>
              )}
              <div className="project-summary">
                <span>{tr("Mesh", "网格")}</span>
                <strong>{doc.json.meshes?.length ?? 0}</strong>
                <span>{tr("Vertices", "顶点")}</span>
                <strong>
                  {(doc.json.meshes ?? []).reduce(
                    (sum: number, m: any) =>
                      sum +
                      (m.primitives ?? []).reduce(
                        (n: number, p: any) =>
                          n +
                          (doc.json.accessors?.[p.attributes?.POSITION]
                            ?.count ?? 0),
                        0,
                      ),
                    0,
                  )}
                </strong>
              </div>
            </>
          )
        ) : (
          material && (
            <>
              <h3>{tr("PBR material", "PBR 材质")}</h3>
              <label className="field">{tr("Name", "名称")}<input
                  aria-label={tr("Material name", "材质名称")}
                  value={material.name}
                  onChange={(e) => updateMaterial("name", e.target.value)}
                />
              </label>
              <label className="asset-property-field">{tr("Base color", "基础色")}<MaterialColor
                  label={tr("Material base color", "材质基础色")}
                  value={material.color}
                  onValue={(value) => updateMaterial("color", value)}
                />
              </label>
              <label className="asset-property-field">{tr("Alpha mode", "Alpha 模式")}<select
                  aria-label={tr("Material alpha mode", "材质 Alpha 模式")}
                  value={material.alphaMode}
                  onChange={(e) =>
                    updateMaterial(
                      "alphaMode",
                      e.target.value as Material["alphaMode"],
                    )
                  }
                >
                  <option value="OPAQUE">{tr("Opaque", "不透明")}</option>
                  <option value="MASK">{tr("Alpha mask", "Alpha 裁剪")}</option>
                  <option value="BLEND">{tr("Alpha blend", "透明混合")}</option>
                </select>
              </label>
              {factor("opacity", tr("Opacity", "不透明度"))}
              {material.alphaMode === "MASK" &&
                factor("alphaCutoff", tr("Alpha cutoff", "Alpha 裁剪阈值"))}
              <label className="asset-property-field">
                <input
                  type="checkbox"
                  aria-label={tr("Double-sided material", "材质双面")}
                  checked={material.doubleSided}
                  onChange={(e) =>
                    updateMaterial("doubleSided", e.target.checked)
                  }
                />{tr("Double-sided", "双面")}</label>
              {material.alphaMode !== "OPAQUE" && (
                <p className="hint">{tr("Alpha materials use Raster. Blended surfaces use weighted OIT. Masked surfaces cast cutout shadows.", "Alpha 材质使用光栅模式；透明混合采用加权 OIT，不投射阴影。Alpha 裁剪支持镂空阴影。")}</p>
              )}
              {factor("metallic", tr("Metallic", "金属度"))}
              {factor("roughness", tr("Roughness", "粗糙度"))}
              <label className="asset-property-field">{tr("Emission", "自发光")}<MaterialColor
                  label={tr("Material emission", "材质自发光")}
                  value={material.emissive}
                  onValue={(value) => updateMaterial("emissive", value)}
                />
              </label>
              {factor("normalScale", tr("Normal strength", "法线强度"), 4)}
              {factor("occlusion", tr("Occlusion strength", "遮蔽强度"))}
              <h3>{tr("Texture", "贴图")}</h3>
              {textureSlots.map((t) => {
                const ready = Object.hasOwn(pending, t.key)
                  ? !!pending[t.key]
                  : hasTexture(doc, t.key);
                return (
                  <div className="texture-property" key={t.key}>
                    <label>
                      {t.label}
                      <input
                        type="file"
                        aria-label={t.label}
                        accept="image/png,image/jpeg"
                        onChange={(e) => void file(t.key, e.currentTarget)}
                      />
                    </label>
                    <div>
                      <small>
                        {pending[t.key]?.name ?? (ready ? tr("Embedded", "已内嵌") : tr("None", "无"))}
                      </small>
                      <button
                        disabled={!ready}
                        onClick={() =>
                          setPending((p) => ({ ...p, [t.key]: null }))
                        }
                      >{tr("Remove", "移除")}</button>
                    </div>
                  </div>
                );
              })}
              <button
                className="primary"
                disabled={applying || disabled}
                onClick={apply}
              >{tr("Apply material", "应用材质")}</button>
            </>
          )
        )}
      </fieldset>
      {status && (
        <p role="alert" className="notice">
          {status}
        </p>
      )}
    </div>
  );
}
