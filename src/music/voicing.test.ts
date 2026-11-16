import { describe, expect, it } from "vitest";
import { makeTimeMap } from "./time";
import { chordNotes, closeVoicings, movement, realizeChords, strikes, voiceChord, writtenAs } from "./voicing";

const time = makeTimeMap([{ tick: 0, bpm: 100 }], [{ tick: 0, numerator: 4, denominator: 4 }]);
const BAR = 1920;

describe("close-position voicings", () => {
  it("a triad has three: root position and two inversions, each with its lowest note from C3", () => {
    expect(closeVoicings("C")).toEqual([
      [48, 52, 55],
      [52, 55, 60],
      [55, 60, 64],
    ]);
    expect(closeVoicings("Am")).toEqual([
      [57, 60, 64],
      [48, 52, 57],
      [52, 57, 60],
    ]);
  });

  it("a seventh chord has four notes; a ninth keeps five; bigger chords give up the fifth", () => {
    expect(closeVoicings("G7")[0]).toEqual([55, 59, 62, 65]);
    expect(closeVoicings("Cmaj9")[0]).toHaveLength(5);
    const thirteen = closeVoicings("C13");
    expect(thirteen[0].length).toBeLessThanOrEqual(5);
    expect(thirteen[0].map((p) => p % 12)).not.toContain(7);
    // Every voicing fits a hand: within an octave and a bit.
    for (const v of [...closeVoicings("G7"), ...closeVoicings("Cmaj9")])
      expect(v[v.length - 1] - v[0]).toBeLessThan(12);
  });

  it("a slash chord on one of its own notes is the inversion with that note lowest", () => {
    expect(closeVoicings("C/E")).toEqual([[52, 55, 60]]);
    expect(closeVoicings("F/A")).toEqual([[57, 60, 65]]);
  });

  it("a slash chord on a foreign bass gets that note underneath", () => {
    for (const v of closeVoicings("C/D")) {
      expect(v[0] % 12).toBe(2);
      expect(v[1] - v[0]).toBeGreaterThan(0);
      expect(v[1] - v[0]).toBeLessThanOrEqual(12);
      expect(
        v
          .slice(1)
          .map((p) => p % 12)
          .sort(),
      ).toEqual([0, 4, 7]);
    }
  });

  it("is empty for something that is not a chord", () => {
    expect(closeVoicings("H#")).toEqual([]);
    expect(voiceChord("nope")).toEqual([]);
  });
});

describe("choosing the inversion", () => {
  it("the first chord is in root position", () => {
    expect(voiceChord("C")).toEqual([48, 52, 55]);
    expect(voiceChord("F")).toEqual([53, 57, 60]);
  });

  it("each chord after it takes the inversion that moves least", () => {
    // C → F: keep the C, move E and G up a step each (second inversion of F).
    expect(voiceChord("F", [48, 52, 55])).toEqual([48, 53, 57]);
    // C → G: keep the G, move C and E down a step each (first inversion of G).
    const g = voiceChord("G", [48, 52, 55]);
    expect(movement([48, 52, 55], g)).toBeLessThanOrEqual(movement([48, 52, 55], [55, 59, 62]));
    // C → Am shares two notes.
    expect(voiceChord("Am", [48, 52, 55])).toEqual([48, 52, 57]);
  });

  it("movement counts each note to its nearest neighbour, both ways", () => {
    expect(movement([48, 52, 55], [48, 52, 55])).toBe(0);
    expect(movement([48, 52, 55], [48, 53, 57])).toBe(6);
    expect(movement([], [60])).toBe(0);
  });
});

describe("how a chord is struck", () => {
  const chord = { tick: BAR / 2, dur: 2 * BAR, symbol: "C" };
  it("held: once, for as long as it lasts", () => {
    expect(strikes(chord, time, "hold")).toEqual([{ tick: 960, dur: 3840 }]);
  });
  it("every bar: at its start and then at each bar line it lasts through", () => {
    expect(strikes(chord, time, "bar")).toEqual([
      { tick: 960, dur: 960 },
      { tick: 1920, dur: 1920 },
      { tick: 3840, dur: 960 },
    ]);
  });
  it("every beat: each lasting until the next", () => {
    const s = strikes({ tick: 240, dur: 1200, symbol: "C" }, time, "beat");
    expect(s).toEqual([
      { tick: 240, dur: 240 },
      { tick: 480, dur: 480 },
      { tick: 960, dur: 480 },
    ]);
  });
  it("in 6/8 a beat is an eighth note", () => {
    const six = makeTimeMap([{ tick: 0, bpm: 100 }], [{ tick: 0, numerator: 6, denominator: 8 }]);
    expect(strikes({ tick: 0, dur: 1440, symbol: "C" }, six, "beat")).toHaveLength(6);
    expect(strikes({ tick: 0, dur: 2880, symbol: "C" }, six, "bar")).toHaveLength(2);
  });
});

describe("a progression written out", () => {
  const twinkle = ["C", "F", "C", "G", "C"].map((symbol, i) => ({ tick: i * BAR, dur: BAR, symbol }));

  it("is block chords, one a bar, moving as little as possible", () => {
    const notes = realizeChords(twinkle, time, "hold");
    expect(notes).toHaveLength(15);
    const bars = [0, 1, 2, 3, 4].map((b) => notes.filter((n) => n.tick === b * BAR).map((n) => n.pitch));
    expect(bars[0]).toEqual([48, 52, 55]);
    expect(bars[1]).toEqual([48, 53, 57]);
    expect(bars[2]).toEqual([48, 52, 55]);
    // G is nearest as D–G–B, and from there C is nearest with E at the bottom.
    expect(bars[3]).toEqual([50, 55, 59]);
    expect(bars[4]).toEqual([52, 55, 60]);
    expect(notes.every((n) => n.dur === BAR)).toBe(true);
    // No inversion of a chord would have moved the hand less than the one chosen.
    for (let b = 1; b < 5; b++) {
      for (const other of closeVoicings(twinkle[b].symbol)) {
        expect(movement(bars[b - 1], bars[b])).toBeLessThanOrEqual(movement(bars[b - 1], other));
      }
    }
  });

  it("struck every beat, each bar has four of each note", () => {
    const notes = realizeChords(twinkle.slice(0, 1), time, "beat");
    expect(notes).toHaveLength(12);
    expect(notes.every((n) => n.dur === 480)).toBe(true);
  });

  it("skips a symbol it cannot read, and takes chords in time order", () => {
    const notes = realizeChords(
      [
        { tick: BAR, dur: BAR, symbol: "F" },
        { tick: 0, dur: BAR, symbol: "C" },
        { tick: 2 * BAR, dur: BAR, symbol: "??" },
      ],
      time,
      "hold",
    );
    expect(notes.map((n) => n.tick)).toEqual([0, 0, 0, BAR, BAR, BAR]);
  });
});

describe("recognising notes that Write to track wrote", () => {
  const chord = { tick: BAR, dur: BAR, symbol: "F" };
  it("in any inversion, struck any of the three ways", () => {
    for (const voicing of closeVoicings("F")) {
      expect(writtenAs(chordNotes(chord, voicing, time, "hold"), chord, time)).toBe("hold");
      expect(writtenAs(chordNotes(chord, voicing, time, "beat"), chord, time)).toBe("beat");
    }
    const two = { tick: 0, dur: 2 * BAR, symbol: "C" };
    expect(writtenAs(chordNotes(two, [48, 52, 55], time, "bar"), two, time)).toBe("bar");
  });

  it("not once a note has been moved, lengthened, added or removed", () => {
    const written = chordNotes(chord, [48, 53, 57], time, "hold");
    expect(writtenAs(written, chord, time)).toBe("hold");
    expect(writtenAs([{ ...written[0], pitch: 50 }, ...written.slice(1)], chord, time)).toBeNull();
    expect(writtenAs([{ ...written[0], dur: 960 }, ...written.slice(1)], chord, time)).toBeNull();
    expect(writtenAs([...written, { pitch: 65, tick: BAR, dur: BAR }], chord, time)).toBeNull();
    expect(writtenAs(written.slice(1), chord, time)).toBeNull();
    expect(writtenAs([], chord, time)).toBeNull();
  });

  it("nor when they are another chord's notes", () => {
    expect(writtenAs(chordNotes(chord, [48, 52, 55], time, "hold"), chord, time)).toBeNull();
  });
});
