import { describe, expect, it } from "vitest";
import { analyzeRhythm, countLabel, momentIndexAt, positionOf } from "./rhythm";
import type { Hand, Note, Song } from "./types";

const n = (time: number, hand: Hand = "R", pitch = 60): Note => ({ pitch, time, duration: 0.2, hand });
const song = (notes: Note[], over: Partial<Song> = {}): Song => ({
  format: "piano-song/v1",
  id: "t",
  title: "T",
  bpm: 120, // a beat is 0.5 s, an eighth 0.25 s, a sixteenth 0.125 s
  notes,
  ...over,
});

describe("analyzeRhythm", () => {
  it("reads the beat and bar from the song, defaulting to 120 BPM in 4", () => {
    expect(analyzeRhythm(song([], { bpm: 100, timeSignature: [3, 4] }))).toMatchObject({ beat: 0.6, perBar: 3 });
    expect(analyzeRhythm(song([], { bpm: undefined }))).toMatchObject({ beat: 0.5, perBar: 4 });
  });

  it("merges notes that start within 30 ms into one moment, and keeps them apart beyond that", () => {
    const r = analyzeRhythm(song([n(1, "L", 48), n(1.02, "R", 64), n(1.06, "R", 67)]));
    expect(r.moments).toHaveLength(2);
    expect([...r.moments[0].hands].sort()).toEqual(["L", "R"]);
    expect(r.moments[0].pitches).toEqual({ L: [48], R: [64] });
    expect(r.moments[1].time).toBe(1.06);
  });

  it("counts in eighths when the notes sit on eighths", () => {
    const r = analyzeRhythm(song([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75].map((t) => n(t))));
    expect(r.sub).toBe(2);
    expect(r.cell).toBe(0.25);
  });

  it("counts in sixteenths once more than one onset in twenty falls between eighths", () => {
    const eighths = Array.from({ length: 19 }, (_, i) => n(i * 0.25));
    expect(analyzeRhythm(song([...eighths, n(4.875)])).sub).toBe(2); // 1 in 20: not enough
    const r = analyzeRhythm(song([...eighths, n(4.875), n(5.125)])); // 2 in 21
    expect(r.sub).toBe(4);
    expect(r.cell).toBe(0.125);
  });
});

describe("momentIndexAt", () => {
  const moments = analyzeRhythm(song([n(1), n(2), n(3)])).moments;
  it("finds the last moment at or before a time", () => {
    expect(momentIndexAt(moments, 0.5)).toBe(-1);
    expect(momentIndexAt(moments, 1)).toBe(0);
    expect(momentIndexAt(moments, 2.5)).toBe(1);
    expect(momentIndexAt(moments, 99)).toBe(2);
  });
});

describe("positionOf and countLabel", () => {
  const eighths = analyzeRhythm(song([n(0), n(0.25)]));
  const sixteenths = analyzeRhythm(song([n(0), n(0.125), n(0.375), n(0.625)]));

  it("names the bar and the count in eighths", () => {
    expect(positionOf(eighths, 0)).toEqual({ bar: 1, beatInBar: 1, label: "1" });
    expect(positionOf(eighths, 0.75)).toEqual({ bar: 1, beatInBar: 2, label: "2&" });
    expect(positionOf(eighths, 2)).toEqual({ bar: 2, beatInBar: 1, label: "1" });
  });

  it("names the count in sixteenths", () => {
    expect(sixteenths.sub).toBe(4);
    expect(["1", "1e", "1&", "1a", "2"]).toEqual([0, 1, 2, 3, 4].map((i) => positionOf(sixteenths, i * 0.125).label));
  });

  it("labels cells within a bar", () => {
    expect([0, 1, 2, 3].map((i) => countLabel(eighths, i))).toEqual(["1", "&", "2", "&"]);
    expect([0, 1, 2, 3, 4].map((i) => countLabel(sixteenths, i))).toEqual(["1", "e", "&", "a", "2"]);
  });
});
