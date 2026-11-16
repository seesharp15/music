import { announce } from "./actions";
import { useSession, useUi } from "./context";
import { lengthName } from "./describe";
import { lengthTicks, type StepLength } from "./ui-store";

const LENGTHS: { base: StepLength["base"]; text: string; name: string; wide?: boolean }[] = [
  { base: 1, text: "1", name: "Whole note" },
  { base: 2, text: "1/2", name: "Half note" },
  { base: 4, text: "1/4", name: "Quarter note" },
  { base: 8, text: "1/8", name: "Eighth note" },
  { base: 16, text: "1/16", name: "Sixteenth note" },
  { base: 32, text: "1/32", name: "Thirty-second note", wide: true },
];

/** The length the next note gets, and the three things step entry does besides writing a note. */
export function StepBar() {
  const session = useSession();
  const { ui, keys } = session;
  const length = useUi((s) => s.length);
  const busy = useUi((s) => s.recording || s.playing);
  const set = (patch: Partial<StepLength>) => {
    const next = { ...length, ...patch };
    ui.setState({ length: next });
    announce(session, lengthName(lengthTicks(next)));
  };
  return (
    <div className="step-bar">
      <div className="step-lengths" role="group" aria-label="Note length">
        {LENGTHS.map((l) => (
          <button
            key={l.base}
            className={`step-btn ${length.base === l.base ? "is-on" : ""} ${l.wide ? "is-wide-only" : ""}`}
            aria-pressed={length.base === l.base}
            aria-label={l.name}
            title={l.name}
            onClick={() => set({ base: l.base })}
          >
            {l.text}
          </button>
        ))}
        <button
          className={`step-btn ${length.dotted ? "is-on" : ""}`}
          aria-pressed={length.dotted}
          aria-label="Dotted"
          title="Dotted: half as long again"
          onClick={() => set({ dotted: !length.dotted })}
        >
          <span aria-hidden>•</span>
        </button>
        <button
          className={`step-btn ${length.triplet ? "is-on" : ""}`}
          aria-pressed={length.triplet}
          aria-label="Triplet"
          title="Triplet: three in the time of two"
          onClick={() => set({ triplet: !length.triplet })}
        >
          <span aria-hidden>3</span>
        </button>
      </div>
      <button
        className="step-btn"
        aria-label="Rest"
        title="Rest: move on without writing a note"
        disabled={busy}
        onClick={() => keys.rest()}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
          <path d="M5 12h14" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
        </svg>
      </button>
      <button
        className="step-btn"
        aria-label="Tie"
        title="Tie: hold the note just written for longer"
        disabled={busy}
        onClick={() => keys.tie()}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
          <path d="M4 9c4 7 12 7 16 0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </button>
      <button
        className="step-btn"
        aria-label="Take back the last step"
        title="Take back the last step (Backspace)"
        disabled={busy}
        onClick={() => keys.backspace() || announce(session, "Nothing to take back")}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
          <path
            d="M9 7l-5 5 5 5M4.5 12H15a4.5 4.5 0 0 1 0 9h-2"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
