import { useState, useEffect } from "react";
import type { Scene } from "../../../packages/scene-schema/index";
import { inheritedFlag } from "../../../packages/editor-core/src/hierarchy";
export type TreeCommand =
  | "group"
  | "ungroup"
  | "duplicate"
  | "delete"
  | "hide"
  | "show"
  | "lock"
  | "unlock"
  | "up"
  | "down";
export function SceneTree({
  scene,
  selection,
  onSelect,
  onCommand,
  onMove,
  onRename,
  disabled,
}: {
  scene: Scene;
  selection: string[];
  onSelect: (ids: string[]) => void;
  onCommand: (command: TreeCommand, ids?: string[]) => void;
  onMove: (
    ids: string[],
    parent: string | null,
    before?: string | null,
  ) => void;
  onRename: (id: string, name: string) => void;
  disabled: boolean;
}) {
  const [collapsed, setCollapsed] = useState(new Set<string>()),
    [query, setQuery] = useState(""),
    [menu, setMenu] = useState<string | null>(null),
    [renaming, setRenaming] = useState<string | null>(null),
    [draft, setDraft] = useState(""),
    [anchor, setAnchor] = useState<string | null>(null),
    [drop, setDrop] = useState("");
  useEffect(() => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      for (const id of selection) {
        let p = scene.nodes.find((n) => n.id === id)?.parentId;
        while (p) {
          next.delete(p);
          p = scene.nodes.find((n) => n.id === p)?.parentId;
        }
      }
      return next;
    });
  }, [selection]);
  const matches = new Set<string>();
  const nodes = new Map(scene.nodes.map((n) => [n.id, n]));
  for (const n of scene.nodes)
    if (n.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) {
      let p: string | null = n.id;
      while (p) {
        matches.add(p);
        p = nodes.get(p)!.parentId;
      }
    }
  const visible: { id: string; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const n of scene.nodes.filter((n) => n.parentId === parent)) {
      if (query && !matches.has(n.id)) continue;
      visible.push({ id: n.id, depth });
      if (query || !collapsed.has(n.id)) walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  const command = (c: TreeCommand) => {
    onCommand(c);
    setMenu(null);
  };
  const choose = (
    id: string,
    e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
  ) => {
    if (e.shiftKey && anchor && visible.some((n) => n.id === anchor)) {
      const a = visible.findIndex((n) => n.id === anchor),
        b = visible.findIndex((n) => n.id === id);
      onSelect(
        visible.slice(Math.min(a, b), Math.max(a, b) + 1).map((n) => n.id),
      );
    } else if (e.ctrlKey || e.metaKey)
      onSelect(
        selection.includes(id)
          ? selection.filter((x) => x !== id)
          : [...selection, id],
      );
    else onSelect([id]);
    setAnchor(id);
  };
  const payload = (e: React.DragEvent) => {
    try {
      const p = JSON.parse(e.dataTransfer.getData("application/x-nova-nodes"));
      return Array.isArray(p) && p.every((x) => typeof x === "string")
        ? (p as string[])
        : null;
    } catch {
      return null;
    }
  };
  const actions: [TreeCommand, string][] = [
    ["group", "分组"],
    ["ungroup", "解组"],
    ["duplicate", "复制子树"],
    ["delete", "删除"],
    ["hide", "隐藏"],
    ["show", "显示"],
    ["lock", "锁定"],
    ["unlock", "解锁"],
    ["up", "上移"],
    ["down", "下移"],
  ];
  return (
    <div className="scene-tree" aria-label="场景树">
      <input
        aria-label="搜索场景节点"
        placeholder="搜索节点…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="tree-actions">
        {actions.slice(0, 4).map(([c, t]) => (
          <button
            key={c}
            disabled={disabled || !selection.length}
            onClick={() => command(c)}
          >
            {t}
          </button>
        ))}
      </div>
      <div
        className="tree-root"
        title="拖到此处移至根级；行中部设为子节点，上下边缘排序。Ctrl/Cmd 多选，Shift 连选。"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("application/x-nova-nodes"))
            e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          const ids = payload(e);
          if (ids && !disabled) onMove(ids, null);
          setDrop("");
        }}
      >
        场景根级
      </div>
      <div role="tree" aria-multiselectable="true">
        {visible.map(({ id, depth }) => {
          const n = nodes.get(id)!,
            children = scene.nodes.some((c) => c.parentId === id),
            hidden = inheritedFlag(scene, id, "hidden"),
            locked = inheritedFlag(scene, id, "locked");
          return (
            <div key={id}>
              <div
                role="treeitem"
                aria-level={depth + 1}
                aria-selected={selection.includes(id)}
                aria-expanded={
                  children ? !!query || !collapsed.has(id) : undefined
                }
                tabIndex={0}
                className={`tree-row ${selection.includes(id) ? "selected" : ""} ${hidden ? "tree-hidden" : ""} ${drop.startsWith(id + ":") ? "drop-" + drop.split(":").pop() : ""}`}
                style={{ paddingLeft: 6 + depth * 14 }}
                draggable={!disabled && !locked && renaming !== id}
                onClick={(e) => choose(id, e)}
                onDoubleClick={() => {
                  if (!locked) {
                    setRenaming(id);
                    setDraft(n.name);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter") choose(id, e);
                  if (e.key === "F2" && !locked) {
                    setRenaming(id);
                    setDraft(n.name);
                  }
                  if (e.key === "ArrowRight")
                    setCollapsed((s) => {
                      const t = new Set(s);
                      t.delete(id);
                      return t;
                    });
                  if (e.key === "ArrowLeft")
                    setCollapsed((s) => new Set(s).add(id));
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!selection.includes(id)) onSelect([id]);
                  setMenu(menu === id ? null : id);
                }}
                onDragStart={(e) => {
                  const ids = selection.includes(id) ? selection : [id];
                  onSelect(ids);
                  e.dataTransfer.setData(
                    "application/x-nova-nodes",
                    JSON.stringify(ids),
                  );
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  if (
                    disabled ||
                    !e.dataTransfer.types.includes("application/x-nova-nodes")
                  )
                    return;
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect(),
                    y = (e.clientY - r.top) / r.height;
                  setDrop(
                    id +
                      ":" +
                      (y < 0.25 ? "before" : y > 0.75 ? "after" : "inside"),
                  );
                }}
                onDragLeave={() => setDrop("")}
                onDragEnd={() => setDrop("")}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const ids = payload(e),
                    r = e.currentTarget.getBoundingClientRect(),
                    y = (e.clientY - r.top) / r.height;
                  setDrop("");
                  if (!ids || disabled) return;
                  if (y >= 0.25 && y <= 0.75) {
                    onMove(ids, id);
                    setCollapsed((s) => {
                      const t = new Set(s);
                      t.delete(id);
                      return t;
                    });
                  } else {
                    const siblings = scene.nodes.filter(
                        (c) => c.parentId === n.parentId,
                      ),
                      i = siblings.findIndex((c) => c.id === id);
                    onMove(
                      ids,
                      n.parentId,
                      y < 0.25 ? id : (siblings[i + 1]?.id ?? null),
                    );
                  }
                }}
              >
                <button
                  className="tree-fold"
                  aria-label={`${collapsed.has(id) ? "展开" : "折叠"} ${n.name}`}
                  disabled={!children}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCollapsed((s) => {
                      const t = new Set(s);
                      t.has(id) ? t.delete(id) : t.add(id);
                      return t;
                    });
                  }}
                >
                  {children ? (collapsed.has(id) ? "▸" : "▾") : "·"}
                </button>
                {renaming === id ? (
                  <input
                    autoFocus
                    aria-label="重命名节点"
                    value={draft}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => {
                      if (draft.trim()) onRename(id, draft.trim());
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setRenaming(null);
                    }}
                  />
                ) : (
                  <span className="tree-label">
                    {n.camera ? "▣" : n.light ? "☼" : n.assetId ? "◇" : "▧"}{" "}
                    {n.name}
                    {n.camera?.primary
                      ? " · 主相机"
                      : n.light?.active
                        ? " · 场景光源"
                        : ""}
                  </span>
                )}
                <button
                  className="tree-flag"
                  aria-label={`${n.hidden ? "显示" : "隐藏"} ${n.name}`}
                  disabled={disabled || locked}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect([id]);
                    onCommandForNode(n.hidden ? "show" : "hide", id);
                  }}
                >
                  {hidden ? "隐" : "显"}
                </button>
                <button
                  className="tree-flag"
                  aria-label={`${n.locked ? "解锁" : "锁定"} ${n.name}`}
                  disabled={
                    disabled ||
                    !!(n.parentId && inheritedFlag(scene, n.parentId, "locked"))
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect([id]);
                    onCommandForNode(n.locked ? "unlock" : "lock", id);
                  }}
                >
                  {locked ? "锁" : "·"}
                </button>
              </div>
              {menu === id && (
                <div className="tree-menu" role="menu">
                  <button
                    disabled={disabled || locked}
                    onClick={() => {
                      setRenaming(id);
                      setDraft(n.name);
                      setMenu(null);
                    }}
                  >
                    重命名
                  </button>
                  {actions.map(([c, t]) => (
                    <button
                      role="menuitem"
                      key={c}
                      disabled={disabled}
                      onClick={() => command(c)}
                    >
                      {t}
                    </button>
                  ))}
                  <button onClick={() => setMenu(null)}>关闭菜单</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <small
        className="tree-help"
        title="Ctrl/Cmd 多选，Shift 连选。多选可整体变换，局部坐标使用最后选中节点的朝向。"
      >
        已选 {selection.length} 个
      </small>
    </div>
  );
  function onCommandForNode(c: TreeCommand, id: string) {
    // Pass explicit IDs through the command event to avoid a stale React selection.
    onCommand(c, [id]);
  }
}
