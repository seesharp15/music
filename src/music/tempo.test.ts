import { describe, expect, it } from "vitest";
import { estimateTempo } from "./tempo";

/** A small repeatable random source, so "loose timing" is the same on every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Onsets at these beat positions, repeated bar after bar. */
function pattern(bpm: number, beats: number[], bars: number, perBar = 4, jitterMs = 0, seed = 1) {
  const random = rng(seed);
  const beat = 60 / bpm;
  const out: { time: number; weight?: number }[] = [];
  for (let bar = 0; bar < bars; bar++) {
    for (const b of beats) out.push({ time: (bar * perBar + b) * beat + (random() - 0.5) * 2 * (jitterMs / 1000) });
  }
  return out;
}

describe("estimateTempo", () => {
  it("finds the tempo of steady taps", () => {
    for (const bpm of [72, 90, 100, 120, 132]) {
      const est = estimateTempo(pattern(bpm, [0, 1, 2, 3], 4));
      expect(Math.abs(est.bpm - bpm), `${bpm}`).toBeLessThan(0.5);
      expect(est.confidence).toBeGreaterThan(0.9);
      expect(est.swing).toBe(0.5);
    }
  });

  it("survives loose timing", () => {
    const est = estimateTempo(pattern(96, [0, 1, 2, 2.5, 3], 8, 4, 18, 7));
    expect(Math.abs(est.bpm - 96)).toBeLessThan(1);
    expect(est.confidence).toBeGreaterThan(0.6);
  });

  it("reads a line of eighth notes as a tempo in the comfortable range, not twice as fast", () => {
    const est = estimateTempo(pattern(110, [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], 4));
    expect(Math.abs(est.bpm - 110)).toBeLessThan(0.5);
  });

  it("prefers 70–140 when readings an octave apart fit equally", () => {
    // Taps 0.4 s apart: 150 or 75. Taps 0.25 s apart: 240 or 120.
    expect(Math.abs(estimateTempo(pattern(150, [0, 1, 2, 3], 4)).bpm - 75)).toBeLessThan(0.5);
    expect(Math.abs(estimateTempo(pattern(240, [0, 1, 2, 3], 6)).bpm - 120)).toBeLessThan(0.5);
    // Taps a second apart are 60: reading them as 120 would leave every other beat empty.
    expect(Math.abs(estimateTempo(pattern(60, [0, 1, 2, 3], 4)).bpm - 60)).toBeLessThan(0.5);
  });

  it("offers half and double as alternatives", () => {
    const est = estimateTempo(pattern(100, [0, 1, 2, 3], 4));
    expect(est.alternatives).toHaveLength(2);
    expect(est.alternatives[0]).toBeCloseTo(est.bpm / 2, 1);
    expect(est.alternatives[1]).toBeCloseTo(est.bpm * 2, 1);
  });

  it("hears three in a bar from the accents", () => {
    const beat = 60 / 108;
    const waltz = Array.from({ length: 36 }, (_, i) => ({ time: i * beat, weight: i % 3 === 0 ? 3 : 1 }));
    const est = estimateTempo(waltz);
    expect(Math.abs(est.bpm - 108)).toBeLessThan(0.5);
    expect(est.meter).toEqual([3, 4]);
  });

  it("hears four in a bar from the accents, and assumes it when there are none", () => {
    const beat = 60 / 100;
    const accented = Array.from({ length: 32 }, (_, i) => ({ time: i * beat, weight: i % 4 === 0 ? 3 : 1 }));
    expect(estimateTempo(accented).meter).toEqual([4, 4]);
    expect(estimateTempo(pattern(100, [0, 1, 2, 3], 4)).meter).toEqual([4, 4]);
  });

  it("counts a chord as one heavier onset", () => {
    const beat = 60 / 90;
    const onsets = [];
    for (let i = 0; i < 24; i++) {
      onsets.push({ time: i * beat });
      if (i % 3 === 0) onsets.push({ time: i * beat + 0.004 }, { time: i * beat + 0.008 });
    }
    expect(estimateTempo(onsets).meter).toEqual([3, 4]);
  });

  it("measures swing from where the off-beats fall", () => {
    const swung = estimateTempo(pattern(120, [0, 2 / 3, 1, 1 + 2 / 3, 2, 2 + 2 / 3, 3, 3 + 2 / 3], 6));
    expect(Math.abs(swung.bpm - 120)).toBeLessThan(0.5);
    expect(swung.swing).toBeCloseTo(0.667, 2);
    const light = estimateTempo(pattern(120, [0, 0.58, 1, 1.58, 2, 2.58, 3, 3.58], 6));
    expect(light.swing).toBeCloseTo(0.58, 2);
    const straight = estimateTempo(pattern(120, [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], 6));
    expect(straight.swing).toBe(0.5);
  });

  it("hears a beat that divides in three as compound time, with the tempo in quarter notes", () => {
    // 6/8 at 80 dotted quarters a minute: two beats a bar, three eighths to a beat.
    const est = estimateTempo(pattern(80, [0, 1 / 3, 2 / 3, 1, 1 + 1 / 3, 1 + 2 / 3], 8, 2));
    expect(est.meter[1]).toBe(8);
    expect(Math.abs(est.bpm - 120)).toBeLessThan(1);
    expect(est.swing).toBe(0.5);
  });

  it("says so when there is nothing to go on", () => {
    expect(estimateTempo([])).toMatchObject({ bpm: 120, confidence: 0, meter: [4, 4] });
    expect(estimateTempo([{ time: 1 }])).toMatchObject({ bpm: 120, confidence: 0 });
    // Two or three taps are taken as beats, with little confidence.
    const three = estimateTempo([{ time: 0 }, { time: 0.6 }, { time: 1.2 }]);
    expect(three.bpm).toBeCloseTo(100, 1);
    expect(three.confidence).toBeLessThan(0.5);
  });

  it("gives random onsets a low confidence", () => {
    const random = rng(42);
    const onsets = Array.from({ length: 40 }, () => ({ time: random() * 20 }));
    expect(estimateTempo(onsets).confidence).toBeLessThan(0.5);
  });

  it("does not care what order the onsets arrive in", () => {
    const onsets = pattern(100, [0, 1, 2, 3], 4);
    expect(estimateTempo([...onsets].reverse())).toEqual(estimateTempo(onsets));
  });
});
