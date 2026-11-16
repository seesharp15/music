import { describe, expect, it } from "vitest";
import { newProject } from "./new";
import { applyOps } from "./ops";
import { checkProject, parseProject } from "./schema";
import { MidiError, PAD_NOTE, parseMidi, projectFromMidi, projectToMidi } from "./midi";
import { randomOp, rng } from "./testing/random";
import type { NoteTrack, Project } from "./types";

const Q = 480;
const BAR = 1920;
const note = (pitch: number, tick: number, dur = Q, vel = 0.7) => ({
  pitch,
  tick,
  dur,
  vel,
  origin: "manual" as const,
});
const noteTracks = (p: Project) => p.tracks.filter((t): t is NoteTrack => t.kind === "notes");
const triples = (t: NoteTrack) => t.notes.map((n) => [n.pitch, n.tick, n.dur]);

/** A song in three tracks with a tempo change, a change of meter, a triplet, and drums. */
function song(): Project {
  return applyOps(newProject({ id: "p", title: "Für Elise (mine)", bpm: 96, bars: 6 }), [
    {
      op: "patchSong",
      patch: {
        tempo: [
          { tick: 0, bpm: 96 },
          { tick: 2 * BAR, bpm: 132.5 },
        ],
      },
    },
    {
      op: "patchSong",
      patch: {
        meter: [
          { tick: 0, numerator: 4, denominator: 4 },
          { tick: 4 * BAR, numerator: 6, denominator: 8 },
        ],
      },
    },
    {
      op: "addNotes",
      trackId: "melody",
      notes: [
        note(76, 0, 240),
        note(75, 240, 240),
        note(76, 480, 160),
        note(71, 640, 160),
        note(74, 800, 160),
        note(72, 960, 1437, 1),
        note(108, 3 * BAR, 60, 0.05),
      ],
    },
    {
      op: "addNotes",
      trackId: "chords",
      notes: [note(57, 0, BAR), note(60, 0, BAR), note(64, 0, BAR), note(52, BAR, 3 * Q)],
    },
    { op: "addNotes", trackId: "bass", notes: [note(21, 0, 4 * BAR), note(33, 4 * BAR, 1440)] },
    {
      op: "addHits",
      trackId: "drums",
      hits: [
        { pad: "snare", tick: Q, vel: 0.9, origin: "manual" },
        { pad: "cowbell", tick: 3 * Q, vel: 0.4, origin: "manual" },
      ],
    },
    {
      op: "putPattern",
      trackId: "drums",
      pattern: {
        id: "b",
        name: "Beat",
        stepsPerBar: 16,
        bars: 1,
        lanes: { kick: [1, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0] },
      },
    },
    { op: "placeClip", trackId: "drums", patternId: "b", tick: BAR, repeats: 2 },
  ]);
}

// ── Acceptance criterion 8 ──
describe("MIDI export, then MIDI import", () => {
  const before = song();
  const after = projectFromMidi(projectToMidi(before), { id: "q" });

  it("reproduces every note's pitch, tick and length, track by track", () => {
    const a = noteTracks(before);
    const b = noteTracks(after);
    expect(b.map((t) => t.name)).toEqual(a.map((t) => t.name));
    for (let i = 0; i < a.length; i++) expect(triples(b[i])).toEqual(triples(a[i]));
    expect(b.flatMap((t) => t.notes)).toHaveLength(13);
  });

  it("keeps tempo and time-signature changes where they were", () => {
    expect(after.tempo).toEqual(before.tempo);
    expect(after.meter).toEqual(before.meter);
    expect(after.lengthTicks).toBe(before.lengthTicks);
    expect(after.title).toBe("Für Elise (mine)");
  });

  it("keeps each track's part: melody for the right hand, chords and bass for the left", () => {
    expect(noteTracks(after).map((t) => [t.role, t.hand])).toEqual([
      ["melody", "R"],
      ["chords", "L"],
      ["bass", "L"],
    ]);
  });

  it("a track's part and hand survive even under a name that says nothing, and a lone track is not split", () => {
    const odd = applyOps(newProject({ id: "o" }), [
      { op: "patchTrack", trackId: "bass", patch: { name: "Zzz", role: "counter", hand: "R" } },
      { op: "addNotes", trackId: "bass", notes: [note(40, 0), note(80, Q)] },
    ]);
    const back = projectFromMidi(projectToMidi(odd), { id: "b" });
    expect(noteTracks(back).map((t) => [t.name, t.role, t.hand, triples(t)])).toEqual([
      [
        "Zzz",
        "counter",
        "R",
        [
          [40, 0, Q],
          [80, Q, Q],
        ],
      ],
    ]);
  });

  it("velocity survives to the nearest of MIDI's 127 steps, and is never silent", () => {
    const [melody] = noteTracks(after);
    expect(melody.notes[0].vel).toBeCloseTo(0.7, 2);
    expect(melody.notes.find((n) => n.pitch === 72)!.vel).toBe(1);
    expect(melody.notes.find((n) => n.pitch === 108)!.vel).toBeGreaterThan(0);
  });

  it("drums come back as hits on the same pads at the same places, patterns written out", () => {
    const drums = after.tracks.find((t) => t.kind === "drums")!;
    if (drums.kind !== "drums") throw new Error("no drums");
    expect(drums.hits.map((h) => [h.pad, h.tick])).toEqual([
      ["snare", Q],
      ["cowbell", 3 * Q],
      ["kick", BAR],
      ["kick", BAR + 960],
      ["kick", 2 * BAR],
      ["kick", 2 * BAR + 960],
    ]);
  });

  it("what comes back is a sound project, marked as imported", () => {
    expect(checkProject(after)).toEqual([]);
    expect(parseProject(JSON.parse(JSON.stringify(after))).ok).toBe(true);
    expect(after.source).toMatchObject({ kind: "midi" });
    expect(noteTracks(after).every((t) => t.notes.every((n) => n.origin === "imported"))).toBe(true);
  });

  it.each([1, 2, 3, 4])("seed %i: random songs make the trip with every note in place", (seed) => {
    const r = rng(seed);
    let p = newProject({ id: "r" });
    for (let i = 0; i < 120; i++) {
      try {
        p = applyOps(p, [randomOp(p, r, i)]);
      } catch {
        /* an edit the project refuses is not part of the song */
      }
    }
    const back = projectFromMidi(projectToMidi(p), { id: "s" });
    // Compare as sets of (pitch, start, length) per track: two notes of one pitch that overlap
    // are, to MIDI, one key pressed twice, and which release belongs to which press is not kept.
    const sound = (t: NoteTrack) => {
      const byPitch = new Map<number, { on: number[]; off: number[] }>();
      for (const n of t.notes) {
        const e = byPitch.get(n.pitch) ?? { on: [], off: [] };
        e.on.push(n.tick);
        e.off.push(n.tick + n.dur);
        byPitch.set(n.pitch, e);
      }
      return [...byPitch]
        .sort((a, b) => a[0] - b[0])
        .map(([pitch, e]) => [pitch, e.on.sort((a, b) => a - b), e.off.sort((a, b) => a - b)]);
    };
    const kept = noteTracks(p).filter((t) => t.notes.length);
    expect(
      noteTracks(back)
        .filter((t) => t.notes.length)
        .map(sound),
    ).toEqual(kept.map(sound));
    expect(checkProject(back)).toEqual([]);
  });
});

describe("the file itself", () => {
  const bytes = projectToMidi(song());
  it("is a format-1 Standard MIDI file at 480 ticks to the quarter note, one track per project track plus a conductor", () => {
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("MThd");
    expect([...bytes.slice(8, 14)]).toEqual([0, 1, 0, 5, 0x01, 0xe0]);
    const midi = parseMidi(bytes);
    expect(midi.division).toBe(480);
    expect(midi.tracks.map((t) => t.name)).toEqual(["Für Elise (mine)", "Melody", "Chords", "Bass", "Drums"]);
  });

  it("puts drums on channel 10 with General MIDI notes", () => {
    expect(PAD_NOTE.kick).toBe(36);
    expect(PAD_NOTE.snare).toBe(38);
    expect(new Set(Object.values(PAD_NOTE)).size).toBe(16);
  });
});

describe("reading other people's MIDI files", () => {
  /** Build a tiny file by hand: `division` ticks a quarter, the given tracks of raw events. */
  const file = (division: number, tracks: number[][], format = 1) => {
    const chunk = (body: number[]) => [
      0x4d,
      0x54,
      0x72,
      0x6b,
      0,
      0,
      (body.length >> 8) & 0xff,
      body.length & 0xff,
      ...body,
    ];
    return new Uint8Array([
      0x4d,
      0x54,
      0x68,
      0x64,
      0,
      0,
      0,
      6,
      0,
      format,
      0,
      tracks.length,
      division >> 8,
      division & 0xff,
      ...tracks.flatMap(chunk),
    ]);
  };
  const END = [0, 0xff, 0x2f, 0];

  it("rescales any resolution to 480, and reads running status and note-on-with-no-velocity as note-off", () => {
    // 96 ticks a quarter. C4 for a quarter, then E4 for a quarter, in running status.
    const p = projectFromMidi(file(96, [[0, 0x90, 60, 100, 96, 60, 0, 0, 64, 100, 96, 64, 0, ...END]]), { id: "x" });
    const all = noteTracks(p).flatMap((t) => t.notes.map((n) => [n.pitch, n.tick, n.dur]));
    expect(all).toEqual([
      [60, 0, 480],
      [64, 480, 480],
    ]);
  });

  it("a file with one track is split at middle C into a right hand and a left", () => {
    const p = projectFromMidi(
      file(480, [[0, 0x90, 72, 80, 0, 0x90, 48, 80, 0x83, 0x60, 0x80, 72, 0, 0, 0x80, 48, 0, ...END]]),
      { id: "x" },
    );
    const [right, left] = noteTracks(p);
    expect([right.name, right.hand, triples(right)]).toEqual(["Right hand", "R", [[72, 0, 480]]]);
    expect([left.name, left.hand, triples(left)]).toEqual(["Left hand", "L", [[48, 0, 480]]]);
  });

  it("but a lone track that says what part it is stays whole", () => {
    const named = [0, 0xff, 0x03, 4, 0x42, 0x61, 0x73, 0x73]; // track name "Bass"
    const p = projectFromMidi(
      file(480, [[...named, 0, 0x90, 72, 80, 0, 0x90, 40, 80, 0x83, 0x60, 0x80, 72, 0, 0, 0x80, 40, 0, ...END]]),
      { id: "x" },
    );
    expect(noteTracks(p).map((t) => [t.name, t.role, t.hand, t.notes.length])).toEqual([["Bass", "bass", "L", 2]]);
  });

  it("with no tempo or time signature in it, the song is at 120 in 4/4, and at least a bar long", () => {
    const p = projectFromMidi(file(480, [[0, 0x90, 60, 100, 0x83, 0x60, 0x80, 60, 0, ...END]]), {
      id: "x",
      title: "Mine",
    });
    expect(p.tempo).toEqual([{ tick: 0, bpm: 120 }]);
    expect(p.meter).toEqual([{ tick: 0, numerator: 4, denominator: 4 }]);
    expect(p.lengthTicks).toBe(BAR);
    expect(p.title).toBe("Mine");
    // With no name inside it, the file's own name will do; with neither, it still has one.
    const bare = file(480, [[0, 0x90, 60, 100, 0x83, 0x60, 0x80, 60, 0, ...END]]);
    expect(projectFromMidi(bare, { id: "x", fallbackTitle: "evening tune" }).title).toBe("evening tune");
    expect(projectFromMidi(bare, { id: "x" }).title).toBe("Imported song");
    expect(checkProject(p)).toEqual([]);
  });

  it("works a key out from the notes and says that it did", () => {
    const scale = [60, 62, 64, 65, 67, 69, 71, 72].flatMap((pitch) => [0, 0x90, pitch, 90, 0x83, 0x60, 0x80, pitch, 0]);
    const p = projectFromMidi(file(480, [[...scale, ...END]]), { id: "x" });
    expect(p.key).toEqual([{ tick: 0, tonic: "C", mode: "major" }]);
    expect(p.source?.warnings?.[0].text).toMatch(/worked out from the notes/);
  });

  it("notes off the piano, and keys never let go, are dealt with rather than refused", () => {
    const p = projectFromMidi(
      file(480, [[0, 0x90, 10, 100, 0, 0x90, 60, 100, 0x83, 0x60, 0x80, 10, 0, 0x83, 0x60, 0xff, 0x2f, 0]]),
      { id: "x" },
    );
    const all = noteTracks(p).flatMap((t) => t.notes.map((n) => [n.pitch, n.tick, n.dur]));
    expect(all).toEqual([[60, 0, 960]]);
  });

  it.each([
    [new Uint8Array([1, 2, 3]), /not a MIDI file/],
    [new TextEncoder().encode('{"format":"piano-project/v1"}'), /not a MIDI file/],
    [projectToMidi(song()).slice(0, 60), /cut off/],
    [new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 2, 0, 1, 1, 0xe0]), /type 2/],
    [new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 1, 0xe7, 0x28]), /film frames/],
  ])("refuses what it cannot read, saying why (%#)", (bytes, message) => {
    expect(() => projectFromMidi(bytes, { id: "x" })).toThrow(MidiError);
    expect(() => projectFromMidi(bytes, { id: "x" })).toThrow(message);
  });
});
