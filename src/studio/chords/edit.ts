/**
 * Editing the chord track, as edit operations: set or remove a chord at a place, and write the
 * chords out as notes. Pure functions of the project; the picker applies what they return.
 */
import { canonicalChord } from "../../music/theory";
import { makeTimeMap, ticksPerBeat, type TimeMap } from "../../music/time";
import { chordNotes, realizeChords, voiceChord, writtenAs, type Restrike } from "../../music/voicing";
import type { ChordEvent, EditOp, NoteTrack, PNote, Project } from "../../project/types";

export type ChordLength = "bar" | "half" | "beat";

/** The track "Write to track" writes to: the first unlocked track whose role is chords. */
export function chordsTrack(project: Project): NoteTrack | null {
  return project.tracks.find((t): t is NoteTrack => t.kind === "notes" && t.role === "chords" && !t.locked) ?? null;
}

/** How many ticks a chord of the chosen length lasts at a place in the song. */
export function chordTicks(time: TimeMap, tick: number, length: ChordLength): number {
  const bar = time.ticksPerBarAt(tick);
  if (length === "bar") return bar;
  const beat = ticksPerBeat(time.meterAt(tick));
  // Half a bar is a whole number of beats where the bar divides in two; otherwise the nearer half.
  return length === "half" ? Math.max(beat, Math.round(bar / 2 / beat) * beat) : beat;
}

/** The beat line at or before a tick: where a tap on the chord gutter puts the picker. */
export function beatLine(time: TimeMap, tick: number): number {
  const pos = time.positionAt(Math.max(0, tick));
  return Math.max(0, tick) - pos.tick;
}

/** A chord's notes on a track: those that start while it lasts. */
export function notesUnder(track: NoteTrack, chord: Pick<ChordEvent, "tick" | "dur">): PNote[] {
  return track.notes.filter((n) => n.tick >= chord.tick && n.tick < chord.tick + chord.dur);
}

/**
 * How a chord's notes on the Chords track were struck, if they are still exactly what Write to
 * track wrote for it; null if there are none, or the author has changed them.
 */
export function untouched(
  project: Project,
  chord: ChordEvent,
  time = makeTimeMap(project.tempo, project.meter),
): Restrike | null {
  const track = chordsTrack(project);
  if (!track) return null;
  return writtenAs(notesUnder(track, chord), chord, time);
}

/** The pitches sounding on the Chords track just before a tick: what the next chord should stay near. */
function voicingBefore(project: Project, tick: number): number[] | null {
  const track = chordsTrack(project);
  const before = [...project.chords].reverse().find((c) => c.tick < tick);
  if (!track || !before) return null;
  const pitches = [...new Set(notesUnder(track, before).map((n) => n.pitch))].sort((a, b) => a - b);
  return pitches.length ? pitches : voiceChord(before.symbol);
}

export interface ChordEdit {
  ops: EditOp[];
  label: string;
  /** The notes under the chord were rewritten to match. */
  rewrote: boolean;
}

/**
 * Put a chord at `tick` for `dur` ticks (or with `symbol` null, clear that stretch). Whatever was
 * there gives way: a chord running in from before is cut short, one running on past the end keeps
 * its tail. With `rewrite`, if the chord replaced had notes on the Chords track that are still
 * exactly as Write to track wrote them, they are rewritten for the new chord.
 */
export function setChord(
  project: Project,
  tick: number,
  dur: number,
  symbol: string | null,
  opts: { rewrite?: boolean } = {},
): ChordEdit | null {
  const canonical = symbol === null ? null : canonicalChord(symbol);
  if (symbol !== null && !canonical) return null;
  const end = tick + dur;
  const time = makeTimeMap(project.tempo, project.meter);
  const piece = (c: ChordEvent, from: number, to: number): Omit<ChordEvent, "id"> => {
    const { id: _id, ...rest } = c;
    return { ...rest, tick: from, dur: to - from };
  };

  const chords: Omit<ChordEvent, "id">[] = [];
  let start = tick;
  let tail = false;
  for (const c of project.chords) {
    const cEnd = c.tick + c.dur;
    if (cEnd <= tick || c.tick >= end) continue;
    if (c.tick < tick) {
      start = c.tick;
      chords.push(piece(c, c.tick, tick));
    }
    if (cEnd > end) {
      tail = true;
      chords.push(piece(c, end, cEnd));
    }
  }
  if (canonical) chords.push({ tick, dur, symbol: canonical, origin: "manual" });
  chords.sort((a, b) => a.tick - b.tick);
  const ops: EditOp[] = [{ op: "setChords", range: { start, end: tail ? end + 1 : end }, chords }];

  // A change of symbol under untouched notes: write them again for the new chord.
  let rewrote = false;
  const old = project.chords.find((c) => c.tick === tick && c.dur === dur);
  const track = chordsTrack(project);
  if (opts.rewrite && canonical && old && track && old.symbol !== canonical) {
    const mode = writtenAs(notesUnder(track, old), old, time);
    if (mode) {
      const voicing = voiceChord(canonical, voicingBefore(project, tick));
      ops.push(
        { op: "removeNotes", trackId: track.id, ids: notesUnder(track, old).map((n) => n.id) },
        {
          op: "addNotes",
          trackId: track.id,
          notes: chordNotes({ tick, dur, symbol: canonical }, voicing, time, mode).map((n) => ({
            ...n,
            vel: 0.7,
            origin: "manual",
          })),
        },
      );
      rewrote = true;
    }
  }
  return { ops, label: canonical ? `Set chord ${canonical}` : "Remove chord", rewrote };
}

export interface Written {
  ops: EditOp[];
  trackId: string;
  /** Chords written, and chords left alone because the author has changed the notes under them. */
  written: number;
  kept: number;
}

/**
 * Write to track: every chord symbol as a block chord on the Chords track. A chord whose notes are
 * still as they were last written is written again (so changing how chords are struck is one tap);
 * a chord under notes the author has changed is left alone.
 */
export function writeToTrack(project: Project, mode: Restrike): Written | null {
  const track = chordsTrack(project);
  if (!track || !project.chords.length) return null;
  const time = makeTimeMap(project.tempo, project.meter);
  const all = realizeChords(project.chords, time, mode);
  const remove: number[] = [];
  const add: Omit<PNote, "id">[] = [];
  let written = 0;
  let kept = 0;
  for (const chord of project.chords) {
    const under = notesUnder(track, chord);
    if (under.length && !writtenAs(under, chord, time)) {
      kept++;
      continue;
    }
    remove.push(...under.map((n) => n.id));
    add.push(
      ...all
        .filter((n) => n.tick >= chord.tick && n.tick < chord.tick + chord.dur)
        .map((n) => ({ ...n, vel: 0.7, origin: "manual" as const })),
    );
    written++;
  }
  const ops: EditOp[] = [];
  if (remove.length) ops.push({ op: "removeNotes", trackId: track.id, ids: remove });
  if (add.length) ops.push({ op: "addNotes", trackId: track.id, notes: add });
  return { ops, trackId: track.id, written, kept };
}
