import { describe, expect, it } from "vitest";
import { normalize } from "./normalize";
import type { Note, Song } from "./types";

const note = (over: Partial<Note> = {}): Note => ({ pitch: 60, time: 0, duration: 0.5, hand: "R", ...over });
const song = (notes: Note[], over: Partial<Song> = {}): Song => ({
  format: "piano-song/v1",
  id: "t",
  title: "T",
  notes,
  ...over,
});

describe("normalize", () => {
  it("accepts v1 and v2 files and nothing else", () => {
    expect(() => normalize(song([note()]))).not.toThrow();
    expect(() => normalize(song([note()], { format: "piano-song/v2" }))).not.toThrow();
    expect(() => normalize(song([note()], { format: "piano-song/v3" as Song["format"] }))).toThrow(/Unsupported/);
    expect(() => normalize({ notes: [] } as unknown as Song)).toThrow(/Unsupported/);
  });

  it("drops notes with no length and notes off the piano", () => {
    const out = normalize(
      song([
        note({ pitch: 20 }),
        note({ pitch: 21 }),
        note({ pitch: 108 }),
        note({ pitch: 109 }),
        note({ duration: 0 }),
        note({ duration: -1 }),
      ]),
    );
    expect(out.notes.map((n) => n.pitch)).toEqual([21, 108]);
  });

  it("gives a note without a velocity 0.7, and keeps one that has it", () => {
    const out = normalize(song([note(), note({ time: 1, velocity: 0.2 })]));
    expect(out.notes.map((n) => n.velocity)).toEqual([0.7, 0.2]);
  });

  it("sorts by time, then by pitch", () => {
    const out = normalize(song([note({ time: 2 }), note({ time: 1, pitch: 64 }), note({ time: 1, pitch: 62 })]));
    expect(out.notes.map((n) => [n.time, n.pitch])).toEqual([
      [1, 62],
      [1, 64],
      [2, 60],
    ]);
  });

  it("works out the duration from the last note to end, unless the file states one", () => {
    expect(normalize(song([note({ time: 1, duration: 4 }), note({ time: 3 })])).duration).toBe(5);
    expect(normalize(song([note()], { duration: 9 })).duration).toBe(9);
    expect(normalize(song([])).duration).toBe(0);
  });

  it("leaves the caller's object alone", () => {
    const raw = song([note({ time: 2 }), note({ time: 1 })]);
    normalize(raw);
    expect(raw.notes.map((n) => n.time)).toEqual([2, 1]);
    expect(raw.notes[0].velocity).toBeUndefined();
  });

  it("carries v2 fields through untouched", () => {
    const out = normalize(
      song([note()], { format: "piano-song/v2", key: "A minor", pedal: [{ time: 0, down: true }] }),
    );
    expect(out.key).toBe("A minor");
    expect(out.pedal).toEqual([{ time: 0, down: true }]);
  });
});
