import { useState } from "react";
import {
  borrowedChords,
  CHORD_QUALITIES,
  chordAt,
  detectKey,
  diatonicChords,
  formatChord,
  keyName,
  romanOf,
  spellPitchClass,
  type Key,
} from "../../music/theory";
import { RESTRIKES, voiceChord, type Restrike } from "../../music/voicing";
import { announce, edit } from "../actions";
import { useProject, useSession, useUi } from "../context";
import { positionName } from "../describe";
import { chordsTrack, chordTicks, notesUnder, setChord, untouched, writeToTrack, type ChordLength } from "./edit";

const LENGTHS: { id: ChordLength; label: string }[] = [
  { id: "bar", label: "A bar" },
  { id: "half", label: "Half a bar" },
  { id: "beat", label: "A beat" },
];
const STRUCK: Record<Restrike, string> = { hold: "Held", bar: "Every bar", beat: "Every beat" };
const QUALITY_LABEL: Record<string, string> = { "": "major", m: "minor" };
const ENOUGH_NOTES = 8;

/**
 * The chord picker: the chords of the key first, then the usual visitors, then anything at all.
 * Tapping a chord plays it, sets it where the picker is, and moves the picker on by its length.
 */
export function ChordPicker() {
  const session = useSession();
  const { ui, store, playback } = session;
  const project = useProject();
  const tick = useUi((s) => s.chordTick) ?? 0;
  const [length, setLength] = useState<ChordLength>("bar");
  const [mode, setMode] = useState<Restrike>("hold");
  const [more, setMore] = useState(false);
  const [rewrite, setRewrite] = useState(true);
  const [root, setRoot] = useState(0);
  const [quality, setQuality] = useState("");
  const [bass, setBass] = useState(-1);

  const time = playback.time();
  const hasKey = project.key.length > 0;
  const key: Key | null = hasKey ? keyOf(project.key, tick) : null;
  const dur = chordTicks(time, tick, length);
  const here = chordAt(project, tick);
  const track = chordsTrack(project);
  const canRewrite = !!here && here.tick === tick && here.dur === dur && untouched(project, here, time) !== null;
  const noteCount = project.tracks.reduce((n, t) => n + (t.kind === "notes" ? t.notes.length : 0), 0);

  const goTo = (to: number) => {
    const next = Math.max(0, to);
    ui.setState({ chordTick: next, cursor: next });
  };

  const choose = (symbol: string) => {
    const change = setChord(project, tick, dur, symbol, { rewrite: rewrite && canRewrite });
    if (!change) return;
    // Hear it, on the Chords track's sound, near the chord before it.
    const before = [...project.chords].reverse().find((c) => c.tick < tick);
    const prev = before && track ? notesUnder(track, before).map((n) => n.pitch) : null;
    playback.audition(voiceChord(symbol, prev?.length ? prev : null), track?.id ?? ui.getState().activeTrack, 0.6);
    if (!edit(session, change.ops, change.label)) return;
    announce(session, `${symbol} at ${positionName(project, tick)}${change.rewrote ? "; its notes rewritten" : ""}`);
    goTo(tick + dur);
  };

  const remove = () => {
    if (!here) return;
    const change = setChord(project, here.tick, here.dur, null);
    if (change && edit(session, change.ops, change.label)) announce(session, `Removed ${here.symbol}`);
  };

  const write = () => {
    const w = writeToTrack(store.getState().project, mode);
    if (!w)
      return announce(
        session,
        project.chords.length ? "There is no unlocked Chords track to write to" : "There are no chords to write yet",
      );
    if (!w.ops.length) return announce(session, "Every chord's notes have been changed by hand: nothing was written");
    if (!edit(session, w.ops, "Write chords to track")) return;
    announce(
      session,
      `Wrote ${w.written} ${w.written === 1 ? "chord" : "chords"} to the track${w.kept ? `; left ${w.kept} alone, changed by hand` : ""}`,
    );
  };

  const detect = () => {
    const notes = project.tracks.flatMap((t) =>
      t.kind === "notes" ? t.notes.map((n) => ({ pitch: n.pitch, dur: n.dur, tick: n.tick })) : [],
    );
    const best = detectKey(notes)[0];
    if (!best) return;
    if (edit(session, [{ op: "patchSong", patch: { key: [{ tick: 0, ...best.key }] } }], "Set key")) {
      announce(session, `Key set to ${keyName(best.key)}`);
    }
  };

  const symbolOf = () =>
    formatChord({
      root: spellPitchClass(root, key ?? undefined),
      quality,
      bass: bass >= 0 ? spellPitchClass(bass, key ?? undefined) : undefined,
    });

  const chordButton = (symbol: string, big: boolean) => (
    <button
      key={symbol}
      className={`chord-btn ${big ? "is-big" : ""} ${here?.symbol === symbol && here.tick === tick ? "is-on" : ""}`}
      aria-label={`${symbol}${key && romanOf(symbol, key) ? `, ${romanOf(symbol, key)}` : ""}`}
      onClick={() => choose(symbol)}
    >
      <strong>{symbol}</strong>
      {key && <span>{romanOf(symbol, key) ?? ""}</span>}
    </button>
  );

  return (
    <div className="chord-picker">
      <div className="chord-where">
        <button
          className="view-step"
          aria-label={`Back ${LENGTHS.find((l) => l.id === length)!.label.toLowerCase()}`}
          onClick={() => goTo(tick - dur)}
        >
          ◀
        </button>
        <p role="status">
          <strong>{capital(positionName(project, tick))}</strong>
          <span>{here ? `${here.symbol} is here` : "No chord here yet"}</span>
        </p>
        <button
          className="view-step"
          aria-label={`On ${LENGTHS.find((l) => l.id === length)!.label.toLowerCase()}`}
          onClick={() => goTo(tick + dur)}
        >
          ▶
        </button>
      </div>

      <div className="chord-row" role="group" aria-label="How long the chord lasts">
        {LENGTHS.map((l) => (
          <button
            key={l.id}
            className={`chip ${length === l.id ? "is-on" : ""}`}
            aria-pressed={length === l.id}
            onClick={() => setLength(l.id)}
          >
            {l.label}
          </button>
        ))}
        <button className="chip" disabled={!here} onClick={remove}>
          Remove
        </button>
      </div>

      {key ? (
        <>
          <div className="chord-grid" role="group" aria-label={`Chords of ${keyName(key)}`}>
            {diatonicChords(key).map((c) => chordButton(c, true))}
          </div>
          <div className="chord-grid is-small" role="group" aria-label="Borrowed and visiting chords">
            {borrowedChords(key).map((c) => chordButton(c, false))}
          </div>
        </>
      ) : (
        <div className="chord-nokey">
          <p className="hint-text">
            This song has no key set, so any chord can go anywhere.
            {noteCount >= ENOUGH_NOTES ? " There are enough notes to work one out." : ""}
          </p>
          {noteCount >= ENOUGH_NOTES && (
            <button className="btn" onClick={detect}>
              Detect key
            </button>
          )}
        </div>
      )}

      {key && (
        <button className="collapse-btn" aria-expanded={more} onClick={() => setMore((m) => !m)}>
          {more ? "▾" : "▸"} More chords
        </button>
      )}
      {(more || !key) && (
        <div className="chord-any" role="group" aria-label="Any chord">
          <label className="field">
            <span>Root</span>
            <select className="select" aria-label="Root" value={root} onChange={(e) => setRoot(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, pc) => (
                <option key={pc} value={pc}>
                  {spellPitchClass(pc, key ?? undefined)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Kind</span>
            <select className="select" aria-label="Kind" value={quality} onChange={(e) => setQuality(e.target.value)}>
              {CHORD_QUALITIES.map((q) => (
                <option key={q} value={q}>
                  {QUALITY_LABEL[q] ?? q}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Bass note</span>
            <select
              className="select"
              aria-label="Bass note"
              value={bass}
              onChange={(e) => setBass(Number(e.target.value))}
            >
              <option value={-1}>The root</option>
              {Array.from({ length: 12 }, (_, pc) => (
                <option key={pc} value={pc}>
                  {spellPitchClass(pc, key ?? undefined)}
                </option>
              ))}
            </select>
          </label>
          <button className="btn is-primary" onClick={() => choose(symbolOf())}>
            Set {symbolOf()}
          </button>
        </div>
      )}

      {canRewrite && (
        <label className="view-check">
          <input type="checkbox" checked={rewrite} onChange={(e) => setRewrite(e.target.checked)} />
          Rewrite this chord’s notes on the {track?.name ?? "Chords"} track too
        </label>
      )}

      <div className="chord-write">
        <label className="field">
          <span>Struck</span>
          <select
            className="select"
            value={mode}
            aria-label="How the chords are struck"
            onChange={(e) => setMode(e.target.value as Restrike)}
          >
            {RESTRIKES.map((r) => (
              <option key={r} value={r}>
                {STRUCK[r]}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn"
          disabled={!project.chords.length}
          onClick={write}
          title="Turn the chord symbols into notes on the Chords track"
        >
          Write to track
        </button>
      </div>
    </div>
  );
}

function keyOf(keys: { tick: number; tonic: string; mode: Key["mode"] }[], tick: number): Key {
  let found = keys[0];
  for (const k of keys) if (k.tick <= tick) found = k;
  return { tonic: found.tonic, mode: found.mode };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
