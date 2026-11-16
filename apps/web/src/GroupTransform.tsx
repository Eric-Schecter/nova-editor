import { useState } from "react";
import { type Transform } from "../../../packages/scene-schema/index";
import { eulerQuaternion } from "../../../packages/scene-schema/transforms";
export function GroupTransform({
  count,
  disabled,
  onApply,
}: {
  count: number;
  disabled: boolean;
  onApply: (delta: Transform) => void;
}) {
  const [position, setPosition] = useState([0, 0, 0]),
    [rotation, setRotation] = useState([0, 0, 0]),
    [scale, setScale] = useState([1, 1, 1]);
  return (
    <fieldset className="object-fields" disabled={disabled}>
      <h3>
        整体变换 <span>{count} 个选中节点</span>
      </h3>
      {[
        { label: "整体位移", values: position, setValues: setPosition },
        { label: "整体旋转", values: rotation, setValues: setRotation },
        { label: "整体缩放", values: scale, setValues: setScale },
      ].map(({ label, values, setValues }) => (
        <fieldset key={label}>
          <legend>
            {label}
            {label === "整体旋转" ? "（度）" : ""}
          </legend>
          <div className="vector">
            {values.map((v: number, k: number) => (
              <label key={k}>
                {"XYZ"[k]}
                <input
                  aria-label={`${label}-${"xyz"[k]}`}
                  type="number"
                  step={label === "整体缩放" ? 0.1 : 1}
                  value={v}
                  onChange={(e) =>
                    setValues((a: number[]) =>
                      a.map((x, i) => (i === k ? Number(e.target.value) : x)),
                    )
                  }
                />
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <button
        onClick={() =>
          onApply({ position, rotation: eulerQuaternion(rotation), scale })
        }
      >
        应用整体变换
      </button>
    </fieldset>
  );
}
