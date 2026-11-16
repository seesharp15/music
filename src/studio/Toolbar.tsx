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

/** The tools, and the switches that go with them. The transport joins this row in S3.7. */
export function Toolbar({ children }: { children?: React.ReactNode }) {
  const { ui } = useSession();
  const tool = useUi((s) => s.tool);
  const adding = useUi((s) => s.addToSelection);
  const count = useUi((s) => s.selection.length);
  const inspecting = useUi((s) => s.sheet === "inspector");
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
        className={`tool-btn ${adding ? "is-on" : ""}`}
        aria-pressed={adding}
        aria-label="Add to selection"
        title="Add to selection: each tap adds a note to those selected"
        onClick={() => ui.setState({ addToSelection: !adding })}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
          <rect
            x="3"
            y="3"
            width="12"
            height="12"
            rx="2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeDasharray="3 2.5"
          />
          <path d="M17 13v8m-4-4h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <button
        className={`tool-btn has-count ${inspecting ? "is-on" : ""}`}
        aria-pressed={inspecting}
        aria-label={count ? `Selection: ${count} ${count === 1 ? "note" : "notes"}` : "Selection: nothing selected"}
        title="The selected notes: pitch, timing, velocity, hand"
        onClick={() => ui.setState({ sheet: inspecting ? null : "inspector" })}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
          <path d="M4 7h10M4 12h16M4 17h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="17" cy="7" r="2.2" fill="currentColor" />
          <circle cx="14" cy="17" r="2.2" fill="currentColor" />
        </svg>
        {count > 0 && <span className="tool-count">{count}</span>}
      </button>
      {children}
    </div>
  );
}
