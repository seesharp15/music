import { useEffect, useRef, useState } from "react";
import { midiSupported } from "../audio/midi-in";
import { useProject, useSession, useUi } from "./context";

/** Record and play, and the switches that go with playing and with keys. */
export function Transport() {
  const session = useSession();
  const { playback, keys } = session;
  const playing = useUi((s) => s.playing);
  const recording = useUi((s) => s.recording);
  return (
    <div className="transport" role="group" aria-label="Transport">
      {!session.readOnly && (
        <button
          className={`tool-btn record-btn ${recording ? "is-on" : ""}`}
          aria-pressed={recording}
          aria-label={recording ? "Stop recording" : "Record"}
          title={recording ? "Stop recording (Enter)" : "Record what you play against the click (Enter)"}
          onClick={() => keys.toggleRecord()}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
            {recording ? (
              <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
            ) : (
              <circle cx="12" cy="12" r="7" fill="currentColor" />
            )}
          </svg>
        </button>
      )}
      <button
        className={`tool-btn play-btn-small ${playing && !recording ? "is-on" : ""}`}
        aria-label={playing ? "Stop" : "Play from the cursor"}
        title={playing ? "Stop (Space)" : "Play from the cursor (Space)"}
        onClick={() => (recording ? keys.stopRecording() : playback.toggle())}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
          {playing ? (
            <path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" />
          ) : (
            <path d="M8 5v14l11-7z" fill="currentColor" />
          )}
        </svg>
      </button>
      <TransportOptions />
      {playing && recording && (
        <span className="recording-note" role="status">
          Recording
        </span>
      )}
    </div>
  );
}

/** The tempo button, and behind it everything about how playing and keys behave. */
function TransportOptions() {
  const session = useSession();
  const { ui, keys } = session;
  const project = useProject();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useUi((s) => s.input);
  const typing = useUi((s) => s.typing);
  const octave = useUi((s) => s.typingOctave);
  const countIn = useUi((s) => s.countIn);
  const keepTiming = useUi((s) => s.keepTiming);
  const metronome = useUi((s) => s.metronome);
  const midi = useUi((s) => s.midi);

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

  const bpm = Math.round(project.tempo[0].bpm);
  const check = (label: string, checked: boolean, onChange: (v: boolean) => void, hint?: string) => (
    <label className="view-check" title={hint}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );

  return (
    <div className="transport-options" ref={wrap}>
      <button
        className="tempo-btn"
        aria-expanded={open}
        aria-label={`Tempo ${bpm}: playing and keys`}
        title="Tempo, the click, and how the keys behave"
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden>♩</span>
        <span className="mono">{bpm}</span>
        {typing && <span className="tempo-flag">abc</span>}
      </button>
      {open && (
        <div className="view-panel opens-up" role="group" aria-label="Playing and keys">
          {check("Metronome", metronome, (v) => ui.setState({ metronome: v }), "A click on every beat while playing")}
          {!session.readOnly && (
            <>
              {check(
                "Count-in before recording",
                countIn,
                (v) => ui.setState({ countIn: v }),
                "One bar of clicks before a recording starts",
              )}
              {check(
                "Keep my timing",
                keepTiming,
                (v) => ui.setState({ keepTiming: v }),
                "Play a recording back as it was played, not exactly on the grid",
              )}
              {check(
                "Keys write notes",
                input === "step",
                (v) => ui.setState({ input: v ? "step" : "listen" }),
                "Off: keys only make sound, for trying things out",
              )}
            </>
          )}
          {check(
            `Musical typing${typing ? ` (octave ${octave})` : ""}`,
            typing,
            (v) => ui.setState({ typing: v }),
            "Letter keys play notes: A S D F G H J K are the white keys from C",
          )}
          {midiSupported() && (
            <>
              {check("MIDI keyboard", midi.on, (v) => (v ? void keys.connectMidi() : keys.disconnectMidi()))}
              {midi.on && (
                <p className="hint-text" role="status">
                  {midi.devices.length ? midi.devices.join(", ") : "No keyboard is connected yet."}
                </p>
              )}
            </>
          )}
          {midi.error && (
            <p className="hint-text" role="alert">
              {midi.error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
