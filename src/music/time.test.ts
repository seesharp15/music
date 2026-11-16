import { describe, expect, it } from "vitest";
import { makeTimeMap, PPQ, ticksPerBar, ticksPerBeat, type MeterEvent, type TempoEvent } from "./time";

const FOUR_FOUR: MeterEvent[] = [{ tick: 0, numerator: 4, denominator: 4 }];

describe("tick ⇄ seconds", () => {
  it("at a constant 120 a quarter note lasts half a second", () => {
    const tm = makeTimeMap([{ tick: 0, bpm: 120 }], FOUR_FOUR);
    expect(tm.secondsAt(0)).toBe(0);
    expect(tm.secondsAt(PPQ)).toBeCloseTo(0.5, 12);
    expect(tm.secondsAt(PPQ * 4)).toBeCloseTo(2, 12);
    expect(tm.tickAt(1)).toBe(PPQ * 2);
  });

  it("is piecewise linear across tempo changes", () => {
    const tm = makeTimeMap(
      [
        { tick: 0, bpm: 120 },
        { tick: 1920, bpm: 60 },
      ],
      FOUR_FOUR,
    );
    expect(tm.secondsAt(1920)).toBeCloseTo(2, 12);
    expect(tm.secondsAt(1920 + 480)).toBeCloseTo(3, 12);
    expect(tm.tickAt(2.5)).toBeCloseTo(1920 + 240, 9);
    expect(tm.bpmAt(1919)).toBe(120);
    expect(tm.bpmAt(1920)).toBe(60);
  });

  // Acceptance criterion 1.
  it("round-trips every integer tick across a tempo map with three changes", () => {
    const tempo: TempoEvent[] = [
      { tick: 0, bpm: 97 },
      { tick: 1337, bpm: 143.5 },
      { tick: 5000, bpm: 61.3 },
      { tick: 9001, bpm: 200 },
    ];
    const tm = makeTimeMap(tempo, FOUR_FOUR);
    let previous = -Infinity;
    for (let t = 0; t <= 12_000; t++) {
      const s = tm.secondsAt(t);
      expect(s).toBeGreaterThan(previous);
      previous = s;
      if (tm.tickAt(s) !== t) throw new Error(`tick ${t} came back as ${tm.tickAt(s)}`);
    }
  });

  it("keeps fractional ticks between whole ones", () => {
    const tm = makeTimeMap([{ tick: 0, bpm: 120 }], FOUR_FOUR);
    expect(tm.tickAt(tm.secondsAt(100.5))).toBeCloseTo(100.5, 9);
  });

  it("extends the first tempo before tick 0, and tolerates untidy input", () => {
    const tm = makeTimeMap(
      [
        { tick: 960, bpm: 60 },
        { tick: 0, bpm: 120 },
      ],
      [],
    );
    expect(tm.secondsAt(-480)).toBeCloseTo(-0.5, 12);
    expect(tm.secondsAt(960 + 480)).toBeCloseTo(2, 12);
    expect(makeTimeMap([], []).secondsAt(PPQ)).toBeCloseTo(0.5, 12);
    expect(tm.ticksPerBarAt(0)).toBe(1920);
  });
});

describe("bars and beats", () => {
  it("counts bars and beats from 1", () => {
    const tm = makeTimeMap([{ tick: 0, bpm: 120 }], FOUR_FOUR);
    expect(tm.positionAt(0)).toEqual({ bar: 1, beat: 1, tick: 0 });
    expect(tm.positionAt(480 + 10)).toEqual({ bar: 1, beat: 2, tick: 10 });
    expect(tm.positionAt(1920 * 2 + 480 * 3)).toEqual({ bar: 3, beat: 4, tick: 0 });
    expect(tm.tickOfBar(3)).toBe(3840);
  });

  // Acceptance criterion 1.
  it("is right across a 4/4 → 3/4 → 6/8 change", () => {
    // Two bars of 4/4 (3840 ticks), two of 3/4 (2 × 1440), then 6/8 (1440 a bar, eighth-note beats).
    const meter: MeterEvent[] = [
      { tick: 0, numerator: 4, denominator: 4 },
      { tick: 3840, numerator: 3, denominator: 4 },
      { tick: 3840 + 2880, numerator: 6, denominator: 8 },
    ];
    const tm = makeTimeMap([{ tick: 0, bpm: 100 }], meter);
    expect(tm.positionAt(3839)).toEqual({ bar: 2, beat: 4, tick: 479 });
    expect(tm.positionAt(3840)).toEqual({ bar: 3, beat: 1, tick: 0 });
    expect(tm.positionAt(3840 + 1440 + 960)).toEqual({ bar: 4, beat: 3, tick: 0 });
    expect(tm.positionAt(6720)).toEqual({ bar: 5, beat: 1, tick: 0 });
    expect(tm.positionAt(6720 + 240 * 4 + 7)).toEqual({ bar: 5, beat: 5, tick: 7 });
    expect(tm.positionAt(6720 + 1440)).toEqual({ bar: 6, beat: 1, tick: 0 });

    expect([1, 2, 3, 4, 5, 6, 7].map((b) => tm.tickOfBar(b))).toEqual([0, 1920, 3840, 5280, 6720, 8160, 9600]);
    expect(tm.ticksPerBarAt(0)).toBe(1920);
    expect(tm.ticksPerBarAt(3840)).toBe(1440);
    expect(tm.ticksPerBarAt(7000)).toBe(1440);
    expect(tm.meterAt(7000).denominator).toBe(8);
    for (let bar = 1; bar <= 12; bar++) expect(tm.positionAt(tm.tickOfBar(bar))).toEqual({ bar, beat: 1, tick: 0 });
  });

  it("a meter change off the bar line starts a new bar there", () => {
    const tm = makeTimeMap(
      [{ tick: 0, bpm: 120 }],
      [
        { tick: 0, numerator: 4, denominator: 4 },
        { tick: 2400, numerator: 3, denominator: 4 },
      ],
    );
    expect(tm.positionAt(2399).bar).toBe(2);
    expect(tm.positionAt(2400)).toEqual({ bar: 3, beat: 1, tick: 0 });
    expect(tm.tickOfBar(3)).toBe(2400);
  });

  it("knows the size of a beat and a bar", () => {
    expect(ticksPerBeat({ denominator: 8 })).toBe(240);
    expect(ticksPerBar({ numerator: 6, denominator: 8 })).toBe(1440);
    expect(ticksPerBar({ numerator: 2, denominator: 2 })).toBe(1920);
  });
});
