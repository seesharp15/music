import { useEffect, useRef, useState } from "react";
import type { Grid } from "../music/quantize";
import { detectKey, keyName, spellPitchClass, pitchClassOf, type Mode } from "../music/theory";
import type { MeterEvent } from "../music/time";
import type { EditOp, Project } from "../project/types";
import { announce, edit } from "./actions";
import { useProject, useSession, useUi } from "./context";
import { barsOf } from "./sections/ops";
import { addTap, MAX_BPM, MIN_BPM, tappedBpm } from "./tap";

type SongPatch = Extract<EditOp, { op: "patchSong" }>["patch"];

/** Apply one change to the song's own fields as one undo step. */
export function usePatchSong() {
  const session = useSession();
  return (patch: SongPatch, label: string, said?: string) => {
    if (edit(session, [{ op: "patchSong", patch }], label) && said) announce(session, said);
  };
}

/** A text field that writes when it loses focus or Enter is pressed, so typing is one undo step. */
export function CommitField(props: {
  label: string;
  value: string;
  placeholder?: string;
  onCommit: (value: string) => void;
  allowEmpty?: boolean;
  /** The id of a <datalist> of suggestions. */
  list?: string;
  numeric?: boolean;
}) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  const commit = () => {
    const v = draft.trim();
    if (v === props.value) return;
    if (!v && !props.allowEmpty) return setDraft(props.value);
    props.onCommit(v);
    // If what was typed was refused, show what is really there.
    setDraft(props.value);
  };
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        className="input"
        value={draft}
        placeholder={props.placeholder}
        list={props.list}
        inputMode={props.numeric ? "numeric" : undefined}
        maxLength={120}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}

const METERS: [number, MeterEvent["denominator"]][] = [
  [2, 4],
  [3, 4],
  [4, 4],
  [5, 4],
  [6, 8],
  [7, 8],
  [12, 8],
];
const MODES: { id: Mode; label: string }[] = [
  { id: "major", label: "major" },
  { id: "minor", label: "minor" },
  { id: "dorian", label: "Dorian" },
  { id: "mixolydian", label: "Mixolydian" },
  { id: "lydian", label: "Lydian" },
  { id: "phrygian", label: "Phrygian" },
];
const SNAPS: { id: Grid; label: string }[] = [
  { id: 4, label: "Quarter notes" },
  { id: 8, label: "Eighths" },
  { id: 16, label: "Sixteenths" },
  { id: 32, label: "Thirty-seconds" },
  { id: "8t", label: "Eighth triplets" },
  { id: "16t", label: "Sixteenth triplets" },
];
const TAP_SETTLE_MS = 900;

/** The tempo the song starts at, keeping any later tempo changes. */
export function tempoPatch(project: Project, bpm: number): SongPatch {
  const clean = Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
  return { tempo: [{ tick: 0, bpm: clean }, ...project.tempo.slice(1)] };
}

/** Tempo: type it, nudge it, or tap it. Tapping sets the tempo once the taps stop: one undo step. */
export function TempoControl() {
  const project = useProject();
  const patch = usePatchSong();
  const bpm = Math.round(project.tempo[0].bpm);
  const taps = useRef<number[]>([]);
  const timer = useRef(0);
  const [tapped, setTapped] = useState<number | null>(null);
  const latest = useRef(project);
  latest.current = project;
  useEffect(() => () => clearTimeout(timer.current), []);

  const set = (value: number) => {
    const next = tempoPatch(latest.current, value);
    if (next.tempo![0].bpm !== Math.round(latest.current.tempo[0].bpm))
      patch(next, "Set tempo", `Tempo ${next.tempo![0].bpm}`);
  };
  const tap = (now: number) => {
    taps.current = addTap(taps.current, now);
    const heard = tappedBpm(taps.current);
    setTapped(heard);
    clearTimeout(timer.current);
    if (heard === null) return;
    timer.current = window.setTimeout(() => {
      set(heard);
      setTapped(null);
      taps.current = [];
    }, TAP_SETTLE_MS);
  };

  return (
    <div className="tempo-control" role="group" aria-label="Tempo">
      <CommitField
        label="Tempo"
        value={String(bpm)}
        numeric
        onCommit={(v) => Number.isFinite(Number(v)) && set(Number(v))}
      />
      <button className="view-step" aria-label="Slower" onClick={() => set(bpm - 1)}>
        −
      </button>
      <button className="view-step" aria-label="Faster" onClick={() => set(bpm + 1)}>
        +
      </button>
      <button
        className="btn tap-btn"
        onPointerDown={(e) => tap(e.timeStamp)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !e.repeat && tap(e.timeStamp)}
      >
        {tapped ? `Tap · ${tapped}` : "Tap tempo"}
      </button>
    </div>
  );
}

/** Song settings: title and author, tempo, time signature, key, swing, snap and length. */
export function SongSettings() {
  const session = useSession();
  const { ui, playback } = session;
  const project: Project = useProject();
  const patch = usePatchSong();
  const snap = useUi((s) => s.snap);
  const meter = project.meter[0];
  const key = project.key[0] ?? null;
  const time = playback.time();
  const bars = barsOf({ tick: 0, dur: project.lengthTicks }, time);
  const noteCount = project.tracks.reduce((n, t) => n + (t.kind === "notes" ? t.notes.length : 0), 0);
  const [swing, setSwing] = useState<number | null>(null);
  const swingShown = Math.round((swing ?? project.swing.amount) * 100);

  const setKey = (tonic: string, mode: Mode) =>
    patch({ key: [{ tick: 0, tonic, mode }, ...project.key.slice(1)] }, "Set key", `Key: ${keyName({ tonic, mode })}`);
  const detect = () => {
    const notes = project.tracks.flatMap((t) =>
      t.kind === "notes" ? t.notes.map((n) => ({ pitch: n.pitch, dur: n.dur, tick: n.tick })) : [],
    );
    const best = detectKey(notes)[0];
    if (!best) return announce(session, "There are no notes to work a key out from yet");
    setKey(best.key.tonic, best.key.mode);
  };
  const commitSwing = () => {
    if (swing === null) return;
    const amount = swing;
    setSwing(null);
    if (amount !== project.swing.amount) patch({ swing: { ...project.swing, amount } }, "Set swing");
  };

  return (
    <div className="settings-form">
      <CommitField label="Title" value={project.title} onCommit={(title) => patch({ title }, "Rename song")} />
      <CommitField
        label="Written by"
        value={project.author ?? ""}
        placeholder="Your name"
        allowEmpty
        onCommit={(author) => patch({ author: author || undefined }, "Change author")}
      />
      <TempoControl />

      <label className="field">
        <span>Time signature</span>
        <select
          className="select"
          aria-label="Time signature"
          value={`${meter.numerator}/${meter.denominator}`}
          onChange={(e) => {
            const [numerator, denominator] = e.target.value.split("/").map(Number) as [
              number,
              MeterEvent["denominator"],
            ];
            patch(
              { meter: [{ tick: 0, numerator, denominator }, ...project.meter.slice(1)] },
              "Set time signature",
              `${numerator}/${denominator}`,
            );
          }}
        >
          {METERS.map(([n, d]) => (
            <option key={`${n}/${d}`} value={`${n}/${d}`}>
              {n}/{d}
            </option>
          ))}
          {!METERS.some(([n, d]) => n === meter.numerator && d === meter.denominator) && (
            <option value={`${meter.numerator}/${meter.denominator}`}>
              {meter.numerator}/{meter.denominator}
            </option>
          )}
        </select>
      </label>

      <div className="settings-row" role="group" aria-label="Key">
        <label className="field">
          <span>Key</span>
          <select
            className="select"
            aria-label="Key note"
            value={key ? pitchClassOf(key.tonic) : -1}
            onChange={(e) => {
              const pc = Number(e.target.value);
              if (pc < 0) patch({ key: [] }, "Clear key", "No key");
              else setKey(spellPitchClass(pc, key ? { tonic: "C", mode: key.mode } : undefined), key?.mode ?? "major");
            }}
          >
            <option value={-1}>None</option>
            {Array.from({ length: 12 }, (_, pc) => (
              <option key={pc} value={pc}>
                {spellPitchClass(pc)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Mode</span>
          <select
            className="select"
            aria-label="Mode"
            value={key?.mode ?? "major"}
            disabled={!key}
            onChange={(e) => key && setKey(key.tonic, e.target.value as Mode)}
          >
            {MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" disabled={noteCount === 0} onClick={detect}>
          Detect from my notes
        </button>
      </div>

      <div className="settings-row">
        <label className="field settings-swing">
          <span>Swing · {swingShown}%</span>
          <input
            type="range"
            min={50}
            max={75}
            value={swingShown}
            aria-label="Swing"
            aria-valuetext={swingShown === 50 ? "Straight" : `${swingShown} percent`}
            onChange={(e) => setSwing(Number(e.target.value) / 100)}
            onPointerUp={commitSwing}
            onKeyUp={commitSwing}
            onBlur={commitSwing}
          />
        </label>
        <label className="field">
          <span>Swung notes</span>
          <select
            className="select"
            aria-label="Which notes swing"
            value={project.swing.unit}
            onChange={(e) =>
              patch({ swing: { ...project.swing, unit: Number(e.target.value) as 8 | 16 } }, "Set swing")
            }
          >
            <option value={8}>Eighths</option>
            <option value={16}>Sixteenths</option>
          </select>
        </label>
      </div>

      <div className="settings-row">
        <label className="field">
          <span>Snap to</span>
          <select
            className="select"
            aria-label="Snap to"
            value={String(snap)}
            onChange={(e) => ui.setState({ snap: SNAPS.find((s) => String(s.id) === e.target.value)!.id })}
          >
            {SNAPS.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <CommitField
          label="Length in bars"
          value={String(bars)}
          numeric
          onCommit={(v) => {
            const n = Math.round(Number(v));
            if (!Number.isFinite(n) || n < 1 || n > 2000) return;
            patch({ lengthTicks: time.tickOfBar(n + 1) }, "Set song length");
          }}
        />
      </div>
      <p className="hint-text">
        The song grows by itself as notes are written past its end; it cannot be made shorter than its last note.
      </p>
    </div>
  );
}
