import { describe, expect, it } from "vitest";
import { makeTimeMap } from "../../music/time";
import { drumTrack, newProject } from "../../project/new";
import { applyOps } from "../../project/ops";
import { checkProject } from "../../project/schema";
import type { DrumTrack, NoteTrack, Project } from "../../project/types";
import { addSection, barsOf, deleteSection, duplicateSection, moveSection, patchSection, resizeSection } from "./ops";

const BAR = 1920;
const Q = 480;

/**
 * A song with three note tracks and a drum clip: a four-bar Verse (bars 1–4) and a four-bar Chorus
 * (bars 5–8), each with its own notes, chords and beat, and something after them at bar 9.
 */
function song(): Project {
  const beat = (id: string, kick: number[]) => ({
    id,
    name: id,
    stepsPerBar: 16 as const,
    bars: 1 as const,
    lanes: { kick },
  });
  const four = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
  const two = [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0];
  const quarter = (pitch: number, tick: number, dur = Q) => ({ pitch, tick, dur, vel: 0.7, origin: "manual" as const });
  return applyOps(newProject({ id: "p", bars: 12 }), [
    { op: "addNotes", trackId: "melody", notes: [60, 62, 64, 65, 67, 69, 71, 72].map((p, i) => quarter(p, i * 2 * Q)) },
    { op: "addNotes", trackId: "melody", notes: [76, 74, 72, 71].map((p, i) => quarter(p, 4 * BAR + i * BAR, BAR)) },
    { op: "addNotes", trackId: "melody", notes: [quarter(84, 8 * BAR)] },
    { op: "addNotes", trackId: "chords", notes: [48, 52, 55].map((p) => quarter(p, 0, 4 * BAR)) },
    { op: "addNotes", trackId: "chords", notes: [53, 57, 60].map((p) => quarter(p, 4 * BAR, 4 * BAR)) },
    { op: "addNotes", trackId: "bass", notes: [36, 36, 43, 36].map((p, i) => quarter(p, i * BAR, BAR)) },
    { op: "addNotes", trackId: "bass", notes: [41, 41, 43, 43].map((p, i) => quarter(p, 4 * BAR + i * BAR, BAR)) },
    {
      op: "setChords",
      range: { start: 0, end: 8 * BAR },
      chords: [
        { tick: 0, dur: 4 * BAR, symbol: "C", origin: "manual" },
        { tick: 4 * BAR, dur: 2 * BAR, symbol: "F", origin: "manual" },
        { tick: 6 * BAR, dur: 2 * BAR, symbol: "G", origin: "manual" },
      ],
    },
    { op: "putPattern", trackId: "drums", pattern: beat("verse-beat", two) },
    { op: "putPattern", trackId: "drums", pattern: beat("chorus-beat", four) },
    { op: "placeClip", trackId: "drums", patternId: "verse-beat", tick: 0, repeats: 4 },
    { op: "placeClip", trackId: "drums", patternId: "chorus-beat", tick: 4 * BAR, repeats: 4 },
    {
      op: "setSections",
      sections: [
        { id: "verse", name: "Verse", tick: 0, dur: 4 * BAR },
        { id: "chorus", name: "Chorus", tick: 4 * BAR, dur: 4 * BAR },
      ],
    },
  ]);
}

const apply = (p: Project, edit: { ops: Parameters<typeof applyOps>[1] } | null) => {
  if (!edit) throw new Error("no edit");
  const next = applyOps(p, edit.ops);
  expect(checkProject(next)).toEqual([]);
  return next;
};

/** Everything that starts in a range, with ticks counted from its start, and no ids. */
function contents(p: Project, start: number, end: number) {
  const inside = (x: { tick: number }) => x.tick >= start && x.tick < end;
  const at = <T extends { tick: number }>(x: T) => ({ ...x, tick: x.tick - start, id: undefined });
  return {
    tracks: p.tracks.map((t) =>
      t.kind === "notes"
        ? (t as NoteTrack).notes.filter(inside).map(at)
        : { clips: (t as DrumTrack).clips.filter(inside).map(at), hits: (t as DrumTrack).hits.filter(inside).map(at) },
    ),
    chords: p.chords.filter(inside).map(at),
  };
}
const names = (p: Project) => p.sections.map((s) => [s.name, s.tick / BAR, s.dur / BAR]);

// ── Acceptance criterion 6 ──
describe("duplicating a section", () => {
  it("a four-bar section becomes eight bars whose second half equals the first, on every track", () => {
    const before = song();
    const after = apply(before, duplicateSection(before, "verse"));
    const first = contents(after, 0, 4 * BAR);
    const second = contents(after, 4 * BAR, 8 * BAR);
    expect(second).toEqual(first);
    // And the first half is what it was.
    expect(first).toEqual(contents(before, 0, 4 * BAR));
    // Three note tracks and a drum clip, all there.
    expect(first.tracks.map((t) => (Array.isArray(t) ? t.length : t.clips.length))).toEqual([8, 3, 4, 1]);
    expect(first.chords).toHaveLength(1);
    // What came after has moved four bars later, untouched.
    expect(contents(after, 8 * BAR, 12 * BAR)).toEqual(contents(before, 4 * BAR, 8 * BAR));
    expect(names(after)).toEqual([
      ["Verse", 0, 4],
      ["Verse", 4, 4],
      ["Chorus", 8, 4],
    ]);
    expect(after.lengthTicks).toBe(before.lengthTicks + 4 * BAR);
    expect(new Set(after.sections.map((s) => s.id)).size).toBe(3);
  });

  it("is one operation, so undo is one step", () => {
    expect(duplicateSection(song(), "verse")!.ops).toHaveLength(1);
  });
});

describe("moving a section", () => {
  it("moves its notes, chords and clips together, and what it changes places with moves the other way", () => {
    const before = song();
    const verse = contents(before, 0, 4 * BAR);
    const chorus = contents(before, 4 * BAR, 8 * BAR);
    const after = apply(before, moveSection(before, "chorus", -1));
    expect(contents(after, 0, 4 * BAR)).toEqual(chorus);
    expect(contents(after, 4 * BAR, 8 * BAR)).toEqual(verse);
    expect(names(after)).toEqual([
      ["Chorus", 0, 4],
      ["Verse", 4, 4],
    ]);
    // Nothing else moved, and the song is as long as it was.
    expect(contents(after, 8 * BAR, 12 * BAR)).toEqual(contents(before, 8 * BAR, 12 * BAR));
    expect(after.lengthTicks).toBe(before.lengthTicks);
    expect(after.chords.map((c) => [c.symbol, c.tick / BAR])).toEqual([
      ["F", 0],
      ["G", 2],
      ["C", 4],
    ]);
  });

  it("later is the same swap seen from the other side", () => {
    const before = song();
    const up = apply(before, moveSection(before, "chorus", -1));
    const down = apply(before, moveSection(before, "verse", 1));
    expect(contents(down, 0, 12 * BAR)).toEqual(contents(up, 0, 12 * BAR));
    expect(names(down)).toEqual(names(up));
  });

  it("moved there and back, the song is what it was", () => {
    const before = song();
    const there = apply(before, moveSection(before, "chorus", -1));
    const chorusNow = there.sections.find((s) => s.name === "Chorus")!.id;
    const back = apply(there, moveSection(there, chorusNow, 1));
    expect(contents(back, 0, 12 * BAR)).toEqual(contents(before, 0, 12 * BAR));
    expect(names(back)).toEqual(names(before));
  });

  it("the first cannot go earlier, nor the last later, nor sections that overlap change places", () => {
    const p = song();
    expect(moveSection(p, "verse", -1)).toBeNull();
    expect(moveSection(p, "chorus", 1)).toBeNull();
    expect(moveSection(p, "nothing", 1)).toBeNull();
    const overlapping = applyOps(p, [
      {
        op: "setSections",
        sections: [
          { id: "a", name: "A", tick: 0, dur: 6 * BAR },
          { id: "b", name: "B", tick: 4 * BAR, dur: 4 * BAR },
        ],
      },
    ]);
    expect(moveSection(overlapping, "b", -1)).toBeNull();
  });
});

describe("deleting a section", () => {
  it("closing the gap: its music goes and what followed moves up", () => {
    const before = song();
    const after = apply(before, deleteSection(before, "verse", "close"));
    expect(contents(after, 0, 4 * BAR)).toEqual(contents(before, 4 * BAR, 8 * BAR));
    expect(names(after)).toEqual([["Chorus", 0, 4]]);
    expect(after.lengthTicks).toBe(before.lengthTicks - 4 * BAR);
  });

  it("leaving its bars empty: its music goes and nothing else moves", () => {
    const before = song();
    const after = apply(before, deleteSection(before, "verse", "empty"));
    const emptied = contents(after, 0, 4 * BAR);
    expect(emptied.chords).toEqual([]);
    expect(emptied.tracks.every((t) => (Array.isArray(t) ? t.length === 0 : t.clips.length === 0))).toBe(true);
    expect(contents(after, 4 * BAR, 12 * BAR)).toEqual(contents(before, 4 * BAR, 12 * BAR));
    expect(names(after)).toEqual([["Chorus", 4, 4]]);
    expect(after.lengthTicks).toBe(before.lengthTicks);
  });

  it("just the name: the music stays exactly as it is", () => {
    const before = song();
    const after = apply(before, deleteSection(before, "verse", "label"));
    expect(after.tracks).toEqual(before.tracks);
    expect(after.chords).toEqual(before.chords);
    expect(names(after)).toEqual([["Chorus", 4, 4]]);
  });
});

describe("adding, renaming, resizing", () => {
  it("at the end: after the last section, four bars, with the next usual name and its own colour", () => {
    const before = song();
    const after = apply(before, addSection(before, "end"));
    expect(names(after)).toEqual([
      ["Verse", 0, 4],
      ["Chorus", 4, 4],
      ["Intro", 8, 4],
    ]);
    expect(after.sections[2].color).toBeTruthy();
    const empty = newProject({ id: "e" });
    expect(names(apply(empty, addSection(empty, "end")))).toEqual([["Intro", 0, 4]]);
  });

  it("at the cursor: on its bar line, and no further than the next section", () => {
    const base = applyOps(song(), [
      { op: "setSections", sections: [{ id: "chorus", name: "Chorus", tick: 4 * BAR, dur: 4 * BAR }] },
    ]);
    expect(names(apply(base, addSection(base, 2 * BAR + 700)))).toEqual([
      ["Intro", 2, 2],
      ["Chorus", 4, 4],
    ]);
    expect(names(apply(base, addSection(base, 9 * BAR)))[1]).toEqual(["Intro", 9, 4]);
  });

  it("a section added past the end makes the song longer", () => {
    const short = newProject({ id: "s", bars: 2 });
    expect(apply(short, addSection(short, "end")).lengthTicks).toBe(4 * BAR);
  });

  it("rename and recolour change only that; resize changes how many bars the label covers, not the music", () => {
    const before = song();
    const renamed = apply(before, patchSection(before, "verse", { name: "Verse 1" }));
    expect(names(renamed)[0]).toEqual(["Verse 1", 0, 4]);
    const resized = apply(before, resizeSection(before, "verse", 2));
    expect(names(resized)[0]).toEqual(["Verse", 0, 2]);
    expect(resized.tracks).toEqual(before.tracks);
    expect(resizeSection(before, "verse", 0)).toBeNull();
    expect(patchSection(before, "nothing", { name: "x" })).toBeNull();
  });

  it("counts bars across a change of meter", () => {
    const time = makeTimeMap(
      [{ tick: 0, bpm: 100 }],
      [
        { tick: 0, numerator: 4, denominator: 4 },
        { tick: 2 * BAR, numerator: 3, denominator: 4 },
      ],
    );
    expect(barsOf({ tick: 0, dur: 2 * BAR + 2 * 1440 }, time)).toBe(4);
    expect(barsOf({ tick: BAR, dur: BAR + 100 }, time)).toBe(2);
  });
});

it("a drum track with nothing in it is left as it is by every operation", () => {
  const p = applyOps(song(), [{ op: "addTrack", track: drumTrack("perc", "Percussion") }]);
  const after = apply(p, duplicateSection(p, "verse"));
  expect(after.tracks.find((t) => t.id === "perc")).toEqual(p.tracks.find((t) => t.id === "perc"));
});
