import { describe, expect, it } from "vitest";
import { beatMapOf } from "./beatmap";

describe("beatMapOf", () => {
  it("is null for a free-time song", () => {
    expect(beatMapOf({})).toBeNull();
    expect(beatMapOf({ timeSignature: [3, 4] })).toBeNull();
  });

  it("at a constant tempo is exactly the arithmetic Practice used before", () => {
    for (const bpm of [125, 97, 61.3, 120]) {
      const map = beatMapOf({ bpm })!;
      const beat = 60 / bpm;
      for (const t of [0, 0.1, 1 / 3, 15.36, 38.4, 209.3997, 1234.5678]) expect(map.beatAt(t)).toBe(t / beat);
      for (let b = 0; b < 500; b++) expect(map.secondsAt(b)).toBe(b * beat);
    }
    expect(beatMapOf({ bpm: 100 })!.beatsPerBar).toBe(4);
    expect(beatMapOf({ bpm: 100, timeSignature: [3, 4] })!.beatsPerBar).toBe(3);
  });

  it("counts from the first downbeat when the song has a grid offset", () => {
    const map = beatMapOf({ bpm: 120, gridOffset: 0.25 })!;
    expect(map.beatAt(0.25)).toBe(0);
    expect(map.beatAt(0.75)).toBeCloseTo(1, 12);
    expect(map.beatAt(0)).toBeCloseTo(-0.5, 12);
    expect(map.secondsAt(2)).toBeCloseTo(1.25, 12);
  });

  it("follows a tempo map", () => {
    // 120 for two seconds (four beats), then 60.
    const map = beatMapOf({
      bpm: 120,
      tempoMap: [
        { time: 0, bpm: 120 },
        { time: 2, bpm: 60 },
      ],
    })!;
    expect(map.beatAt(1)).toBeCloseTo(2, 12);
    expect(map.beatAt(2)).toBeCloseTo(4, 12);
    expect(map.beatAt(4)).toBeCloseTo(6, 12);
    expect(map.secondsAt(5)).toBeCloseTo(3, 12);
    for (const b of [0, 0.5, 3.9, 4, 4.1, 17]) expect(map.beatAt(map.secondsAt(b))).toBeCloseTo(b, 9);
  });

  it("a tempo map and a grid offset together still put beat 0 on the downbeat", () => {
    const map = beatMapOf({
      gridOffset: 1,
      tempoMap: [
        { time: 0, bpm: 60 },
        { time: 3, bpm: 120 },
      ],
    })!;
    expect(map.beatAt(1)).toBeCloseTo(0, 12);
    expect(map.beatAt(3)).toBeCloseTo(2, 12);
    expect(map.beatAt(3.5)).toBeCloseTo(3, 12);
    expect(map.secondsAt(-1)).toBeCloseTo(0, 12);
  });
});
