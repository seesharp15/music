/**
 * Edit operations: the only way a project changes. See docs/plan/contracts.md §5.
 *
 * `applyOps` is all-or-nothing. An op that cannot be carried out throws an `EditError` and the
 * project is untouched. What is merely untidy is put right without comment: ids come from `seq`,
 * notes and chords stay sorted, the song grows to fit, and a note that was not the author's own is
 * marked `edited` the first time they change it.
 */
import { produce } from "immer";
import { canonicalChord, pitchClassOf } from "../music/theory";
import { DRUM_PADS, MAX_PITCH, MIN_PITCH, SOUND_IDS } from "../song/ids";
import { EditError, type EditErrorCode } from "./errors";
import type {
  ChordEvent,
  DrumPattern,
  DrumTrack,
  EditOp,
  NoteTrack,
  Origin,
  PNote,
  Project,
  PSection,
  Track,
} from "./types";

type Hit = DrumTrack["hits"][number];

/** Notes the author made with their own hands: changing one of these is not "editing a suggestion". */
const OWN: readonly Origin[] = ["manual", "played", "tapped"];
const ORIGINS: readonly Origin[] = ["manual", "played", "tapped", "hummed", "imported", "suggested"];
const ROLES = ["melody", "chords", "bass", "counter", "free"];
const MODES = ["major", "minor", "dorian", "mixolydian", "lydian", "phrygian"];

/** Returns a new project with the ops applied; the one passed in is never changed. */
export function applyOps(project: Project, ops: readonly EditOp[]): Project {
  return produce(project, (draft) => {
    applyOpsInPlace(draft as Project, ops);
  });
}

/**
 * Applies ops to a project by changing it. For callers that hold a draft (the store, through Immer):
 * if this throws, the object is half-changed and must be thrown away.
 */
export function applyOpsInPlace(p: Project, ops: readonly EditOp[]): void {
  const touched = { tracks: new Set<Track>(), chords: false, sections: false };
  ops.forEach((op, opIndex) => {
    const fail = (code: EditErrorCode, message: string): never => {
      throw new EditError(code, opIndex, `${op.op}: ${message}`);
    };
    applyOne(p, op, fail, touched);
  });

  // Put right silently: order, and a song long enough to hold what is in it.
  for (const t of touched.tracks) {
    if (t.kind === "notes") sortIfNeeded(t.notes, byTickPitchId);
    else sortIfNeeded(t.hits, byTickId);
  }
  if (touched.chords) sortIfNeeded(p.chords, byTickId);
  if (touched.sections) sortIfNeeded(p.sections, (a, b) => a.tick - b.tick);
  const end = contentEnd(p);
  if (p.lengthTicks < end) p.lengthTicks = end;
}

type Fail = (code: EditErrorCode, message: string) => never;
type Touched = { tracks: Set<Track>; chords: boolean; sections: boolean };

const byTickPitchId = (a: PNote, b: PNote) => a.tick - b.tick || a.pitch - b.pitch || a.id - b.id;
const byTickId = (a: { tick: number; id: number }, b: { tick: number; id: number }) => a.tick - b.tick || a.id - b.id;

function sortIfNeeded<T>(list: T[], compare: (a: T, b: T) => number) {
  for (let i = 1; i < list.length; i++) {
    if (compare(list[i - 1], list[i]) > 0) {
      list.sort(compare);
      return;
    }
  }
}

/** Where the last thing in the project ends, in ticks. */
export function contentEnd(p: Project): number {
  let end = 0;
  for (const c of p.chords) end = Math.max(end, c.tick + c.dur);
  for (const s of p.sections) end = Math.max(end, s.tick + s.dur);
  for (const t of p.tracks) {
    if (t.kind === "notes") {
      for (const n of t.notes) end = Math.max(end, n.tick + n.dur);
    } else {
      for (const h of t.hits) end = Math.max(end, h.tick);
      for (const c of t.clips) end = Math.max(end, c.tick);
    }
  }
  return end;
}

// ── Checks ───────────────────────────────────────────────────────────────────

const isInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x);
const isUnit = (x: unknown): x is number => typeof x === "number" && x >= 0 && x <= 1;

function checkTick(tick: unknown, fail: Fail, what = "tick") {
  if (!isInt(tick)) fail("badValue", `${what} must be a whole number of ticks`);
  if ((tick as number) < 0) fail("outOfRange", `${what} is before the start of the song`);
}
function checkDur(dur: unknown, fail: Fail, what = "length") {
  if (!isInt(dur) || dur <= 0) fail("badValue", `${what} must be a whole number of ticks greater than zero`);
}

function checkNote(n: Omit<PNote, "id">, fail: Fail) {
  if (!isInt(n.pitch)) fail("badValue", "pitch must be a whole number");
  if (n.pitch < MIN_PITCH || n.pitch > MAX_PITCH) fail("outOfRange", `pitch ${n.pitch} is off the keyboard (21–108)`);
  checkTick(n.tick, fail);
  checkDur(n.dur, fail);
  if (!isUnit(n.vel)) fail("badValue", "velocity must be between 0 and 1");
  if (n.offset !== undefined && !Number.isFinite(n.offset)) fail("badValue", "offset must be a number");
  if (n.hand !== undefined && n.hand !== "L" && n.hand !== "R") fail("badValue", "hand must be L or R");
  if (!ORIGINS.includes(n.origin)) fail("badValue", `unknown origin "${String(n.origin)}"`);
  if (n.conf !== undefined && !isUnit(n.conf)) fail("badValue", "confidence must be between 0 and 1");
}

function checkHit(h: Omit<Hit, "id">, fail: Fail) {
  if (!(DRUM_PADS as readonly string[]).includes(h.pad)) fail("badValue", `unknown drum pad "${String(h.pad)}"`);
  checkTick(h.tick, fail);
  if (!isUnit(h.vel)) fail("badValue", "velocity must be between 0 and 1");
  if (h.offset !== undefined && !Number.isFinite(h.offset)) fail("badValue", "offset must be a number");
  if (!ORIGINS.includes(h.origin)) fail("badValue", `unknown origin "${String(h.origin)}"`);
}

function checkPattern(pat: DrumPattern, fail: Fail) {
  if (typeof pat.id !== "string" || !pat.id) fail("badValue", "a pattern needs an id");
  if (!isInt(pat.stepsPerBar) || pat.stepsPerBar <= 0)
    fail("badValue", "stepsPerBar must be a whole number above zero");
  if (![1, 2, 4].includes(pat.bars)) fail("badValue", "a pattern is 1, 2 or 4 bars long");
  for (const [pad, lane] of Object.entries(pat.lanes)) {
    if (!(DRUM_PADS as readonly string[]).includes(pad)) fail("badValue", `unknown drum pad "${pad}"`);
    if (!Array.isArray(lane) || lane.length !== pat.stepsPerBar * pat.bars) {
      fail("badValue", `the ${pad} lane must have ${pat.stepsPerBar * pat.bars} steps`);
    }
    if (!lane!.every(isUnit)) fail("badValue", `the ${pad} lane holds a velocity outside 0–1`);
  }
}

function checkSections(sections: PSection[], fail: Fail) {
  const ids = new Set<string>();
  for (const s of sections) {
    if (typeof s.id !== "string" || !s.id) fail("badValue", "a section needs an id");
    if (ids.has(s.id)) fail("badValue", `section id "${s.id}" is used twice`);
    ids.add(s.id);
    checkTick(s.tick, fail);
    checkDur(s.dur, fail);
  }
}

/** The track an op is addressed to: it must exist, be of the right kind, and not be locked. */
function trackFor<K extends Track["kind"]>(
  p: Project,
  trackId: string,
  kind: K,
  fail: Fail,
): Extract<Track, { kind: K }> {
  const t = p.tracks.find((x) => x.id === trackId);
  if (!t) return fail("unknownId", `there is no track "${trackId}"`);
  if (t.locked) fail("lockedTrack", `track "${trackId}" is locked`);
  if (t.kind !== kind) fail("badValue", `track "${trackId}" does not hold ${kind === "notes" ? "notes" : "drums"}`);
  return t as Extract<Track, { kind: K }>;
}

/** The items with these ids, every one of which must exist. */
function pick<T extends { id: number }>(list: T[], ids: readonly number[], what: string, fail: Fail): T[] {
  const byId = new Map(list.map((x) => [x.id, x]));
  return ids.map((id) => byId.get(id) ?? fail("unknownId", `there is no ${what} with id ${id}`));
}

/** Copy a patch onto an item; a key present with the value `undefined` removes the field. */
function assign<T extends object>(target: T, patch: Partial<T>) {
  for (const key of Object.keys(patch) as (keyof T)[]) {
    if (patch[key] === undefined) delete target[key];
    else target[key] = patch[key] as T[keyof T];
  }
}

function markEdited(n: PNote, patch?: Partial<PNote>) {
  if (patch && "edited" in patch) return; // the caller said what it should be
  if (!OWN.includes(n.origin)) n.edited = true;
}

// ── One op ───────────────────────────────────────────────────────────────────

function applyOne(p: Project, op: EditOp, fail: Fail, touched: Touched) {
  switch (op.op) {
    case "addNotes": {
      const t = trackFor(p, op.trackId, "notes", fail);
      for (const n of op.notes) {
        checkNote(n, fail);
        t.notes.push({ ...n, id: p.seq++ });
      }
      touched.tracks.add(t);
      return;
    }
    case "removeNotes": {
      const t = trackFor(p, op.trackId, "notes", fail);
      pick(t.notes, op.ids, "note", fail);
      const gone = new Set(op.ids);
      t.notes = t.notes.filter((n) => !gone.has(n.id));
      return;
    }
    case "patchNotes": {
      const t = trackFor(p, op.trackId, "notes", fail);
      if ("id" in op.patch) fail("badValue", "a note's id cannot be changed");
      for (const n of pick(t.notes, op.ids, "note", fail)) {
        assign(n, op.patch);
        checkNote(n, fail);
        markEdited(n, op.patch);
      }
      touched.tracks.add(t);
      return;
    }
    case "shiftNotes": {
      const t = trackFor(p, op.trackId, "notes", fail);
      if (!isInt(op.ticks) || !isInt(op.semitones)) fail("badValue", "ticks and semitones must be whole numbers");
      for (const n of pick(t.notes, op.ids, "note", fail)) {
        n.tick += op.ticks;
        n.pitch += op.semitones;
        checkNote(n, fail);
        if (op.ticks || op.semitones) markEdited(n);
      }
      touched.tracks.add(t);
      return;
    }
    case "setChords": {
      const { start, end } = op.range;
      checkTick(start, fail, "range start");
      checkTick(end, fail, "range end");
      if (end < start) fail("badValue", "the range ends before it starts");
      const kept = p.chords.filter((c) => c.tick < start || c.tick >= end);
      const added: ChordEvent[] = op.chords.map((c) => {
        checkTick(c.tick, fail);
        checkDur(c.dur, fail);
        if (c.tick < start || c.tick >= end) fail("badValue", `chord at tick ${c.tick} is outside the range being set`);
        if (!ORIGINS.includes(c.origin)) fail("badValue", `unknown origin "${String(c.origin)}"`);
        const symbol = canonicalChord(String(c.symbol)) ?? fail("badValue", `"${c.symbol}" is not a chord`);
        return { ...c, symbol, id: p.seq++ };
      });
      const all = [...kept, ...added].sort(byTickId);
      for (let i = 1; i < all.length; i++) {
        if (all[i].tick < all[i - 1].tick + all[i - 1].dur) {
          fail(
            "overlap",
            `${all[i - 1].symbol} at tick ${all[i - 1].tick} would overlap ${all[i].symbol} at tick ${all[i].tick}`,
          );
        }
      }
      p.chords = all;
      return;
    }
    case "addHits": {
      const t = trackFor(p, op.trackId, "drums", fail);
      for (const h of op.hits) {
        checkHit(h, fail);
        t.hits.push({ ...h, id: p.seq++ });
      }
      touched.tracks.add(t);
      return;
    }
    case "removeHits": {
      const t = trackFor(p, op.trackId, "drums", fail);
      pick(t.hits, op.ids, "hit", fail);
      const gone = new Set(op.ids);
      t.hits = t.hits.filter((h) => !gone.has(h.id));
      return;
    }
    case "patchHits": {
      const t = trackFor(p, op.trackId, "drums", fail);
      if ("id" in op.patch) fail("badValue", "a hit's id cannot be changed");
      for (const h of pick(t.hits, op.ids, "hit", fail)) {
        assign(h, op.patch);
        checkHit(h, fail);
      }
      touched.tracks.add(t);
      return;
    }
    case "putPattern": {
      const t = trackFor(p, op.trackId, "drums", fail);
      checkPattern(op.pattern, fail);
      const at = t.patterns.findIndex((x) => x.id === op.pattern.id);
      if (at >= 0) t.patterns[at] = op.pattern;
      else t.patterns.push(op.pattern);
      return;
    }
    case "removePattern": {
      const t = trackFor(p, op.trackId, "drums", fail);
      if (!t.patterns.some((x) => x.id === op.patternId)) fail("unknownId", `there is no pattern "${op.patternId}"`);
      t.patterns = t.patterns.filter((x) => x.id !== op.patternId);
      t.clips = t.clips.filter((c) => c.patternId !== op.patternId);
      return;
    }
    case "placeClip": {
      const t = trackFor(p, op.trackId, "drums", fail);
      if (!t.patterns.some((x) => x.id === op.patternId)) fail("unknownId", `there is no pattern "${op.patternId}"`);
      checkTick(op.tick, fail);
      if (!isInt(op.repeats) || op.repeats < 1) fail("badValue", "a clip plays at least once");
      t.clips.push({ id: p.seq++, patternId: op.patternId, tick: op.tick, repeats: op.repeats });
      t.clips.sort(byTickId);
      return;
    }
    case "removeClip": {
      const t = trackFor(p, op.trackId, "drums", fail);
      pick(t.clips, [op.id], "clip", fail);
      t.clips = t.clips.filter((c) => c.id !== op.id);
      return;
    }
    case "addTrack": {
      const track = op.track;
      if (typeof track.id !== "string" || !track.id) fail("badValue", "a track needs an id");
      if (p.tracks.some((t) => t.id === track.id)) fail("badValue", `there is already a track "${track.id}"`);
      if (!isUnit(track.volume) || !isUnit(track.feel)) fail("badValue", "volume and feel must be between 0 and 1");
      let added: Track;
      if (track.kind === "notes") {
        checkTrackFields(track, fail);
        // Whatever ids its notes came with, they get fresh ones: ids are unique across the project.
        added = { ...track, notes: track.notes.map((n) => (checkNote(n, fail), { ...n, id: p.seq++ })) };
      } else if (track.kind === "drums") {
        const patterns = new Set<string>();
        for (const pat of track.patterns) {
          checkPattern(pat, fail);
          if (patterns.has(pat.id)) fail("badValue", `pattern id "${pat.id}" is used twice`);
          patterns.add(pat.id);
        }
        added = {
          ...track,
          patterns: track.patterns.map((pat) => ({ ...pat, lanes: { ...pat.lanes } })),
          clips: track.clips.map((c) => {
            if (!patterns.has(c.patternId)) fail("unknownId", `there is no pattern "${c.patternId}"`);
            checkTick(c.tick, fail);
            if (!isInt(c.repeats) || c.repeats < 1) fail("badValue", "a clip plays at least once");
            return { ...c, id: p.seq++ };
          }),
          hits: track.hits.map((h) => (checkHit(h, fail), { ...h, id: p.seq++ })),
        };
      } else {
        return fail("badValue", "a track holds notes or drums");
      }
      const index = op.index === undefined ? p.tracks.length : Math.min(Math.max(0, op.index), p.tracks.length);
      p.tracks.splice(index, 0, added);
      touched.tracks.add(p.tracks[index]);
      return;
    }
    case "removeTrack": {
      const t = p.tracks.find((x) => x.id === op.trackId) ?? fail("unknownId", `there is no track "${op.trackId}"`);
      if (t.locked) fail("lockedTrack", `track "${op.trackId}" is locked`);
      p.tracks = p.tracks.filter((x) => x.id !== op.trackId);
      if (p.pending?.trackId === op.trackId) delete p.pending;
      return;
    }
    case "patchTrack": {
      const t = p.tracks.find((x) => x.id === op.trackId) ?? fail("unknownId", `there is no track "${op.trackId}"`);
      // The one thing a locked track accepts is being unlocked.
      if (t.locked && op.patch.locked !== false) fail("lockedTrack", `track "${op.trackId}" is locked`);
      const patch = op.patch;
      if (t.kind === "notes" && "kit" in patch) fail("badValue", "only a drum track has a kit");
      if (t.kind === "drums" && ("role" in patch || "hand" in patch || "sound" in patch)) {
        fail("badValue", "a drum track has no role, hand or sound");
      }
      assign(t as NoteTrack & DrumTrack, patch);
      if (!isUnit(t.volume) || !isUnit(t.feel)) fail("badValue", "volume and feel must be between 0 and 1");
      if (typeof t.muted !== "boolean" || typeof t.locked !== "boolean")
        fail("badValue", "muted and locked are on or off");
      if (typeof t.name !== "string") fail("badValue", "a track's name is text");
      if (t.kind === "notes") checkTrackFields(t, fail);
      else if (typeof t.kit !== "string") fail("badValue", "a kit is named by text");
      return;
    }
    case "setSections": {
      checkSections(op.sections, fail);
      p.sections = op.sections.map((s) => ({ ...s }));
      touched.sections = true;
      return;
    }
    case "insertTime": {
      checkTick(op.tick, fail);
      checkDur(op.dur, fail);
      insertTime(p, op.tick, op.dur);
      return;
    }
    case "deleteTime": {
      checkTick(op.tick, fail);
      checkDur(op.dur, fail);
      deleteTime(p, op.tick, op.dur);
      return;
    }
    case "copyRange": {
      const { start, end } = op.from;
      checkTick(start, fail, "range start");
      checkTick(end, fail, "range end");
      checkTick(op.to, fail, "destination");
      if (end <= start) fail("badValue", "the range to copy is empty");
      copyRange(p, start, end, op.to);
      touched.chords = touched.sections = true;
      p.tracks.forEach((t) => touched.tracks.add(t));
      return;
    }
    case "patchSong": {
      patchSong(p, op.patch, fail);
      return;
    }
    case "putIdea": {
      if (typeof op.idea.id !== "string" || !op.idea.id) fail("badValue", "an idea needs an id");
      const at = p.ideas.findIndex((i) => i.id === op.idea.id);
      if (at >= 0) p.ideas[at] = op.idea;
      else p.ideas.push(op.idea);
      return;
    }
    case "removeIdea": {
      if (!p.ideas.some((i) => i.id === op.id)) fail("unknownId", `there is no idea "${op.id}"`);
      p.ideas = p.ideas.filter((i) => i.id !== op.id);
      return;
    }
    case "setPending": {
      if (!op.pending) {
        delete p.pending;
        return;
      }
      trackFor(p, op.pending.trackId, "notes", fail);
      for (const s of op.pending.slots) {
        checkTick(s.tick, fail);
        checkDur(s.dur, fail);
        if (!isUnit(s.vel)) fail("badValue", "velocity must be between 0 and 1");
      }
      p.pending = { trackId: op.pending.trackId, slots: op.pending.slots.map((s) => ({ ...s })) };
      return;
    }
    default: {
      const unknown: never = op;
      return fail("badValue", `unknown operation ${JSON.stringify((unknown as { op?: unknown }).op)}`);
    }
  }
}

function checkTrackFields(t: NoteTrack, fail: Fail) {
  if (!ROLES.includes(t.role)) fail("badValue", `unknown role "${String(t.role)}"`);
  if (t.hand !== "L" && t.hand !== "R") fail("badValue", "hand must be L or R");
  if (!(SOUND_IDS as readonly string[]).includes(t.sound)) fail("badValue", `unknown sound "${String(t.sound)}"`);
}

function patchSong(p: Project, patch: Extract<EditOp, { op: "patchSong" }>["patch"], fail: Fail) {
  const inOrder = (events: { tick: number }[], what: string) => {
    if (!Array.isArray(events) || !events.length) fail("badValue", `${what} needs at least one entry`);
    events.forEach((e) => checkTick(e.tick, fail, `${what} tick`));
    const sorted = [...events].sort((a, b) => a.tick - b.tick);
    if (sorted[0].tick !== 0) fail("badValue", `${what} must start at tick 0`);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].tick === sorted[i - 1].tick) fail("badValue", `${what} has two entries at tick ${sorted[i].tick}`);
    }
    return sorted;
  };
  if (patch.title !== undefined && typeof patch.title !== "string") fail("badValue", "a title is text");
  if (patch.tempo) {
    for (const e of patch.tempo) {
      if (!(e.bpm >= 10 && e.bpm <= 400)) fail("badValue", `tempo ${e.bpm} is outside 10–400`);
    }
    patch = { ...patch, tempo: inOrder(patch.tempo, "tempo") as Project["tempo"] };
  }
  if (patch.meter) {
    for (const e of patch.meter) {
      if (!isInt(e.numerator) || e.numerator < 1 || e.numerator > 32) fail("badValue", "a bar has 1 to 32 beats");
      if (![2, 4, 8, 16].includes(e.denominator)) fail("badValue", "a beat is a half, quarter, eighth or sixteenth");
    }
    patch = { ...patch, meter: inOrder(patch.meter, "meter") as Project["meter"] };
  }
  if (patch.key) {
    for (const k of patch.key) {
      checkTick(k.tick, fail, "key tick");
      if (!/^[A-G][#b]?$/.test(k.tonic) || pitchClassOf(k.tonic) < 0)
        fail("badValue", `"${k.tonic}" is not a key note`);
      if (!MODES.includes(k.mode)) fail("badValue", `unknown mode "${String(k.mode)}"`);
    }
    const sorted = [...patch.key].sort((a, b) => a.tick - b.tick);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].tick === sorted[i - 1].tick) fail("badValue", `key has two entries at tick ${sorted[i].tick}`);
    }
    patch = { ...patch, key: sorted };
  }
  if (patch.swing) {
    if (!(patch.swing.amount >= 0.25 && patch.swing.amount <= 0.85))
      fail("badValue", "swing must be between 0.25 and 0.85");
    if (patch.swing.unit !== 8 && patch.swing.unit !== 16)
      fail("badValue", "swing is counted in eighths or sixteenths");
  }
  if (patch.groove) {
    if (patch.groove.unit !== 8 && patch.groove.unit !== 16)
      fail("badValue", "a groove is counted in eighths or sixteenths");
    if (!patch.groove.offsets.every(Number.isFinite) || !patch.groove.accents.every((a) => a >= 0)) {
      fail("badValue", "a groove holds numbers");
    }
  }
  if (patch.handSpan !== undefined && (!isInt(patch.handSpan) || patch.handSpan < 1 || patch.handSpan > 36)) {
    fail("badValue", "hand span must be 1 to 36 semitones");
  }
  if (patch.lengthTicks !== undefined) checkTick(patch.lengthTicks, fail, "length");
  assign(p, patch);
}

// ── Range operations ─────────────────────────────────────────────────────────

/** Open a gap of `dur` ticks at `at`: whatever starts there or later moves later. */
function insertTime(p: Project, at: number, dur: number) {
  const later = <T extends { tick: number }>(x: T) => {
    if (x.tick >= at) x.tick += dur;
  };
  for (const t of p.tracks) {
    if (t.kind === "notes") t.notes.forEach(later);
    else {
      t.hits.forEach(later);
      t.clips.forEach(later);
    }
  }
  p.chords.forEach(later);
  for (const s of p.sections) {
    if (s.tick >= at) s.tick += dur;
    else if (s.tick + s.dur > at) s.dur += dur; // the gap opens inside it
  }
  // A change at tick 0 governs the song from its start, so it stays there.
  for (const list of [p.tempo, p.meter, p.key]) for (const e of list) if (e.tick >= at && e.tick > 0) e.tick += dur;
  p.pending?.slots.forEach(later);
  p.lengthTicks += dur;
}

/** Remove `dur` ticks from `at`: what starts inside goes, what overhangs is cut short, the rest moves up. */
function deleteTime(p: Project, at: number, dur: number) {
  const until = at + dur;
  const inside = (tick: number) => tick >= at && tick < until;
  const pull = <T extends { tick: number }>(list: T[]): T[] =>
    list.filter((x) => {
      if (inside(x.tick)) return false;
      if (x.tick >= until) x.tick -= dur;
      return true;
    });
  const trim = <T extends { tick: number; dur: number }>(list: T[]): T[] => {
    for (const x of list) if (x.tick < at && x.tick + x.dur > at) x.dur = Math.min(x.dur, at - x.tick);
    return pull(list);
  };
  for (const t of p.tracks) {
    if (t.kind === "notes") t.notes = trim(t.notes);
    else {
      t.hits = pull(t.hits);
      t.clips = pull(t.clips);
    }
  }
  p.chords = trim(p.chords);
  // A section keeps whatever part of it survives.
  const map = (tick: number) => (tick < at ? tick : tick < until ? at : tick - dur);
  p.sections = p.sections.filter((s) => {
    const start = map(s.tick);
    const end = map(s.tick + s.dur);
    s.tick = start;
    s.dur = end - start;
    return s.dur > 0;
  });
  // Tempo, meter and key: whatever was in force at the end of the cut is in force at the join.
  const mapEvents = <T extends { tick: number }>(list: T[]): T[] => {
    const out: T[] = [];
    for (const e of list) {
      const tick = map(e.tick);
      if (out.length && out[out.length - 1].tick === tick) out.pop();
      e.tick = tick;
      out.push(e);
    }
    return out;
  };
  p.tempo = mapEvents(p.tempo);
  p.meter = mapEvents(p.meter);
  p.key = mapEvents(p.key);
  if (p.pending) p.pending.slots = trim(p.pending.slots);
  p.lengthTicks = Math.max(0, map(p.lengthTicks));
}

/** Open a gap at `to` as long as the range, then fill it with a copy of the range. Never overwrites. */
function copyRange(p: Project, start: number, end: number, to: number) {
  const dur = end - start;
  const starts = (x: { tick: number }) => x.tick >= start && x.tick < end;
  // Take the copies before the gap opens, so a destination inside the range copies it as it was.
  const clip = <T extends { tick: number; dur: number }>(x: T): T => ({
    ...x,
    tick: x.tick - start + to,
    dur: Math.min(x.dur, end - x.tick),
  });
  const move = <T extends { tick: number }>(x: T): T => ({ ...x, tick: x.tick - start + to });
  const copies = p.tracks.map((t) =>
    t.kind === "notes"
      ? { notes: t.notes.filter(starts).map(clip) }
      : { hits: t.hits.filter(starts).map(move), clips: t.clips.filter(starts).map(move) },
  );
  const chords = p.chords.filter(starts).map(clip);
  const sections = p.sections.filter((s) => starts(s) && s.tick + s.dur <= end).map(move);

  // A chord sounding across the destination is split there, so the copy has room: its second half
  // carries on after the gap.
  const across = p.chords.find((c) => c.tick < to && c.tick + c.dur > to);
  if (across) {
    p.chords.push({ ...across, id: p.seq++, tick: to, dur: across.tick + across.dur - to });
    across.dur = to - across.tick;
  }
  insertTime(p, to, dur);

  p.tracks.forEach((t, i) => {
    const c = copies[i];
    if (t.kind === "notes") for (const n of c.notes ?? []) t.notes.push({ ...n, id: p.seq++ });
    else {
      for (const h of c.hits ?? []) t.hits.push({ ...h, id: p.seq++ });
      for (const k of c.clips ?? []) t.clips.push({ ...k, id: p.seq++ });
      t.clips.sort(byTickId);
    }
  });
  for (const c of chords) p.chords.push({ ...c, id: p.seq++ });
  for (const s of sections) p.sections.push({ ...s, id: `${s.id}-${p.seq++}` });
}
