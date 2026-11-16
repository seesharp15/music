import { useEffect, useRef, type ReactNode } from "react";
import { useSession, useUi } from "../context";
import type { SheetId } from "../ui-store";

/**
 * A panel of the Studio: it slides up from the bottom on a phone and sits at the side on a wide
 * screen. One is open at a time (`ui.sheet`). Escape closes it and focus returns to where it was.
 */
export function Sheet({ id, title, children }: { id: SheetId; title: string; children: ReactNode }) {
  const { ui } = useSession();
  const open = useUi((s) => s.sheet === id);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !el?.contains(document.activeElement)) return;
      e.stopPropagation();
      ui.setState({ sheet: null });
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (before?.isConnected && el?.contains(document.activeElement)) before.focus();
    };
  }, [open, ui]);

  if (!open) return null;
  return (
    <section ref={ref} className="sheet" role="dialog" aria-label={title} tabIndex={-1} data-sheet={id}>
      <header className="sheet-head">
        <h2>{title}</h2>
        <button
          className="menu-btn"
          aria-label={`Close ${title.toLowerCase()}`}
          onClick={() => ui.setState({ sheet: null })}
        >
          <span aria-hidden>✕</span>
        </button>
      </header>
      <div className="sheet-body">{children}</div>
    </section>
  );
}
