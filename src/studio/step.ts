/**
 * Step entry, as pure logic: what a key press writes and where the cursor goes next. Keys pressed
 * together — within 60 ms of each other, or while others are still held — are one chord and
 * advance once. No store and no clock in here: the caller supplies the time of each press.
 */
import type { EditOp, PNote, Project } from "../project/types";

export const CHORD_MS = 60;

/** One thing step entry did, so Backspace can take it back. */
export type Entry =
  | { kind: "notes"; tick: number; ids: number[]; advance: number; slot?: { tick: number; dur: number; vel: number } }
  | { kind: "rest"; tick: number; advance: number }
  | { kind: "tie"; ids: number[]; by: number };

export interface StepState {
  /** The step still being added to: its place, its length, and when its last key went down. */
  open: { tick: number; dur: number; at: number } | null;
  /** Keys of the open step still held. */
  held: number;
  history: Entry[];
}

export const initialStep = (): StepState => ({ open: null, held: 0, history: [] });

export interface StepResult {
  state: StepState;
  ops: EditOp[];
  label: string;
  /** Where the cursor goes; undefined leaves it. */
  cursor?: number;
}

const note = (pitch: number, tick: number, dur: number, vel: number): Omit<PNote, "id"> => ({
  pitch,
  tick,
  dur,
  vel: Math.round(vel * 100) / 100,
  origin: "manual",
});

/**
 * A key goes down. `seq` is the project's next id (the note written will get it); `length` is the
 * chosen note length in ticks; `now` is any clock in milliseconds.
 */
export function keyDown(
  state: StepState,
  project: Project,
  trackId: string,
  cursor: number,
  length: number,
  press: { pitch: number; velocity: number; now: number },
): StepResult {
  const id = project.seq;
  const open = state.open;
  const joins = open && (state.held > 0 || press.now - open.at <= CHORD_MS);
  if (joins) {
    // Another note of the chord being played: same place, same length, and the cursor stays.
    const last = state.history[state.history.length - 1];
    const history =
      last?.kind === "notes" ? [...state.history.slice(0, -1), { ...last, ids: [...last.ids, id] }] : state.history;
    return {
      state: { open: { ...open, at: press.now }, held: state.held + 1, history },
      ops: [{ op: "addNotes", trackId, notes: [note(press.pitch, open.tick, open.dur, press.velocity)] }],
      label: "Add to chord",
    };
  }

  // A rhythm waiting for pitches on this track: the key gives the next slot its pitch.
  const pending = project.pending?.trackId === trackId ? project.pending : undefined;
  const slot = pending?.slots[0];
  if (pending && slot) {
    const rest = pending.slots.slice(1);
    return {
      state: {
        open: { tick: slot.tick, dur: slot.dur, at: press.now },
        held: 1,
        history: [...state.history, { kind: "notes", tick: cursor, ids: [id], advance: 0, slot }],
      },
      ops: [
        { op: "addNotes", trackId, notes: [note(press.pitch, slot.tick, slot.dur, slot.vel)] },
        { op: "setPending", pending: rest.length ? { trackId, slots: rest } : undefined },
      ],
      label: "Fill rhythm",
      cursor: rest[0]?.tick ?? slot.tick + slot.dur,
    };
  }

  return {
    state: {
      open: { tick: cursor, dur: length, at: press.now },
      held: 1,
      history: [...state.history, { kind: "notes", tick: cursor, ids: [id], advance: length }],
    },
    ops: [{ op: "addNotes", trackId, notes: [note(press.pitch, cursor, length, press.velocity)] }],
    label: "Add note",
    cursor: cursor + length,
  };
}

export function keyUp(state: StepState): StepState {
  return { ...state, held: Math.max(0, state.held - 1) };
}

/** Rest: move on by the chosen length without writing. */
export function rest(state: StepState, cursor: number, length: number): StepResult {
  return {
    state: { open: null, held: 0, history: [...state.history, { kind: "rest", tick: cursor, advance: length }] },
    ops: [],
    label: "Rest",
    cursor: cursor + length,
  };
}

/** Tie: the note (or chord) just written is held for one more of the chosen length. */
export function tie(
  state: StepState,
  project: Project,
  trackId: string,
  cursor: number,
  length: number,
): StepResult | null {
  const last = [...state.history].reverse().find((e): e is Exclude<Entry, { kind: "rest" }> => e.kind !== "rest");
  const ids = last ? last.ids : [];
  const track = project.tracks.find((t) => t.id === trackId);
  if (track?.kind !== "notes") return null;
  const notes = track.notes.filter((n) => ids.includes(n.id));
  // Only a note that ends at the cursor can be carried on.
  if (!notes.length || notes.some((n) => n.tick + n.dur !== cursor)) return null;
  return {
    state: {
      open: null,
      held: 0,
      history: [...state.history, { kind: "tie", ids: notes.map((n) => n.id), by: length }],
    },
    ops: notes.map((n) => ({ op: "patchNotes", trackId, ids: [n.id], patch: { dur: n.dur + length } })),
    label: "Tie",
    cursor: cursor + length,
  };
}

/** Backspace: take back the last entry and step back to where it was made. Null if there is none. */
export function backspace(state: StepState, project: Project, trackId: string): StepResult | null {
  const last = state.history[state.history.length - 1];
  if (!last) return null;
  const history = state.history.slice(0, -1);
  const next: StepState = { open: null, held: 0, history };
  const track = project.tracks.find((t) => t.id === trackId);
  const existing = (ids: number[]) => (track?.kind === "notes" ? track.notes.filter((n) => ids.includes(n.id)) : []);

  if (last.kind === "rest") return { state: next, ops: [], label: "Take back rest", cursor: last.tick };
  if (last.kind === "tie") {
    const notes = existing(last.ids);
    return {
      state: next,
      ops: notes
        .filter((n) => n.dur > last.by)
        .map((n) => ({ op: "patchNotes", trackId, ids: [n.id], patch: { dur: n.dur - last.by } })),
      label: "Take back tie",
      cursor: notes.length ? Math.max(...notes.map((n) => n.tick + n.dur)) - last.by : undefined,
    };
  }
  const notes = existing(last.ids);
  const ops: EditOp[] = notes.length ? [{ op: "removeNotes", trackId, ids: notes.map((n) => n.id) }] : [];
  if (last.slot && notes.length) {
    // The pitch is taken back; the rhythm slot it filled is waiting again.
    const waiting = project.pending?.trackId === trackId ? project.pending.slots : [];
    ops.push({ op: "setPending", pending: { trackId, slots: [last.slot, ...waiting] } });
  }
  return { state: next, ops, label: "Take back step", cursor: last.slot ? last.slot.tick : last.tick };
}
