import { useEffect, useRef, useState } from "react";
import { useSession, useUi } from "./context";
import type { KeysMode } from "./ui-store";

const KEYS: { id: KeysMode; label: string; title: string }[] = [
  { id: "fit", label: "Fit", title: "The keys for the music near the cursor" },
  { id: "song", label: "Song", title: "The keys this song uses" },
  { id: "all", label: "All", title: "All 88 keys" },
];

/**
 * How the editor shows the song: zoom, which keys, and how notes are coloured. Everything a pinch
 * or a scroll wheel can do is here as a button too.
 */
export function ViewMenu() {
  const session = useSession();
  const { ui } = session;
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const keys = useUi((s) => s.keys);
  const byHand = useUi((s) => s.colourByHand);
  const editAll = useUi((s) => s.editAll);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && wrap.current?.contains(document.activeElement)) {
        e.stopPropagation();
        setOpen(false);
        wrap.current.querySelector("button")?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const zoom = (factor: number) => session.editor?.zoomBy(factor);
  const shift = (by: number) => ui.setState((s) => ({ keyShift: Math.max(-4, Math.min(4, s.keyShift + by)) }));

  return (
    <div className="view-menu" ref={wrap}>
      <button
        className="view-btn"
        aria-expanded={open}
        aria-label="View: zoom and keys"
        title="View: zoom and keys"
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
          <circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M15 15l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="view-panel" role="group" aria-label="View">
          <div className="view-row">
            <span>Zoom</span>
            <button className="view-step" aria-label="Zoom out: show more bars" onClick={() => zoom(1.4)}>
              −
            </button>
            <button className="view-step" aria-label="Zoom in: show fewer bars" onClick={() => zoom(1 / 1.4)}>
              +
            </button>
          </div>
          <div className="view-row">
            <span>Keys</span>
            <button className="view-step" aria-label="Keys an octave lower" onClick={() => shift(-1)}>
              ◀
            </button>
            <button className="view-step" aria-label="Keys an octave higher" onClick={() => shift(1)}>
              ▶
            </button>
          </div>
          <div className="view-row" role="group" aria-label="Keys shown">
            {KEYS.map((k) => (
              <button
                key={k.id}
                className={`chip ${keys === k.id ? "is-on" : ""}`}
                aria-pressed={keys === k.id}
                title={k.title}
                onClick={() => ui.setState({ keys: k.id, keyShift: 0 })}
              >
                {k.label}
              </button>
            ))}
          </div>
          <label className="view-check">
            <input type="checkbox" checked={byHand} onChange={(e) => ui.setState({ colourByHand: e.target.checked })} />
            Colour by hand
          </label>
          {!session.readOnly && (
            <label className="view-check">
              <input type="checkbox" checked={editAll} onChange={(e) => ui.setState({ editAll: e.target.checked })} />
              Edit all tracks
            </label>
          )}
        </div>
      )}
    </div>
  );
}
