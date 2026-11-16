import { describe, expect, it } from "vitest";
import { EditError, type EditErrorCode } from "./errors";
import { drumTrack, newProject, noteTrack } from "./new";
import { applyOps, contentEnd } from "./ops";
import { checkProject, ProjectSchema } from "./schema";
import { randomOp, rng } from "./testing/random";
import type { DrumTrack, EditOp, NoteTrack, Project } from "./types";

const NOW = new Date("2026-11-16T12:00:00Z");
const fresh = () => newProject({ id: "p1", title: "Test", now: NOW });
const n = (pitch: number, tick: number, dur = 240, extra: object = {}) => ({
  pitch,
  tick,
  dur,
  vel: 0.7,
  origin: "manual" as const,
  ...extra,
});
const chord = (symbol: string, tick: number, dur = 1920) => ({ symbol, tick, dur, origin: "manual" as const });
const melody = (p: Project) => p.tracks.find((t) => t.id === "melody") as NoteTrack;
const drums = (p: Project) => p.tracks.find((t) => t.id === "drums") as DrumTrack;
const kick16 = {
  id: "beat",
  name: "Beat",
  stepsPerBar: 16,
  bars: 1 as const,
  lanes: { kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] },
};

/** A project with a little of everything in it. */
function furnished(): Project {
  return applyOps(fresh(), [
    {
      op: "addNotes",
      trackId: "melody",
      notes: [n(60, 0), n(62, 480), n(64, 960), n(65, 1440, 480, { origin: "suggested" })],
    },
    { op: "addNotes", trackId: "bass", notes: [n(36, 0, 1920), n(41, 1920, 1920)] },
    { op: "setChords", range: { start: 0, end: 3840 }, chords: [chord("C", 0), chord("F", 1920)] },
    { op: "putPattern", trackId: "drums", pattern: kick16 },
    { op: "placeClip", trackId: "drums", patternId: "beat", tick: 0, repeats: 2 },
    { op: "addHits", trackId: "drums", hits: [{ pad: "crash", tick: 0, vel: 0.9, origin: "tapped" }] },
    { op: "setSections", sections: [{ id: "a", name: "Verse", tick: 0, dur: 3840 }] },
  ]);
}

/** The op must be refused with this code and index, and the project must be exactly as it was. */
function refused(p: Project, ops: EditOp[], code: EditErrorCode, opIndex = ops.length - 1) {
  const before = structuredClone(p);
  let caught: unknown;
  try {
    applyOps(p, ops);
  } catch (err) {
    caught = err;
  }
  expect(caught, `expected ${code}`).toBeInstanceOf(EditError);
  expect((caught as EditError).code).toBe(code);
  expect((caught as EditError).opIndex).toBe(opIndex);
  expect((caught as EditError).message).toContain(ops[opIndex].op);
  expect(p).toEqual(before);
}

describe("newProject", () => {
  it("has a melody for the right hand, chords and bass for the left, and an empty drum track", () => {
    const p = fresh();
    expect(p.tracks.map((t) => [t.id, t.kind, t.kind === "notes" ? t.hand : null])).toEqual([
      ["melody", "notes", "R"],
      ["chords", "notes", "L"],
      ["bass", "notes", "L"],
      ["drums", "drums", null],
    ]);
    expect(p.tempo).toEqual([{ tick: 0, bpm: 100 }]);
    expect(p.lengthTicks).toBe(8 * 1920);
    expect(ProjectSchema.safeParse(p).success).toBe(true);
  });
  it("takes a title, tempo, meter and key", () => {
    const p = newProject({ title: "Waltz", bpm: 90, meter: [3, 4], key: { tonic: "A", mode: "minor" }, bars: 4 });
    expect(p).toMatchObject({
      title: "Waltz",
      tempo: [{ tick: 0, bpm: 90 }],
      key: [{ tick: 0, tonic: "A", mode: "minor" }],
    });
    expect(p.lengthTicks).toBe(4 * 1440);
    expect(newProject().id).not.toBe(newProject().id);
  });
});

describe("applyOps is all-or-nothing and leaves its input alone", () => {
  it("returns a new project and does not touch the old one", () => {
    const p = fresh();
    const before = structuredClone(p);
    const next = applyOps(p, [{ op: "addNotes", trackId: "melody", notes: [n(60, 0)] }]);
    expect(p).toEqual(before);
    expect(next).not.toBe(p);
    expect(melody(next).notes).toHaveLength(1);
    // What did not change is shared, not copied.
    expect(next.tracks[2]).toBe(p.tracks[2]);
  });
  it("applies nothing when a later op fails", () => {
    refused(
      furnished(),
      [
        { op: "addNotes", trackId: "melody", notes: [n(70, 0)] },
        { op: "removeNotes", trackId: "melody", ids: [999] },
      ],
      "unknownId",
      1,
    );
  });
  it("lets a later op use what an earlier one made", () => {
    const p = applyOps(fresh(), [
      { op: "addTrack", track: noteTrack("lead", "Lead", "counter", "R") },
      { op: "addNotes", trackId: "lead", notes: [n(72, 0)] },
    ]);
    expect((p.tracks[4] as NoteTrack).notes).toHaveLength(1);
  });
});

// ── Acceptance criterion 5: every refusal ────────────────────────────────────

describe("refused: an id that does not exist", () => {
  const p = furnished();
  const cases: [string, EditOp][] = [
    ["a track", { op: "addNotes", trackId: "nope", notes: [n(60, 0)] }],
    ["a track, removing notes", { op: "removeNotes", trackId: "nope", ids: [] }],
    ["a note to remove", { op: "removeNotes", trackId: "melody", ids: [1, 999] }],
    ["a note to patch", { op: "patchNotes", trackId: "melody", ids: [999], patch: { vel: 0.5 } }],
    ["a note to shift", { op: "shiftNotes", trackId: "melody", ids: [999], ticks: 0, semitones: 1 }],
    ["a note that belongs to another track", { op: "removeNotes", trackId: "bass", ids: [1] }],
    ["a hit to remove", { op: "removeHits", trackId: "drums", ids: [999] }],
    ["a hit to patch", { op: "patchHits", trackId: "drums", ids: [999], patch: { vel: 0.5 } }],
    ["a pattern to remove", { op: "removePattern", trackId: "drums", patternId: "nope" }],
    ["a pattern to place", { op: "placeClip", trackId: "drums", patternId: "nope", tick: 0, repeats: 1 }],
    ["a clip to remove", { op: "removeClip", trackId: "drums", id: 999 }],
    ["a track to remove", { op: "removeTrack", trackId: "nope" }],
    ["a track to patch", { op: "patchTrack", trackId: "nope", patch: { volume: 0.5 } }],
    ["an idea to remove", { op: "removeIdea", id: "nope" }],
    ["a track for a pending rhythm", { op: "setPending", pending: { trackId: "nope", slots: [] } }],
    [
      "a drum track with a clip of a pattern it does not have",
      { op: "addTrack", track: { ...drumTrack("d2"), clips: [{ id: 0, patternId: "nope", tick: 0, repeats: 1 }] } },
    ],
  ];
  it.each(cases)("%s", (_name, op) => refused(p, [op], "unknownId"));
});

describe("refused: off the keyboard, or before the start", () => {
  const p = furnished();
  const cases: [string, EditOp][] = [
    ["a new note below A0", { op: "addNotes", trackId: "melody", notes: [n(20, 0)] }],
    ["a new note above C8", { op: "addNotes", trackId: "melody", notes: [n(109, 0)] }],
    ["a note patched off the top", { op: "patchNotes", trackId: "melody", ids: [1], patch: { pitch: 120 } }],
    ["a note shifted off the bottom", { op: "shiftNotes", trackId: "bass", ids: [5], ticks: 0, semitones: -24 }],
    ["a note shifted before the start", { op: "shiftNotes", trackId: "melody", ids: [1], ticks: -480, semitones: 0 }],
    ["a new note before the start", { op: "addNotes", trackId: "melody", notes: [n(60, -10)] }],
    [
      "a hit before the start",
      { op: "addHits", trackId: "drums", hits: [{ pad: "kick", tick: -1, vel: 1, origin: "manual" }] },
    ],
    [
      "a note in a new track",
      { op: "addTrack", track: { ...noteTrack("x", "X", "free", "R"), notes: [{ ...n(200, 0), id: 0 }] } },
    ],
  ];
  it.each(cases)("%s", (_name, op) => refused(p, [op], "outOfRange"));
});

describe("refused: a length of zero or less, and other values that make no sense", () => {
  const p = furnished();
  const cases: [string, EditOp][] = [
    ["a note of no length", { op: "addNotes", trackId: "melody", notes: [n(60, 0, 0)] }],
    ["a note of negative length", { op: "addNotes", trackId: "melody", notes: [n(60, 0, -5)] }],
    ["a note patched to no length", { op: "patchNotes", trackId: "melody", ids: [1], patch: { dur: 0 } }],
    ["a chord of no length", { op: "setChords", range: { start: 0, end: 1920 }, chords: [chord("C", 0, 0)] }],
    ["a gap of no length", { op: "insertTime", tick: 0, dur: 0 }],
    ["a cut of no length", { op: "deleteTime", tick: 0, dur: 0 }],
    ["an empty range to copy", { op: "copyRange", from: { start: 480, end: 480 }, to: 0 }],
    ["a section of no length", { op: "setSections", sections: [{ id: "x", name: "X", tick: 0, dur: 0 }] }],
    [
      "a pending slot of no length",
      { op: "setPending", pending: { trackId: "melody", slots: [{ tick: 0, dur: 0, vel: 1 }] } },
    ],
    ["a fractional tick", { op: "addNotes", trackId: "melody", notes: [n(60, 0.5)] }],
    ["a velocity above 1", { op: "addNotes", trackId: "melody", notes: [n(60, 0, 240, { vel: 1.5 })] }],
    ["a pitch between the keys", { op: "addNotes", trackId: "melody", notes: [n(60.5, 0)] }],
    [
      "an origin nobody has heard of",
      { op: "addNotes", trackId: "melody", notes: [n(60, 0, 240, { origin: "dreamt" })] },
    ],
    ["notes into a drum track", { op: "addNotes", trackId: "drums", notes: [n(60, 0)] }],
    [
      "hits into a note track",
      { op: "addHits", trackId: "melody", hits: [{ pad: "kick", tick: 0, vel: 1, origin: "manual" }] },
    ],
    [
      "a pad that does not exist",
      { op: "addHits", trackId: "drums", hits: [{ pad: "gong" as "kick", tick: 0, vel: 1, origin: "manual" }] },
    ],
    [
      "a pattern whose lane is the wrong length",
      { op: "putPattern", trackId: "drums", pattern: { ...kick16, lanes: { kick: [1, 0, 1] } } },
    ],
    ["a pattern three bars long", { op: "putPattern", trackId: "drums", pattern: { ...kick16, bars: 3 as 1 } }],
    ["a clip that plays no times", { op: "placeClip", trackId: "drums", patternId: "beat", tick: 0, repeats: 0 }],
    ["a second track with the same id", { op: "addTrack", track: noteTrack("melody", "Again", "free", "R") }],
    ["a track volume above 1", { op: "patchTrack", trackId: "melody", patch: { volume: 2 } }],
    ["a kit on a note track", { op: "patchTrack", trackId: "melody", patch: { kit: "rock" } }],
    ["a hand on a drum track", { op: "patchTrack", trackId: "drums", patch: { hand: "L" } }],
    ["a sound that does not exist", { op: "patchTrack", trackId: "melody", patch: { sound: "kazoo" as "clear" } }],
    ["a chord that is not a chord", { op: "setChords", range: { start: 0, end: 1920 }, chords: [chord("Hxyz", 0)] }],
    [
      "a chord outside the range being set",
      { op: "setChords", range: { start: 0, end: 1920 }, chords: [chord("C", 1920)] },
    ],
    ["a range that ends before it starts", { op: "setChords", range: { start: 960, end: 0 }, chords: [] }],
    [
      "two sections with one id",
      {
        op: "setSections",
        sections: [
          { id: "x", name: "A", tick: 0, dur: 480 },
          { id: "x", name: "B", tick: 480, dur: 480 },
        ],
      },
    ],
    ["no tempo at all", { op: "patchSong", patch: { tempo: [] } }],
    ["a tempo that does not start at the start", { op: "patchSong", patch: { tempo: [{ tick: 480, bpm: 100 }] } }],
    ["a tempo of zero", { op: "patchSong", patch: { tempo: [{ tick: 0, bpm: 0 }] } }],
    [
      "two tempos at one tick",
      {
        op: "patchSong",
        patch: {
          tempo: [
            { tick: 0, bpm: 100 },
            { tick: 0, bpm: 90 },
          ],
        },
      },
    ],
    ["a bar of no beats", { op: "patchSong", patch: { meter: [{ tick: 0, numerator: 0, denominator: 4 }] } }],
    [
      "a beat that is a third note",
      { op: "patchSong", patch: { meter: [{ tick: 0, numerator: 4, denominator: 3 as 4 }] } },
    ],
    ["a key that is not a note", { op: "patchSong", patch: { key: [{ tick: 0, tonic: "H", mode: "major" }] } }],
    ["swing past the next beat", { op: "patchSong", patch: { swing: { amount: 1.2, unit: 8 } } }],
    ["a hand span of nothing", { op: "patchSong", patch: { handSpan: 0 } }],
    ["an operation that does not exist", { op: "explode" } as unknown as EditOp],
  ];
  it.each(cases)("%s", (_name, op) => refused(p, [op], "badValue"));
});

describe("refused: a chord that would overlap another", () => {
  const p = furnished(); // C at 0–1920, F at 1920–3840
  it("two new chords that overlap each other", () => {
    refused(
      p,
      [
        {
          op: "setChords",
          range: { start: 3840, end: 7680 },
          chords: [chord("G", 3840, 1920), chord("Am", 4800, 960)],
        },
      ],
      "overlap",
    );
  });
  it("a new chord that runs into one after the range", () => {
    refused(p, [{ op: "setChords", range: { start: 0, end: 1920 }, chords: [chord("G", 0, 2400)] }], "overlap");
  });
  it("a new chord under one that runs in from before the range", () => {
    refused(p, [{ op: "setChords", range: { start: 960, end: 1920 }, chords: [chord("G", 960, 960)] }], "overlap");
  });
  it("but replacing the chords in a range is fine", () => {
    const next = applyOps(p, [
      { op: "setChords", range: { start: 0, end: 1920 }, chords: [chord("Am", 0, 960), chord("G", 960, 960)] },
    ]);
    expect(next.chords.map((c) => c.symbol)).toEqual(["Am", "G", "F"]);
  });
});

describe("refused: any op addressed to a locked track, except the one that unlocks it", () => {
  const p = applyOps(furnished(), [
    { op: "patchTrack", trackId: "melody", patch: { locked: true } },
    { op: "patchTrack", trackId: "drums", patch: { locked: true } },
  ]);
  const cases: [string, EditOp][] = [
    ["adding notes", { op: "addNotes", trackId: "melody", notes: [n(60, 0)] }],
    ["removing notes", { op: "removeNotes", trackId: "melody", ids: [1] }],
    ["patching notes", { op: "patchNotes", trackId: "melody", ids: [1], patch: { vel: 0.1 } }],
    ["shifting notes", { op: "shiftNotes", trackId: "melody", ids: [1], ticks: 0, semitones: 1 }],
    ["adding hits", { op: "addHits", trackId: "drums", hits: [{ pad: "kick", tick: 0, vel: 1, origin: "manual" }] }],
    ["removing hits", { op: "removeHits", trackId: "drums", ids: [] }],
    ["patching hits", { op: "patchHits", trackId: "drums", ids: [], patch: {} }],
    ["putting a pattern", { op: "putPattern", trackId: "drums", pattern: kick16 }],
    ["removing a pattern", { op: "removePattern", trackId: "drums", patternId: "beat" }],
    ["placing a clip", { op: "placeClip", trackId: "drums", patternId: "beat", tick: 0, repeats: 1 }],
    ["removing a clip", { op: "removeClip", trackId: "drums", id: 9 }],
    ["removing the track", { op: "removeTrack", trackId: "melody" }],
    ["renaming the track", { op: "patchTrack", trackId: "melody", patch: { name: "Tune" } }],
    ["muting the track", { op: "patchTrack", trackId: "melody", patch: { muted: true } }],
    ["locking it again", { op: "patchTrack", trackId: "melody", patch: { locked: true } }],
    ["a pending rhythm for the track", { op: "setPending", pending: { trackId: "melody", slots: [] } }],
  ];
  it.each(cases)("%s", (_name, op) => refused(p, [op], "lockedTrack"));

  it("unlocking is accepted, and can carry other changes with it", () => {
    const next = applyOps(p, [{ op: "patchTrack", trackId: "melody", patch: { locked: false, name: "Tune" } }]);
    expect(melody(next)).toMatchObject({ locked: false, name: "Tune" });
    expect(applyOps(next, [{ op: "addNotes", trackId: "melody", notes: [n(72, 0)] }])).toBeTruthy();
  });
  it("other tracks are not affected, and operations on the whole song still move a locked track", () => {
    expect(applyOps(p, [{ op: "addNotes", trackId: "bass", notes: [n(40, 0)] }])).toBeTruthy();
    const next = applyOps(p, [{ op: "insertTime", tick: 0, dur: 1920 }]);
    expect(melody(next).notes[0].tick).toBe(1920);
  });
});

// ── Acceptance criterion 5: every silent correction ──────────────────────────

describe("put right silently", () => {
  it("ids come from seq, whatever came in", () => {
    const p = fresh();
    const next = applyOps(p, [
      { op: "addNotes", trackId: "melody", notes: [n(60, 0), n(62, 240)] },
      { op: "setChords", range: { start: 0, end: 1920 }, chords: [chord("C", 0)] },
      { op: "addHits", trackId: "drums", hits: [{ pad: "kick", tick: 0, vel: 1, origin: "manual" }] },
      { op: "putPattern", trackId: "drums", pattern: kick16 },
      { op: "placeClip", trackId: "drums", patternId: "beat", tick: 0, repeats: 1 },
      {
        op: "addTrack",
        track: {
          ...noteTrack("x", "X", "free", "R"),
          notes: [
            { ...n(70, 0), id: 1 },
            { ...n(71, 240), id: 1 },
          ],
        },
      },
    ]);
    const ids = [
      ...melody(next).notes.map((x) => x.id),
      next.chords[0].id,
      drums(next).hits[0].id,
      drums(next).clips[0].id,
      ...(next.tracks[4] as NoteTrack).notes.map((x) => x.id),
    ];
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(next.seq).toBe(8);
  });

  it("notes are kept sorted by tick, then pitch", () => {
    let p = applyOps(fresh(), [
      { op: "addNotes", trackId: "melody", notes: [n(64, 960), n(67, 0), n(60, 0), n(62, 480)] },
    ]);
    expect(melody(p).notes.map((x) => [x.tick, x.pitch])).toEqual([
      [0, 60],
      [0, 67],
      [480, 62],
      [960, 64],
    ]);
    const last = melody(p).notes[3].id;
    p = applyOps(p, [{ op: "patchNotes", trackId: "melody", ids: [last], patch: { tick: 240 } }]);
    expect(melody(p).notes.map((x) => x.tick)).toEqual([0, 0, 240, 480]);
    p = applyOps(p, [{ op: "shiftNotes", trackId: "melody", ids: [last], ticks: 1200, semitones: 0 }]);
    expect(melody(p).notes.map((x) => x.tick)).toEqual([0, 0, 480, 1440]);
  });

  it("chords, hits, clips and sections are kept sorted too", () => {
    const p = applyOps(fresh(), [
      { op: "setChords", range: { start: 0, end: 7680 }, chords: [chord("F", 3840), chord("C", 0), chord("G", 1920)] },
      {
        op: "addHits",
        trackId: "drums",
        hits: [
          { pad: "snare", tick: 480, vel: 1, origin: "manual" },
          { pad: "kick", tick: 0, vel: 1, origin: "manual" },
        ],
      },
      { op: "putPattern", trackId: "drums", pattern: kick16 },
      { op: "placeClip", trackId: "drums", patternId: "beat", tick: 3840, repeats: 1 },
      { op: "placeClip", trackId: "drums", patternId: "beat", tick: 0, repeats: 1 },
      {
        op: "setSections",
        sections: [
          { id: "b", name: "B", tick: 3840, dur: 1920 },
          { id: "a", name: "A", tick: 0, dur: 3840 },
        ],
      },
    ]);
    expect(p.chords.map((c) => c.symbol)).toEqual(["C", "G", "F"]);
    expect(drums(p).hits.map((h) => h.pad)).toEqual(["kick", "snare"]);
    expect(drums(p).clips.map((c) => c.tick)).toEqual([0, 3840]);
    expect(p.sections.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("the song grows to fit what is put in it, and cannot be made shorter than its music", () => {
    let p = fresh();
    expect(p.lengthTicks).toBe(15360);
    p = applyOps(p, [{ op: "addNotes", trackId: "melody", notes: [n(60, 20000, 480)] }]);
    expect(p.lengthTicks).toBe(20480);
    p = applyOps(p, [{ op: "patchSong", patch: { lengthTicks: 100 } }]);
    expect(p.lengthTicks).toBe(20480);
    p = applyOps(p, [{ op: "setChords", range: { start: 19200, end: 30000 }, chords: [chord("C", 19200, 3840)] }]);
    expect(p.lengthTicks).toBe(23040);
    expect(contentEnd(p)).toBe(23040);
    // A longer song than its music is allowed: trailing empty bars.
    expect(applyOps(p, [{ op: "patchSong", patch: { lengthTicks: 99999 } }]).lengthTicks).toBe(99999);
  });

  it("a note that was not the author's own is marked edited when they change it", () => {
    let p = fresh();
    p = applyOps(p, [
      {
        op: "addNotes",
        trackId: "melody",
        notes: [
          n(60, 0, 240, { origin: "suggested" }),
          n(62, 240, 240, { origin: "hummed" }),
          n(64, 480, 240, { origin: "imported" }),
        ],
      },
      {
        op: "addNotes",
        trackId: "melody",
        notes: [
          n(65, 720, 240, { origin: "manual" }),
          n(67, 960, 240, { origin: "played" }),
          n(69, 1200, 240, { origin: "tapped" }),
        ],
      },
    ]);
    expect(melody(p).notes.every((x) => x.edited === undefined)).toBe(true);
    const ids = melody(p).notes.map((x) => x.id);
    p = applyOps(p, [{ op: "patchNotes", trackId: "melody", ids, patch: { vel: 0.4 } }]);
    expect(melody(p).notes.map((x) => x.edited)).toEqual([true, true, true, undefined, undefined, undefined]);
  });

  it("shifting marks them too; a shift of nothing does not; and the caller can say otherwise", () => {
    let p = applyOps(fresh(), [
      {
        op: "addNotes",
        trackId: "melody",
        notes: [n(60, 0, 240, { origin: "suggested" }), n(62, 240, 240, { origin: "suggested" })],
      },
    ]);
    const [a, b] = melody(p).notes.map((x) => x.id);
    p = applyOps(p, [{ op: "shiftNotes", trackId: "melody", ids: [a, b], ticks: 0, semitones: 0 }]);
    expect(melody(p).notes.map((x) => x.edited)).toEqual([undefined, undefined]);
    p = applyOps(p, [{ op: "shiftNotes", trackId: "melody", ids: [a], ticks: 0, semitones: 2 }]);
    expect(melody(p).notes.find((x) => x.id === a)!.edited).toBe(true);
    p = applyOps(p, [{ op: "patchNotes", trackId: "melody", ids: [b], patch: { vel: 0.2, edited: false } }]);
    expect(melody(p).notes.find((x) => x.id === b)!.edited).toBe(false);
  });

  it("chord symbols are stored in their canonical spelling", () => {
    const p = applyOps(fresh(), [
      {
        op: "setChords",
        range: { start: 0, end: 7680 },
        chords: [chord("CM7", 0), chord("a-7", 1920), chord("F♯ø", 3840)],
      },
    ]);
    expect(p.chords.map((c) => c.symbol)).toEqual(["Cmaj7", "Am7", "F#m7b5"]);
  });

  it("tempo, meter and key entries are put in order", () => {
    const p = applyOps(fresh(), [
      {
        op: "patchSong",
        patch: {
          tempo: [
            { tick: 1920, bpm: 90 },
            { tick: 0, bpm: 120 },
          ],
        },
      },
    ]);
    expect(p.tempo).toEqual([
      { tick: 0, bpm: 120 },
      { tick: 1920, bpm: 90 },
    ]);
  });
});

// ── What each operation does ─────────────────────────────────────────────────

describe("notes, hits, patterns and clips", () => {
  it("removes and patches notes by id", () => {
    let p = furnished();
    p = applyOps(p, [{ op: "removeNotes", trackId: "melody", ids: [2, 3] }]);
    expect(melody(p).notes.map((x) => x.id)).toEqual([1, 4]);
    p = applyOps(p, [{ op: "patchNotes", trackId: "melody", ids: [1], patch: { hand: "L", offset: 7 } }]);
    expect(melody(p).notes[0]).toMatchObject({ hand: "L", offset: 7 });
    p = applyOps(p, [{ op: "patchNotes", trackId: "melody", ids: [1], patch: { offset: undefined } }]);
    expect("offset" in melody(p).notes[0]).toBe(false);
  });
  it("replaces a pattern with the same id, and removing a pattern removes its clips", () => {
    let p = furnished();
    p = applyOps(p, [{ op: "putPattern", trackId: "drums", pattern: { ...kick16, name: "Renamed" } }]);
    expect(drums(p).patterns).toHaveLength(1);
    expect(drums(p).patterns[0].name).toBe("Renamed");
    p = applyOps(p, [{ op: "removePattern", trackId: "drums", patternId: "beat" }]);
    expect(drums(p).patterns).toEqual([]);
    expect(drums(p).clips).toEqual([]);
  });
  it("patches and removes hits and clips", () => {
    let p = furnished();
    const hitId = drums(p).hits[0].id;
    p = applyOps(p, [{ op: "patchHits", trackId: "drums", ids: [hitId], patch: { pad: "ride", vel: 0.5 } }]);
    expect(drums(p).hits[0]).toMatchObject({ pad: "ride", vel: 0.5 });
    p = applyOps(p, [
      { op: "removeHits", trackId: "drums", ids: [hitId] },
      { op: "removeClip", trackId: "drums", id: drums(p).clips[0].id },
    ]);
    expect(drums(p).hits).toEqual([]);
    expect(drums(p).clips).toEqual([]);
  });
});

describe("tracks, ideas and the pending rhythm", () => {
  it("adds a track where asked, and removes one along with its pending rhythm", () => {
    let p = applyOps(fresh(), [{ op: "addTrack", track: noteTrack("lead", "Lead", "counter", "R"), index: 1 }]);
    expect(p.tracks.map((t) => t.id)).toEqual(["melody", "lead", "chords", "bass", "drums"]);
    p = applyOps(p, [{ op: "setPending", pending: { trackId: "lead", slots: [{ tick: 0, dur: 240, vel: 0.8 }] } }]);
    expect(p.pending?.trackId).toBe("lead");
    p = applyOps(p, [{ op: "removeTrack", trackId: "lead" }]);
    expect(p.tracks.map((t) => t.id)).toEqual(["melody", "chords", "bass", "drums"]);
    expect(p.pending).toBeUndefined();
  });
  it("clears the pending rhythm", () => {
    let p = applyOps(fresh(), [{ op: "setPending", pending: { trackId: "melody", slots: [] } }]);
    p = applyOps(p, [{ op: "setPending", pending: undefined }]);
    expect("pending" in p).toBe(false);
  });
  it("puts, replaces and removes ideas", () => {
    const idea = {
      id: "i1",
      kind: "melody" as const,
      label: "First",
      createdAt: "2026-11-16",
      source: "author" as const,
      ops: [],
    };
    let p = applyOps(fresh(), [{ op: "putIdea", idea }]);
    p = applyOps(p, [{ op: "putIdea", idea: { ...idea, label: "Second" } }]);
    expect(p.ideas.map((i) => i.label)).toEqual(["Second"]);
    expect(applyOps(p, [{ op: "removeIdea", id: "i1" }]).ideas).toEqual([]);
  });
  it("patches the song", () => {
    const p = applyOps(fresh(), [
      {
        op: "patchSong",
        patch: { title: "New", author: "Me", handSpan: 12, swing: { amount: 0.6, unit: 16 }, brief: { mood: "calm" } },
      },
    ]);
    expect(p).toMatchObject({
      title: "New",
      author: "Me",
      handSpan: 12,
      swing: { amount: 0.6, unit: 16 },
      brief: { mood: "calm" },
    });
  });
});

describe("insertTime", () => {
  it("moves everything at or after the point later, and leaves what came before", () => {
    const p = applyOps(furnished(), [{ op: "insertTime", tick: 960, dur: 1920 }]);
    expect(melody(p).notes.map((x) => x.tick)).toEqual([0, 480, 2880, 3360]);
    expect(p.chords.map((c) => [c.tick, c.dur])).toEqual([
      [0, 1920],
      [3840, 1920],
    ]);
    expect(p.sections[0]).toMatchObject({ tick: 0, dur: 5760 }); // the gap opened inside the section
    expect(p.lengthTicks).toBe(15360 + 1920);
  });
  it("moves tempo, meter and key changes, but never the ones at the start", () => {
    let p = applyOps(fresh(), [
      {
        op: "patchSong",
        patch: {
          tempo: [
            { tick: 0, bpm: 100 },
            { tick: 1920, bpm: 80 },
          ],
        },
      },
    ]);
    p = applyOps(p, [{ op: "insertTime", tick: 0, dur: 1920 }]);
    expect(p.tempo).toEqual([
      { tick: 0, bpm: 100 },
      { tick: 3840, bpm: 80 },
    ]);
    expect(p.meter[0].tick).toBe(0);
    expect(p.key[0].tick).toBe(0);
  });
});

describe("deleteTime", () => {
  it("removes what starts inside, trims what overhangs, and pulls the rest earlier", () => {
    // Melody at 0, 480, 960, 1440(len 480); bass 0–1920 and 1920–3840. Cut 480–1440.
    const p = applyOps(furnished(), [{ op: "deleteTime", tick: 480, dur: 960 }]);
    expect(melody(p).notes.map((x) => [x.pitch, x.tick])).toEqual([
      [60, 0],
      [65, 480],
    ]);
    const bass = p.tracks.find((t) => t.id === "bass") as NoteTrack;
    expect(bass.notes.map((x) => [x.tick, x.dur])).toEqual([
      [0, 480],
      [960, 1920],
    ]);
    expect(p.chords.map((c) => [c.symbol, c.tick, c.dur])).toEqual([
      ["C", 0, 480],
      ["F", 960, 1920],
    ]);
    expect(p.sections[0]).toMatchObject({ tick: 0, dur: 2880 });
    expect(p.lengthTicks).toBe(15360 - 960);
    expect(checkProject(p)).toEqual([]);
  });
  it("keeps the tempo that was in force at the end of the cut", () => {
    let p = applyOps(fresh(), [
      {
        op: "patchSong",
        patch: {
          tempo: [
            { tick: 0, bpm: 100 },
            { tick: 960, bpm: 80 },
            { tick: 3840, bpm: 60 },
          ],
        },
      },
    ]);
    p = applyOps(p, [{ op: "deleteTime", tick: 0, dur: 1920 }]);
    expect(p.tempo).toEqual([
      { tick: 0, bpm: 80 },
      { tick: 1920, bpm: 60 },
    ]);
  });
  it("undoes an insert made where nothing is sounding", () => {
    const p = furnished();
    const round = applyOps(p, [
      { op: "insertTime", tick: 1920, dur: 1920 },
      { op: "deleteTime", tick: 1920, dur: 1920 },
    ]);
    expect(round).toEqual(p);
  });
});

describe("copyRange", () => {
  it("opens a gap and fills it with a copy, with new ids, never overwriting", () => {
    const p = furnished();
    const next = applyOps(p, [{ op: "copyRange", from: { start: 0, end: 1920 }, to: 1920 }]);
    // The first bar now appears twice; what was the second bar follows.
    expect(melody(next).notes.map((x) => [x.pitch, x.tick])).toEqual([
      [60, 0],
      [62, 480],
      [64, 960],
      [65, 1440],
      [60, 1920],
      [62, 2400],
      [64, 2880],
      [65, 3360],
    ]);
    expect(next.chords.map((c) => [c.symbol, c.tick])).toEqual([
      ["C", 0],
      ["C", 1920],
      ["F", 3840],
    ]);
    expect(drums(next).hits.map((h) => h.tick)).toEqual([0, 1920]);
    expect(new Set(melody(next).notes.map((x) => x.id)).size).toBe(8);
    expect(next.lengthTicks).toBe(p.lengthTicks + 1920);
    expect(checkProject(next)).toEqual([]);
    // The copy of a suggested note is still a suggested note.
    expect(melody(next).notes[7].origin).toBe("suggested");
  });
  it("cuts a copied note short at the end of the range, and splits a chord sounding across the destination", () => {
    const p = furnished();
    // Bass note 0–1920 copied from the range 0–960: the copy lasts 960. Destination 2400 is inside F (1920–3840).
    const next = applyOps(p, [{ op: "copyRange", from: { start: 0, end: 960 }, to: 2400 }]);
    const bass = next.tracks.find((t) => t.id === "bass") as NoteTrack;
    expect(bass.notes.map((x) => [x.tick, x.dur])).toEqual([
      [0, 1920],
      [1920, 1920],
      [2400, 960],
    ]);
    expect(next.chords.map((c) => [c.symbol, c.tick, c.dur])).toEqual([
      ["C", 0, 1920],
      ["F", 1920, 480],
      ["C", 2400, 960],
      ["F", 3360, 1440],
    ]);
    expect(checkProject(next)).toEqual([]);
  });
  it("can copy a range into itself", () => {
    const next = applyOps(furnished(), [{ op: "copyRange", from: { start: 0, end: 1920 }, to: 960 }]);
    expect(melody(next).notes.map((x) => [x.pitch, x.tick])).toEqual([
      [60, 0],
      [62, 480],
      [60, 960],
      [62, 1440],
      [64, 1920],
      [65, 2400],
      [64, 2880],
      [65, 3360],
    ]);
    expect(checkProject(next)).toEqual([]);
  });
});

// ── Property: whatever valid edits are made, the project stays sound ─────────

describe("any sequence of valid edits leaves a valid project", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])("seed %i: 300 random edits", (seed) => {
    const r = rng(seed);
    let p = furnished();
    const kinds = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const op = randomOp(p, r, i);
      kinds.add(op.op);
      const before = p;
      try {
        p = applyOps(p, [op]);
      } catch (err) {
        throw new Error(`seed ${seed}, edit ${i}: ${JSON.stringify(op)} → ${(err as Error).message}`, { cause: err });
      }
      const problems = checkProject(p);
      if (problems.length) throw new Error(`seed ${seed}, edit ${i}: ${JSON.stringify(op)} → ${problems.join("; ")}`);
      expect(before).not.toBe(undefined);
    }
    const parsed = ProjectSchema.safeParse(JSON.parse(JSON.stringify(p)));
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 3))).toBe(true);
    expect(kinds.size).toBeGreaterThanOrEqual(20);
  });

  it("the generator covers every kind of edit", () => {
    const r = rng(99);
    let p = furnished();
    const kinds = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const op = randomOp(p, r, i);
      kinds.add(op.op);
      p = applyOps(p, [op]);
    }
    expect([...kinds].sort()).toEqual(
      [
        "addHits",
        "addNotes",
        "addTrack",
        "copyRange",
        "deleteTime",
        "insertTime",
        "patchHits",
        "patchNotes",
        "patchSong",
        "patchTrack",
        "placeClip",
        "putIdea",
        "putPattern",
        "removeClip",
        "removeHits",
        "removeIdea",
        "removeNotes",
        "removePattern",
        "removeTrack",
        "setChords",
        "setPending",
        "setSections",
        "shiftNotes",
      ].sort(),
    );
  });
});
