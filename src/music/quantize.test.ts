import { describe, expect, it } from "vitest";
import type { Groove } from "../project/types";
import { gridTicks, grooveAccent, grooveOffset, quantize, quantizeNotes, swingOffset } from "./quantize";
import { makeTimeMap } from "./time";

const time = makeTimeMap([{ tick: 0, bpm: 120 }], [{ tick: 0, numerator: 4, denominator: 4 }]);

describe("gridTicks", () => {
  it("gives the ticks between grid lines", () => {
    expect(([4, 8, 16, 32, "8t", "16t"] as const).map(gridTicks)).toEqual([480, 240, 120, 60, 160, 80]);
  });
});

describe("quantize", () => {
  it("snaps to the nearest line at full strength", () => {
    expect(quantize(130, 16, 1)).toBe(120);
    expect(quantize(181, 16, 1)).toBe(240);
    expect(quantize(150, "8t", 1)).toBe(160);
    expect(quantize(-110, 16)).toBe(-120);
  });
  it("moves part of the way at part strength, and not at all at zero", () => {
    expect(quantize(140, 16, 0.5)).toBe(130);
    expect(quantize(140, 16, 0)).toBe(140);
  });
});

describe("swingOffset", () => {
  const triplet = { amount: 2 / 3, unit: 8 } as const;
  it("is nothing when straight", () => {
    expect(swingOffset(240, { amount: 0.5, unit: 8 })).toBe(0);
  });
  it("leaves beats alone and delays the off-beat eighth", () => {
    expect(swingOffset(0, triplet)).toBe(0);
    expect(swingOffset(480, triplet)).toBeCloseTo(0, 9);
    expect(swingOffset(240, triplet)).toBeCloseTo(80, 9);
    expect(swingOffset(480 * 5 + 240, triplet)).toBeCloseTo(80, 9);
  });
  it("moves what lies between in proportion, never out of order", () => {
    expect(swingOffset(120, triplet)).toBeCloseTo(40, 9);
    expect(swingOffset(360, triplet)).toBeCloseTo(40, 9);
    let previous = -1;
    for (let t = 0; t <= 960; t += 10) {
      const heard = t + swingOffset(t, triplet);
      expect(heard).toBeGreaterThan(previous);
      previous = heard;
    }
  });
  it("swings sixteenths in pairs of sixteenths, and counts from where it is told", () => {
    expect(swingOffset(120, { amount: 0.6, unit: 16 })).toBeCloseTo(24, 9);
    expect(swingOffset(240, { amount: 0.6, unit: 16 })).toBeCloseTo(0, 9);
    expect(swingOffset(1440 + 240, triplet, 1440)).toBeCloseTo(80, 9);
  });
});

describe("groove", () => {
  const groove: Groove = {
    unit: 8,
    offsets: [0, 12, -6, 12, 0, 12, -6, 12],
    accents: [1.2, 0.8, 1, 0.8, 1.1, 0.8, 1, 0.8],
  };
  it("offsets and accents a tick by its step in the bar", () => {
    expect(grooveOffset(0, groove, time)).toBe(0);
    expect(grooveOffset(240, groove, time)).toBe(12);
    expect(grooveOffset(480, groove, time)).toBe(-6);
    expect(grooveOffset(1920 * 3 + 240 * 7, groove, time)).toBe(12);
    expect(grooveAccent(1920, groove, time)).toBe(1.2);
    expect(grooveAccent(240, groove, time)).toBe(0.8);
  });
  it("leaves alone what falls between its steps", () => {
    expect(grooveOffset(120, groove, time)).toBe(0);
    expect(grooveAccent(120, groove, time)).toBe(1);
  });
  it("follows the bar through a meter change", () => {
    const waltz = makeTimeMap(
      [{ tick: 0, bpm: 120 }],
      [
        { tick: 0, numerator: 4, denominator: 4 },
        { tick: 1920, numerator: 3, denominator: 4 },
      ],
    );
    // Bar 3 starts at 1920 + 1440: its first step is step 0 again.
    expect(grooveOffset(1920 + 1440, groove, waltz)).toBe(0);
    expect(grooveOffset(1920 + 1440 + 480, groove, waltz)).toBe(-6);
  });
  it("an empty groove does nothing", () => {
    expect(grooveOffset(240, { unit: 8, offsets: [], accents: [] }, time)).toBe(0);
    expect(grooveAccent(240, { unit: 8, offsets: [], accents: [] }, time)).toBe(1);
  });
});

describe("quantizeNotes", () => {
  const played = [
    { id: 1, tick: 7, dur: 200 },
    { id: 2, tick: 250, dur: 200 },
    { id: 3, tick: 471, dur: 200, offset: 4 },
  ];

  it("moves notes onto the grid and drops their offsets", () => {
    expect(quantizeNotes(played, { grid: 8 })).toEqual([
      { id: 1, tick: 0, dur: 200 },
      { id: 2, tick: 240, dur: 200 },
      { id: 3, tick: 480, dur: 200 },
    ]);
  });

  it("with keepOffset tidies the grid position and keeps the feel", () => {
    const out = quantizeNotes(played, { grid: 8, keepOffset: true });
    expect(out).toEqual([
      { id: 1, tick: 0, dur: 200, offset: 7 },
      { id: 2, tick: 240, dur: 200, offset: 10 },
      { id: 3, tick: 480, dur: 200, offset: -5 },
    ]);
    // What is heard has not moved.
    out.forEach((n, i) => expect(n.tick + (n.offset ?? 0)).toBe(played[i].tick + (played[i].offset ?? 0)));
  });

  it("is idempotent with keepOffset, and a note already on the grid gets no offset", () => {
    const once = quantizeNotes(played, { grid: 8, keepOffset: true });
    expect(quantizeNotes(once, { grid: 8, keepOffset: true })).toEqual(once);
    expect(quantizeNotes([{ tick: 240 }], { grid: 8, keepOffset: true })).toEqual([{ tick: 240 }]);
  });

  it("moves part of the way at part strength", () => {
    expect(quantizeNotes([{ tick: 20 }], { grid: 8, strength: 0.5 })).toEqual([{ tick: 10 }]);
    expect(quantizeNotes([{ tick: 20 }], { grid: 8, strength: 0.5, keepOffset: true })).toEqual([
      { tick: 10, offset: 10 },
    ]);
  });

  it("snaps to swung lines when swing is given", () => {
    const swing = { amount: 2 / 3, unit: 8 } as const;
    // Played at 310: nearer the swung off-beat (320) than anything straight.
    expect(quantizeNotes([{ tick: 310 }], { grid: 8, swing })).toEqual([{ tick: 320 }]);
    // Keeping the feel: filed under the straight off-beat, still heard at 310.
    expect(quantizeNotes([{ tick: 310 }], { grid: 8, swing, keepOffset: true })).toEqual([{ tick: 240, offset: 70 }]);
  });

  it("snaps to a groove's lines when a groove is given", () => {
    const groove: Groove = { unit: 8, offsets: [0, 20], accents: [] };
    expect(quantizeNotes([{ tick: 250 }], { grid: 8, groove, time })).toEqual([{ tick: 260 }]);
  });

  it("does not change its input", () => {
    const before = JSON.stringify(played);
    quantizeNotes(played, { grid: 16, keepOffset: true });
    expect(JSON.stringify(played)).toBe(before);
  });
});
