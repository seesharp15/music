import { chordAt } from "../music/theory";
import { useSession, useUi } from "./context";
import type { Tool } from "./ui-store";

const TOOLS: { id: Tool; label: string; hint: string; icon: React.ReactNode }[] = [
  {
    id: "select",
    label: "Select",
    hint: "Tap a note to select it; drag it to move it, or its top edge to resize it",
    icon: <path d="M5 3l12 9-5 1 3 6-2.4 1-3-6-4.6 3z" fill="currentColor" />,
  },
  {
    id: "draw",
    label: "Draw",
    hint: "Tap an empty spot above a key to write a note there",
    icon: <path d="M4 20l1-4.5L16.5 4a1.8 1.8 0 0 1 2.5 0l1 1a1.8 1.8 0 0 1 0 2.5L8.5 19z" fill="currentColor" />,
  },
  {
    id: "erase",
    label: "Erase",
    hint: "Tap or sweep across notes to remove them",
    icon: (
      <path
        d="M9 4.5h10.5a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H9L2.5 12zM12 9l5 6m0-6l-5 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
];

/** The tools; the transport sits beside them in the same row. */
export function Toolbar({ children }: { children?: React.ReactNode }) {
  const { ui } = useSession();
  const session = useSession();
  const tool = useUi((s) => s.tool);
  const chordsOpen = useUi((s) => s.sheet === "chords");
  /** The picker opens on the chord under the cursor, or at the start of the cursor's bar. */
  const barLine = () => {
    const cursor = ui.getState().cursor;
    const here = chordAt(session.store.getState().project, cursor);
    if (here) return here.tick;
    const time = session.playback.time();
    return time.tickOfBar(time.positionAt(cursor).bar);
  };
  return (
    <div className="toolbar">
      <div className="tool-group" role="group" aria-label="Tool">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`tool-btn ${tool === t.id ? "is-on" : ""}`}
            aria-pressed={tool === t.id}
            aria-label={t.label}
            title={`${t.label}: ${t.hint}`}
            onClick={() => ui.setState({ tool: t.id })}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
              {t.icon}
            </svg>
          </button>
        ))}
      </div>
      <button
        className={`tool-btn chords-btn ${chordsOpen ? "is-on" : ""}`}
        aria-pressed={chordsOpen}
        aria-label="Chords"
        title="Chords: choose the chord at the cursor"
        onClick={() => ui.setState(chordsOpen ? { sheet: null } : { sheet: "chords", chordTick: barLine() })}
      >
        <span aria-hidden>C7</span>
      </button>
      {children}
    </div>
  );
}
