import { useEffect, useState } from "react";
import { ticksPerBeat } from "../music/time";
import type { Hand } from "../song/types";
import {
  copySelection,
  cutSelection,
  deleteSelection,
  describeSelection,
  duplicateSelection,
  legato,
  paste,
  quantizeSelection,
  readClip,
  selected,
  setHand,
  setTiming,
  setVelocity,
  transpose,
} from "./actions";
import { useProject, useSession, useUi } from "./context";

/** A number that is written when the field is left or Enter is pressed: one edit, not one per key. */
function NumberField(props: {
  label: string;
  value: number;
  min: number;
  max?: number;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(props.value));
  useEffect(() => setDraft(String(props.value)), [props.value]);
  const commit = () => {
    const v = Math.round(Number(draft));
    if (!Number.isFinite(v) || v < props.min || (props.max !== undefined && v > props.max))
      return setDraft(String(props.value));
    if (v !== props.value) props.onCommit(v);
  };
  return (
    <label className="num-field">
      <span>{props.label}</span>
      <input
        className="input"
        inputMode="numeric"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}

/** The selection, and everything that can be done to it without touching the canvas. */
export function Inspector() {
  const session = useSession();
  const project = useProject();
  // Re-read whenever the selection or the project changes.
  useUi((s) => s.selection);
  const held = selected(session);
  const time = session.playback.time();
  const one = held.length === 1 ? held[0].note : null;
  const [velocity, setVelocityDraft] = useState<number | null>(null);

  const meanVelocity = held.length ? held.reduce((a, h) => a + h.note.vel, 0) / held.length : 0.8;
  const shownVelocity = Math.round((velocity ?? meanVelocity) * 100);
  const commitVelocity = () => {
    if (velocity === null) return;
    setVelocity(session, velocity);
    setVelocityDraft(null);
  };
  const hands = new Set(held.map((h) => h.note.hand ?? "auto"));
  const hand = hands.size === 1 ? [...hands][0] : null;
  const canPaste = !!readClip();

  if (!held.length) {
    return (
      <div className="inspector">
        <p className="hint-text">
          Nothing is selected. Tap a note with the Select tool, or press S to select the notes at the cursor.
        </p>
        <div className="inspector-row">
          <button className="btn" disabled={!canPaste} onClick={() => paste(session)}>
            Paste at the cursor
          </button>
        </div>
      </div>
    );
  }

  const pos = one ? time.positionAt(one.tick) : null;
  const meter = one ? time.meterAt(one.tick) : null;
  const beat = meter ? ticksPerBeat(meter) : 480;

  return (
    <div className="inspector">
      <p className="inspector-what">{describeSelection(session)}</p>

      <div className="inspector-row" role="group" aria-label="Pitch">
        <span className="inspector-label">Pitch</span>
        <button className="btn" aria-label="Down an octave" onClick={() => transpose(session, -12)}>
          −12
        </button>
        <button className="btn" aria-label="Down a semitone" onClick={() => transpose(session, -1)}>
          −1
        </button>
        <button className="btn" aria-label="Up a semitone" onClick={() => transpose(session, 1)}>
          +1
        </button>
        <button className="btn" aria-label="Up an octave" onClick={() => transpose(session, 12)}>
          +12
        </button>
      </div>

      {one && pos && meter && (
        <>
          <div className="inspector-row" role="group" aria-label="Start">
            <span className="inspector-label">Start</span>
            <NumberField
              label="Bar"
              value={pos.bar}
              min={1}
              onCommit={(bar) =>
                setTiming(session, one.id, { tick: time.tickOfBar(bar) + (pos.beat - 1) * beat + pos.tick })
              }
            />
            <NumberField
              label="Beat"
              value={pos.beat}
              min={1}
              max={meter.numerator}
              onCommit={(b) =>
                setTiming(session, one.id, { tick: time.tickOfBar(pos.bar) + (b - 1) * beat + pos.tick })
              }
            />
            <NumberField
              label="Tick"
              value={pos.tick}
              min={0}
              max={beat - 1}
              onCommit={(t) =>
                setTiming(session, one.id, { tick: time.tickOfBar(pos.bar) + (pos.beat - 1) * beat + t })
              }
            />
          </div>
          <div className="inspector-row" role="group" aria-label="Length">
            <span className="inspector-label">Length</span>
            <NumberField
              label="Beats"
              value={Math.floor(one.dur / beat)}
              min={0}
              onCommit={(b) =>
                b * beat + (one.dur % beat) > 0 && setTiming(session, one.id, { dur: b * beat + (one.dur % beat) })
              }
            />
            <NumberField
              label="Ticks"
              value={one.dur % beat}
              min={0}
              max={beat - 1}
              onCommit={(t) =>
                Math.floor(one.dur / beat) * beat + t > 0 &&
                setTiming(session, one.id, { dur: Math.floor(one.dur / beat) * beat + t })
              }
            />
          </div>
        </>
      )}

      <label className="inspector-row inspector-slider">
        <span className="inspector-label">Velocity</span>
        <input
          type="range"
          min={5}
          max={100}
          value={shownVelocity}
          aria-label="Velocity"
          aria-valuetext={`${shownVelocity} percent`}
          onChange={(e) => setVelocityDraft(Number(e.target.value) / 100)}
          onPointerUp={commitVelocity}
          onKeyUp={commitVelocity}
          onBlur={commitVelocity}
        />
        <span className="mono">{shownVelocity}%</span>
      </label>

      <div className="inspector-row" role="group" aria-label="Hand in Practice">
        <span className="inspector-label">Hand</span>
        {(
          [
            ["auto", "Auto", undefined],
            ["L", "Left", "L"],
            ["R", "Right", "R"],
          ] as [string, string, Hand | undefined][]
        ).map(([id, label, value]) => (
          <button
            key={id}
            className={`chip ${hand === id ? "is-on" : ""}`}
            aria-pressed={hand === id}
            title={
              id === "auto" ? `Whatever the track says (${held[0].track.hand === "L" ? "left" : "right"})` : undefined
            }
            onClick={() => setHand(session, value)}
          >
            {label}
          </button>
        ))}
      </div>

      {held.length > 1 && (
        <div className="inspector-row">
          <button className="btn" onClick={() => quantizeSelection(session)}>
            Quantize
          </button>
          <button className="btn" title="Hold each note until the next begins" onClick={() => legato(session)}>
            Legato
          </button>
        </div>
      )}
      {held.length === 1 && (
        <div className="inspector-row">
          <button className="btn" onClick={() => quantizeSelection(session)}>
            Quantize
          </button>
        </div>
      )}

      <div className="inspector-row">
        <button className="btn" onClick={() => cutSelection(session)}>
          Cut
        </button>
        <button className="btn" onClick={() => copySelection(session)}>
          Copy
        </button>
        <button className="btn" disabled={!canPaste} onClick={() => paste(session)}>
          Paste
        </button>
        <button className="btn" onClick={() => duplicateSelection(session)}>
          Duplicate
        </button>
        <button className="btn is-danger" onClick={() => deleteSelection(session)}>
          Delete
        </button>
      </div>
      <p className="hint-text">In “{project.title}”: paste goes to the cursor, on the track that is lit below.</p>
    </div>
  );
}
