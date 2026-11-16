import { describe, expect, it } from "vitest";
import {
  contour,
  findMotifs,
  intervalHistogram,
  melodyLine,
  onsetPattern,
  phraseBoundaries,
  rangeOf,
  type LineNote,
} from "./analysis";
import { makeTimeMap } from "./time";

/** Notes from pitches (and optional lengths in eighths), one after another. A null pitch is a rest. */
function line(pitches: (number | null)[], eighths: number[] = []): LineNote[] {
  const out: LineNote[] = [];
  let tick = 0;
  pitches.forEach((pitch, i) => {
    const dur = (eighths[i] ?? 1) * 240;
    if (pitch !== null) out.push({ pitch, tick, dur });
    tick += dur;
  });
  return out;
}

describe("melodyLine", () => {
  it("keeps the top note of each onset, in time order", () => {
    const notes = [
      { pitch: 64, tick: 480, dur: 240 },
      { pitch: 60, tick: 0, dur: 240 },
      { pitch: 67, tick: 0, dur: 240 },
      { pitch: 55, tick: 480, dur: 240 },
    ];
    expect(melodyLine(notes).map((n) => n.pitch)).toEqual([67, 64]);
  });
});

describe("phraseBoundaries", () => {
  it("ends a phrase at a rest", () => {
    const notes = line([60, 62, 64, null, null, 65, 67, 69]);
    expect(phraseBoundaries(notes)).toEqual([
      { first: 0, last: 2, start: 0, end: 720, endedBy: "rest" },
      { first: 3, last: 5, start: 1200, end: 1920, endedBy: "end" },
    ]);
  });
  it("ends a phrase after a long note", () => {
    const notes = line([60, 62, 64, 65, 67, 65, 64, 62], [1, 1, 1, 4, 1, 1, 1, 4]);
    const phrases = phraseBoundaries(notes);
    expect(phrases.map((p) => [p.first, p.last, p.endedBy])).toEqual([
      [0, 3, "longNote"],
      [4, 7, "end"],
    ]);
  });
  it("does not split a line of even notes, or leave a one-note phrase behind a long note", () => {
    expect(phraseBoundaries(line([60, 62, 64, 65, 67, 69, 71, 72]))).toHaveLength(1);
    expect(phraseBoundaries(line([60, 62, 64], [8, 1, 1])).map((p) => p.last)).toEqual([2]);
    expect(phraseBoundaries([])).toEqual([]);
  });
  it("can be told what counts as a rest", () => {
    const notes = line([60, null, 62, null, 64]);
    expect(phraseBoundaries(notes)).toHaveLength(1);
    expect(phraseBoundaries(notes, { minRest: 240 })).toHaveLength(3);
  });
});

describe("contour", () => {
  it("gives the direction of each move", () => {
    expect(contour(line([60, 62, 62, 59])).moves).toEqual([1, 0, -1]);
  });
  it("names the overall shape", () => {
    expect(contour(line([60, 62, 64, 65, 67])).shape).toBe("rise");
    expect(contour(line([72, 71, 69, 67, 65])).shape).toBe("fall");
    expect(contour(line([60, 64, 67, 72, 67, 64, 60])).shape).toBe("arch");
    expect(contour(line([72, 67, 64, 60, 64, 67, 72])).shape).toBe("valley");
    expect(contour(line([60, 62, 60, 62, 60])).shape).toBe("flat");
    expect(contour(line([60, 67, 55, 62, 60])).shape).toBe("arch");
    expect(contour(line([60])).shape).toBe("flat");
    expect(contour([])).toEqual({ moves: [], shape: "flat" });
  });
});

describe("intervalHistogram", () => {
  it("counts moves by size and direction", () => {
    const stats = intervalHistogram(line([60, 62, 64, 64, 60, 67]));
    expect(stats.histogram).toEqual({ 2: 2, 0: 1, [-4]: 1, 7: 1 });
    expect(stats.steps).toBeCloseTo(0.4);
    expect(stats.repeats).toBeCloseTo(0.2);
    expect(stats.skips).toBeCloseTo(0.2);
    expect(stats.leaps).toBeCloseTo(0.2);
    expect(stats.largest).toBe(7);
  });
  it("is all zeros for a single note", () => {
    expect(intervalHistogram(line([60]))).toEqual({
      histogram: {},
      repeats: 0,
      steps: 0,
      skips: 0,
      leaps: 0,
      largest: 0,
    });
  });
});

describe("rangeOf", () => {
  it("gives the extremes and where the line mostly sits", () => {
    // One very high and one very low grace note around a line that lives between 60 and 67.
    const notes = [
      { pitch: 40, tick: 0, dur: 30 },
      ...line([60, 62, 64, 65, 67, 65, 64, 62], [2, 2, 2, 2, 2, 2, 2, 2]),
      { pitch: 96, tick: 5000, dur: 30 },
    ];
    const r = rangeOf(notes)!;
    expect([r.low, r.high]).toEqual([40, 96]);
    expect(r.tessitura).toEqual([60, 67]);
    expect(r.centre).toBeGreaterThan(60);
    expect(r.centre).toBeLessThan(67);
    expect(rangeOf([])).toBeNull();
  });
});

describe("findMotifs", () => {
  it("finds a figure repeated at another pitch", () => {
    // C D E G | rest | F G A C' — the same shape a fourth up.
    const notes = line([60, 62, 64, 67, null, 65, 67, 69, 72]);
    const motifs = findMotifs(notes);
    expect(motifs[0]).toEqual({
      length: 4,
      intervals: [2, 2, 3],
      rhythm: [240, 240, 240],
      occurrences: [
        { index: 0, tick: 0, transpose: 0 },
        { index: 4, tick: 1200, transpose: 5 },
      ],
    });
    // The three-note pieces of it are not reported separately.
    expect(motifs).toHaveLength(1);
  });
  it("needs the rhythm to match as well as the intervals", () => {
    const same = line([60, 62, 64, 72, 65, 67, 69], [1, 1, 1, 1, 1, 1, 1]);
    const different = line([60, 62, 64, 72, 65, 67, 69], [1, 1, 1, 1, 2, 1, 1]);
    expect(findMotifs(same)[0].occurrences).toHaveLength(2);
    expect(findMotifs(different)).toEqual([]);
  });
  it("counts three appearances, and does not count a figure overlapping itself", () => {
    const thrice = line([60, 64, 62, 59, 62, 66, 64, 59, 67, 71, 69]);
    const motif = findMotifs(thrice)[0];
    expect(motif.length).toBe(3);
    expect(motif.occurrences.map((o) => o.transpose)).toEqual([0, 2, 7]);
    // Six repeated notes: "three the same" appears twice end to end, not four times overlapping.
    const repeated = findMotifs(line([60, 60, 60, 60, 60, 60]), { maxLength: 3 });
    expect(repeated[0].occurrences.map((o) => o.index)).toEqual([0, 3]);
  });
  it("finds nothing in a line that never repeats, or in too few notes", () => {
    expect(findMotifs(line([60, 61, 63, 66, 70, 75, 81]))).toEqual([]);
    expect(findMotifs(line([60, 62]))).toEqual([]);
    expect(findMotifs([])).toEqual([]);
  });
});

describe("onsetPattern", () => {
  const time = makeTimeMap([{ tick: 0, bpm: 120 }], [{ tick: 0, numerator: 4, denominator: 4 }]);
  it("marks where notes start in each bar", () => {
    const notes = [
      { pitch: 60, tick: 0, dur: 100 },
      { pitch: 64, tick: 0, dur: 100 },
      { pitch: 62, tick: 480, dur: 100 },
      { pitch: 62, tick: 1920 + 960, dur: 100 },
      { pitch: 62, tick: 1920 * 3 + 240, dur: 100 },
    ];
    const bars = onsetPattern(notes, time, 8);
    expect(bars).toEqual([
      { bar: 1, steps: [2, 0, 1, 0, 0, 0, 0, 0] },
      { bar: 2, steps: [0, 0, 0, 0, 1, 0, 0, 0] },
      { bar: 3, steps: [0, 0, 0, 0, 0, 0, 0, 0] },
      { bar: 4, steps: [0, 1, 0, 0, 0, 0, 0, 0] },
    ]);
  });
  it("puts a note in its nearest cell, even when that is the next bar's first", () => {
    expect(onsetPattern([{ pitch: 60, tick: 130, dur: 10 }], time, 16)[0].steps[1]).toBe(1);
    expect(onsetPattern([{ pitch: 60, tick: 1915, dur: 10 }], time, 16)).toEqual([
      { bar: 2, steps: [1, ...new Array(15).fill(0)] },
    ]);
    expect(onsetPattern([], time)).toEqual([]);
  });
});
