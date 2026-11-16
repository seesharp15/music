import { select } from "./actions";
import { useSession, useUi } from "./context";

/**
 * What is selected, floating over the canvas while anything is: opens the inspector, switches
 * "add to selection" on (so taps collect notes, as Shift does), and lets go of the selection.
 */
export function SelectionChip() {
  const session = useSession();
  const { ui } = session;
  const count = useUi((s) => s.selection.length);
  const adding = useUi((s) => s.addToSelection);
  const inspecting = useUi((s) => s.sheet === "inspector");
  if (session.readOnly || (count === 0 && !adding)) return null;
  return (
    <div className="selection-chip" role="group" aria-label="Selection">
      <button
        className="selection-main"
        aria-pressed={inspecting}
        aria-label={`Selection: ${count} ${count === 1 ? "note" : "notes"}`}
        title="Pitch, timing, velocity and hand of the selected notes"
        onClick={() => ui.setState({ sheet: inspecting ? null : "inspector" })}
      >
        {count} {count === 1 ? "note" : "notes"}
      </button>
      <button
        className={`selection-add ${adding ? "is-on" : ""}`}
        aria-pressed={adding}
        aria-label="Add to selection"
        title="Add to selection: each tap adds a note to those selected"
        onClick={() => ui.setState({ addToSelection: !adding })}
      >
        <span aria-hidden>+</span>
      </button>
      <button
        className="selection-clear"
        aria-label="Clear the selection"
        onClick={() => {
          ui.setState({ addToSelection: false });
          select(session, []);
        }}
      >
        <span aria-hidden>✕</span>
      </button>
    </div>
  );
}
