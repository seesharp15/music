import { useProject, useSession, useUi } from "./context";
import type { UiState } from "./ui-store";

/** True when nothing has been written yet: no notes, chords, hits or patterns. */
export function isEmptyProject(p: ReturnType<typeof useProject>): boolean {
  return (
    p.chords.length === 0 &&
    !p.pending &&
    p.tracks.every((t) => (t.kind === "notes" ? t.notes.length === 0 : t.hits.length === 0 && t.clips.length === 0))
  );
}

/**
 * An empty song does not open on a blank canvas: it offers the ways to begin. Later stages add
 * theirs ("Hum it", "Tap a beat", "Bring in a recording") to the same list.
 */
export function FirstRun() {
  const { ui, readOnly } = useSession();
  const project = useProject();
  const started = useUi((s) => s.started);
  if (readOnly || started || !isEmptyProject(project)) return null;
  const melody = project.tracks.find((t) => t.kind === "notes" && t.role === "melody")?.id;
  const begin = (patch: Partial<UiState>) =>
    ui.setState({ started: true, ...(melody ? { activeTrack: melody } : {}), ...patch });
  return (
    <div className="first-run" role="group" aria-label="How would you like to start?">
      <p className="first-run-title">How would you like to start?</p>
      <button className="first-run-choice" onClick={() => begin({ input: "step", tool: "select" })}>
        <strong>Tap it in, one note at a time</strong>
        <span>Press a key and it lands at the line. No timing needed.</span>
      </button>
      <button
        className="first-run-choice"
        onClick={() =>
          begin({ input: "step", recording: false, sheet: null, announcement: "Press record, then play." })
        }
        data-choice="live"
      >
        <strong>Play it live</strong>
        <span>Press record and play against the click.</span>
      </button>
      <button className="first-run-choice" onClick={() => begin({ sheet: "chords", chordTick: 0 })}>
        <strong>Start with chords</strong>
        <span>Choose the chords first and write over them.</span>
      </button>
    </div>
  );
}
