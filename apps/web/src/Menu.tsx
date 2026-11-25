import { useEffect, useRef, useState } from "react";
export type MenuItem = {
  label: string;
  action?: () => void;
  children?: MenuItem[];
  disabled?: boolean;
  shortcut?: string;
};
export function Menu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false),
    [expanded, setExpanded] = useState<string | null>(null),
    root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) {
      setExpanded(null);
      return;
    }
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        root.current
          ?.querySelector<HTMLButtonElement>(".menu-trigger")
          ?.focus();
      }
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div
      className="menu"
      ref={root}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => {
          const buttons = [
            ...(root.current?.querySelectorAll<HTMLButtonElement>(
              '[role="menuitem"]:not(:disabled)',
            ) ?? []),
          ];
          if (!buttons.length) return;
          const index = buttons.findIndex((b) => b === document.activeElement);
          buttons[
            (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
              buttons.length
          ].focus();
        });
      }}
    >
      <button
        className="menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open && (
        <div className="menu-popup" role="menu" aria-label={label}>
          {items.map((item) => (
            <div key={item.label}>
              <button
                role="menuitem"
                disabled={item.disabled}
                aria-expanded={item.children ? expanded === item.label : undefined}
                onClick={() => {
                  if (item.children) {
                    setExpanded(expanded === item.label ? null : item.label);
                  } else {
                    setOpen(false);
                    item.action?.();
                  }
                }}
              >
                <span>{item.label}</span>
                {item.children ? <span aria-hidden="true">{expanded === item.label ? "▾" : "▸"}</span>
                  : item.shortcut && <kbd>{item.shortcut}</kbd>}
              </button>
              {item.children && expanded === item.label && (
                <div className="menu-children" role="group" aria-label={item.label}>
                  {item.children.map(child => (
                    <button role="menuitem" key={child.label} disabled={child.disabled} onClick={() => {
                      setOpen(false);
                      child.action?.();
                    }}><span>{child.label}</span></button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
