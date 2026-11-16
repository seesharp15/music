/**
 * What the author can do to notes, each as one undoable step with a label. Pointer gestures,
 * keyboard commands and the inspector's buttons all end up here, so each action exists once.
 */
import { quantizeNotes } from "../music/quantize";
import { EditError } from "../project/errors";
import type { EditOp, NoteTrack, PNote, Project } from "../project/types";
import { MAX_PITCH, MIN_PITCH } from "../song/ids";
import type { Hand } from "../song/types";
import { describeCursor, describeNote } from "./describe";
import { editableTracks } from "./layers";
import type { Session } from "./session";
import { lengthTicks, snapTicks } from "./ui-store";

export interface Held {
  track: NoteTrack;
  note: PNote;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** A zero-width space: it makes a repeated announcement a new one, so it is spoken again. */
const AGAIN = String.fromCharCode(0x200b);

/** Say something in the live region. The same words twice in a row are still spoken twice. */
export function announce(session: Session, text: string) {
  const was = session.ui.getState().announcement;
  session.ui.setState({ announcement: text === was ? text + AGAIN : text });
}

/** The selected notes with their tracks, in time order. */
export function selected(session: Session, ids?: readonly number[]): Held[] {
  const want = new Set(ids ?? session.ui.getState().selection);
  const out: Held[] = [];
  for (const track of session.store.getState().project.tracks) {
    if (track.kind !== "notes") continue;
    for (const note of track.notes) if (want.has(note.id)) out.push({ track, note });
  }
  return out.sort((a, b) => a.note.tick - b.note.tick || a.note.pitch - b.note.pitch);
}

const byTrack = (held: readonly Held[]) => {
  const map = new Map<string, PNote[]>();
  for (const h of held) map.set(h.track.id, [...(map.get(h.track.id) ?? []), h.note]);
  return map;
};

/** Apply an edit as one undo step. A refused edit changes nothing and is said aloud. */
export function edit(session: Session, ops: EditOp[], label: string): boolean {
  if (session.readOnly || ops.length === 0) return false;
  try {
    session.store.apply(ops, label);
    return true;
  } catch (err) {
    if (!(err instanceof EditError)) throw err;
    announce(session, `Not done: ${refusal(err)}.`);
    return false;
  }
}

function refusal(err: EditError): string {
  switch (err.code) {
    case "lockedTrack":
      return "that track is locked";
    case "outOfRange":
      return "that would go off the end of the piano or before the start of the song";
    case "overlap":
      return "it would overlap what is already there";
    default:
      return err.message;
  }
}

/** Describe the selection: one note in full, several by count. */
export function describeSelection(session: Session): string {
  const held = selected(session);
  const project = session.store.getState().project;
  if (held.length === 0) return "Nothing selected";
  if (held.length === 1) return `${describeNote(project, held[0].note)}, selected`;
  return `${plural(held.length, "note")} selected`;
}

export function select(session: Session, ids: readonly number[], mode: "replace" | "add" | "toggle" = "replace") {
  const now = session.ui.getState().selection;
  let next: number[];
  if (mode === "replace") next = [...ids];
  else if (mode === "add") next = [...new Set([...now, ...ids])];
  else next = [...now.filter((i) => !ids.includes(i)), ...ids.filter((i) => !now.includes(i))];
  // Only notes that exist can be selected.
  const real = new Set(selected(session, next).map((h) => h.note.id));
  next = next.filter((i) => real.has(i));
  if (next.length === now.length && next.every((i, k) => i === now[k])) return;
  session.ui.setState({ selection: next });
  announce(session, describeSelection(session));
}

/** Select every note of the active track. */
export function selectAll(session: Session) {
  const { project } = session.store.getState();
  const track = project.tracks.find((t) => t.id === session.ui.getState().activeTrack);
  select(session, track?.kind === "notes" ? track.notes.map((n) => n.id) : []);
}

export function setCursor(session: Session, tick: number, say = true) {
  const cursor = Math.max(0, Math.round(tick));
  if (cursor === session.ui.getState().cursor) return;
  session.ui.setState({ cursor });
  if (say) announce(session, describeCursor(session.store.getState().project, cursor));
}

/** Move the cursor by one step of the chosen note length, or by a bar. */
export function stepCursor(session: Session, direction: 1 | -1, by: "step" | "bar") {
  const s = session.ui.getState();
  const time = session.playback.time();
  if (by === "bar") {
    const bar = time.positionAt(s.cursor).bar;
    const here = time.tickOfBar(bar);
    setCursor(
      session,
      direction > 0 ? time.tickOfBar(bar + 1) : s.cursor > here ? here : time.tickOfBar(Math.max(1, bar - 1)),
    );
  } else setCursor(session, s.cursor + direction * lengthTicks(s.length));
}

// ── Changing notes ───────────────────────────────────────────────────────────

/** Move notes in time and pitch; with `copy`, leave them and place copies instead. */
export function moveNotes(session: Session, ids: readonly number[], dTick: number, dPitch: number, copy = false) {
  const held = selected(session, ids);
  if (!held.length) return;
  if (copy) {
    const before = session.store.getState().project.seq;
    const ops: EditOp[] = [...byTrack(held)].map(([trackId, notes]) => ({
      op: "addNotes",
      trackId,
      notes: notes.map(({ id: _id, ...n }) => ({ ...n, tick: n.tick + dTick, pitch: n.pitch + dPitch })),
    }));
    if (edit(session, ops, `Duplicate ${plural(held.length, "note")}`)) selectNewSince(session, before);
    return;
  }
  if (dTick === 0 && dPitch === 0) return;
  const ops: EditOp[] = [...byTrack(held)].map(([trackId, notes]) => ({
    op: "shiftNotes",
    trackId,
    ids: notes.map((n) => n.id),
    ticks: dTick,
    semitones: dPitch,
  }));
  if (edit(session, ops, `Move ${plural(held.length, "note")}`)) {
    announce(
      session,
      held.length === 1 ? describeSelectionOf(session, held[0].note.id) : `Moved ${plural(held.length, "note")}`,
    );
  }
}

const describeSelectionOf = (session: Session, id: number) => {
  const h = selected(session, [id])[0];
  return h ? describeNote(session.store.getState().project, h.note) : "";
};

/** Select the notes made since `seq` was the next id: what a paste or a duplicate just added. */
function selectNewSince(session: Session, seq: number) {
  const ids: number[] = [];
  for (const t of session.store.getState().project.tracks) {
    if (t.kind === "notes") for (const n of t.notes) if (n.id >= seq) ids.push(n.id);
  }
  session.ui.setState({ selection: ids });
  announce(session, describeSelection(session));
}

/** Lengthen or shorten notes by `dDur` ticks; none ends up shorter than a grid step. */
export function resizeNotes(session: Session, ids: readonly number[], dDur: number) {
  const held = selected(session, ids);
  if (!held.length || dDur === 0) return;
  const snap = snapTicks(session.ui.getState());
  const ops: EditOp[] = [];
  for (const [trackId, notes] of byTrack(held)) {
    // One patch per resulting length.
    const byDur = new Map<number, number[]>();
    for (const n of notes) {
      const dur = Math.max(Math.min(snap, n.dur), n.dur + dDur);
      if (dur !== n.dur) byDur.set(dur, [...(byDur.get(dur) ?? []), n.id]);
    }
    for (const [dur, group] of byDur) ops.push({ op: "patchNotes", trackId, ids: group, patch: { dur } });
  }
  if (edit(session, ops, `Resize ${plural(held.length, "note")}`) && held.length === 1) {
    announce(session, describeSelectionOf(session, held[0].note.id));
  }
}

/** Write a note of the chosen length on the active track. */
export function addNote(session: Session, pitch: number, tick: number): boolean {
  const s = session.ui.getState();
  const before = session.store.getState().project.seq;
  const ok = edit(
    session,
    [
      {
        op: "addNotes",
        trackId: s.activeTrack,
        notes: [{ pitch, tick, dur: lengthTicks(s.length), vel: 0.8, origin: "manual" }],
      },
    ],
    "Add note",
  );
  if (ok) {
    session.playback.audition([pitch], s.activeTrack);
    announce(session, describeSelectionOf(session, before));
  }
  return ok;
}

export function eraseNotes(session: Session, ids: readonly number[]) {
  const held = selected(session, ids);
  if (!held.length) return;
  const ops: EditOp[] = [...byTrack(held)].map(([trackId, notes]) => ({
    op: "removeNotes",
    trackId,
    ids: notes.map((n) => n.id),
  }));
  if (edit(session, ops, `Delete ${plural(held.length, "note")}`)) {
    const gone = new Set(held.map((h) => h.note.id));
    session.ui.setState({ selection: session.ui.getState().selection.filter((i) => !gone.has(i)) });
    announce(session, `Deleted ${plural(held.length, "note")}`);
  }
}

export const deleteSelection = (session: Session) => eraseNotes(session, session.ui.getState().selection);

/** Up or down by semitones, as far as the piano allows. */
export function transpose(session: Session, semitones: number) {
  const held = selected(session);
  if (!held.length) return;
  const lo = Math.min(...held.map((h) => h.note.pitch));
  const hi = Math.max(...held.map((h) => h.note.pitch));
  const by = Math.min(MAX_PITCH - hi, Math.max(MIN_PITCH - lo, semitones));
  if (by === 0) return announce(session, "That is as far as the piano goes");
  moveNotes(
    session,
    held.map((h) => h.note.id),
    0,
    by,
  );
  session.playback.audition([held[0].note.pitch + by], held[0].track.id);
}

/** Earlier or later by one grid step, or by a bar. */
export function nudge(session: Session, direction: 1 | -1, by: "step" | "bar") {
  const held = selected(session);
  if (!held.length) return;
  const first = Math.min(...held.map((h) => h.note.tick));
  const amount = by === "bar" ? session.playback.time().ticksPerBarAt(first) : snapTicks(session.ui.getState());
  const dTick = Math.max(-first, direction * amount);
  if (dTick !== 0)
    moveNotes(
      session,
      held.map((h) => h.note.id),
      dTick,
      0,
    );
}

function patchSelection(session: Session, patch: Partial<Omit<PNote, "id">>, label: string): boolean {
  const held = selected(session);
  const ops: EditOp[] = [...byTrack(held)].map(([trackId, notes]) => ({
    op: "patchNotes",
    trackId,
    ids: notes.map((n) => n.id),
    patch,
  }));
  return edit(session, ops, label);
}

export const setVelocity = (session: Session, vel: number) =>
  patchSelection(session, { vel: Math.min(1, Math.max(0.05, vel)) }, "Change velocity");

/** Which hand plays these notes in Practice: one of the two, or (undefined) whatever their track says. */
export const setHand = (session: Session, hand: Hand | undefined) =>
  patchSelection(
    session,
    { hand },
    hand ? `Give to the ${hand === "L" ? "left" : "right"} hand` : "Hand back to the track",
  );

/** Set one note's start or length exactly (the inspector's fields). */
export function setTiming(session: Session, id: number, patch: { tick?: number; dur?: number }) {
  const h = selected(session, [id])[0];
  if (!h) return;
  if (edit(session, [{ op: "patchNotes", trackId: h.track.id, ids: [id], patch }], "Change note")) {
    announce(session, describeSelectionOf(session, id));
  }
}

/** Put the selected notes on the grid. */
export function quantizeSelection(session: Session) {
  const held = selected(session);
  if (!held.length) return;
  const grid = session.ui.getState().snap;
  const ops: EditOp[] = [];
  let moved = 0;
  for (const [trackId, notes] of byTrack(held)) {
    const tidy = quantizeNotes(notes, { grid });
    // One patch per note that moves: each lands on its own line.
    tidy.forEach((t, i) => {
      const n = notes[i];
      if (t.tick === n.tick && !n.offset) return;
      moved++;
      ops.push({ op: "patchNotes", trackId, ids: [n.id], patch: { tick: Math.max(0, t.tick), offset: undefined } });
    });
  }
  if (!ops.length) return announce(session, "Already on the grid");
  if (edit(session, ops, `Quantize ${plural(held.length, "note")}`))
    announce(session, `Quantized ${plural(moved, "note")}`);
}

/** Legato: each selected note is held until the next one on its track begins. */
export function legato(session: Session) {
  const held = selected(session);
  const ops: EditOp[] = [];
  for (const [trackId, notes] of byTrack(held)) {
    const starts = [...new Set(notes.map((n) => n.tick))].sort((a, b) => a - b);
    for (const n of notes) {
      const next = starts.find((t) => t > n.tick);
      if (next !== undefined && next - n.tick !== n.dur) {
        ops.push({ op: "patchNotes", trackId, ids: [n.id], patch: { dur: next - n.tick } });
      }
    }
  }
  if (!ops.length) return announce(session, "Nothing to join");
  if (edit(session, ops, "Legato")) announce(session, "Joined up");
}

/** A copy of the selection, placed straight after it. */
export function duplicateSelection(session: Session) {
  const held = selected(session);
  if (!held.length) return;
  const start = Math.min(...held.map((h) => h.note.tick));
  const end = Math.max(...held.map((h) => h.note.tick + h.note.dur));
  // Keep the copy on the grid the original sits on: a whole number of snap steps later.
  const snap = snapTicks(session.ui.getState());
  const span = Math.max(snap, Math.ceil((end - start) / snap) * snap);
  moveNotes(
    session,
    held.map((h) => h.note.id),
    span,
    0,
    true,
  );
}

// ── Clipboard ────────────────────────────────────────────────────────────────

const CLIPBOARD_KEY = "piano-tutor:clipboard";

/** Notes on the clipboard: starts are counted from the earliest note, so they can be pasted anywhere. */
export interface Clip {
  kind: "piano-tutor/notes";
  notes: Omit<PNote, "id">[];
}

let memory: Clip | null = null;

function writeClip(clip: Clip) {
  memory = clip;
  try {
    // So a copy made in one song can be pasted into another, in this tab or the next.
    localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(clip));
  } catch {
    /* kept in memory only */
  }
}

export function readClip(): Clip | null {
  try {
    const raw = JSON.parse(localStorage.getItem(CLIPBOARD_KEY) ?? "null") as Clip | null;
    if (raw?.kind === "piano-tutor/notes" && Array.isArray(raw.notes) && raw.notes.length) return raw;
  } catch {
    /* fall back to memory */
  }
  return memory;
}

export function copySelection(session: Session): boolean {
  const held = selected(session);
  if (!held.length) return false;
  const start = Math.min(...held.map((h) => h.note.tick));
  writeClip({
    kind: "piano-tutor/notes",
    notes: held.map(({ note: { id: _id, ...n } }) => ({ ...n, tick: n.tick - start })),
  });
  announce(session, `Copied ${plural(held.length, "note")}`);
  return true;
}

export function cutSelection(session: Session) {
  if (copySelection(session)) deleteSelection(session);
}

/** Paste at the cursor, onto the active track; the cursor moves on to the end of what was pasted. */
export function paste(session: Session) {
  const clip = readClip();
  if (!clip) return announce(session, "Nothing to paste");
  const s = session.ui.getState();
  const before = session.store.getState().project.seq;
  const notes = clip.notes.map((n) => ({ ...n, tick: n.tick + s.cursor }));
  if (!edit(session, [{ op: "addNotes", trackId: s.activeTrack, notes }], `Paste ${plural(notes.length, "note")}`))
    return;
  selectNewSince(session, before);
  const end = Math.max(...notes.map((n) => n.tick + n.dur));
  const snap = snapTicks(s);
  setCursor(session, Math.ceil(end / snap) * snap, false);
  announce(session, `Pasted ${plural(notes.length, "note")}`);
}

/** The notes pointer gestures may take hold of, as the view's hit-testing wants them. */
export function grabbable(
  project: Project,
  ui: { activeTrack: string; editAll: boolean; hiddenTracks?: readonly string[] },
) {
  return editableTracks(project, ui).flatMap((t) =>
    t.notes.map((n) => ({ id: n.id, pitch: n.pitch, tick: n.tick, dur: n.dur })),
  );
}
