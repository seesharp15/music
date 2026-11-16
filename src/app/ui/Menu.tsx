import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/**
 * A button that opens a short list of actions. Arrow keys move through it, Escape and a click
 * elsewhere close it, and focus goes back to the button.
 */
export function Menu(props: { label: string; items: MenuItem[]; className?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const items = () => [
      ...(wrap.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []),
    ];
    items()[0]?.focus();
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      const list = items();
      const at = list.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        button.current?.focus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        list[(at + 1) % list.length]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        list[(at - 1 + list.length) % list.length]?.focus();
      } else if (e.key === "Tab") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div className={`menu ${props.className ?? ""}`} ref={wrap}>
      <button
        ref={button}
        type="button"
        className="menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={props.label}
        title={props.label}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {props.children ?? <span aria-hidden>⋯</span>}
      </button>
      {open && (
        <div className="menu-list" role="menu" id={id} aria-label={props.label}>
          {props.items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.danger ? "is-danger" : ""}
              disabled={item.disabled}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                button.current?.focus();
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
