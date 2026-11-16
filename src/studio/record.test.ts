import { describe, expect, it } from "vitest";
import { makeTimeMap } from "../music/time";
import { takeToNotes, type Played } from "./record";

// 120 BPM: a beat is half a second, a sixteenth 125 ms, a tick just over a millisecond.
const time = makeTimeMap([{ tick: 0, bpm: 120 }], [{ tick: 0, numerator: 4, denominator: 4 }]);
const beat = 0.5;
const play = (pitch: number, on: number, lasting = 0.24, velocity = 0.8): Played => ({
  pitch,
  velocity,
  on,
  off: on + lasting,
});

describe("a recorded take becomes notes", () => {
  // ── Acceptance criterion 3 ──
  it("each note lands on the right grid step, with how far off it was played kept in offset", () => {
    // A scripted performance: eight notes, each up to 40 ms early or late.
    const off = [-0.04, 0.025, 0, 0.04, -0.013, 0.031, -0.027, 0.008];
    const steps = [0, 2, 4, 6, 8, 11, 12, 14]; // sixteenths from the start
    const notes = takeToNotes(
      steps.map((s, i) => play(60 + i, 2 + s * (beat / 4) + off[i])),
      time,
      { grid: 16, latencyMs: 0 },
    );
    expect(notes.map((n) => n.tick)).toEqual(steps.map((s) => 1920 + s * 120));
    // 40 ms at 120 BPM is 38.4 ticks: the offset is that, to the nearest tick.
    expect(notes.map((n) => n.offset ?? 0)).toEqual(off.map((o) => Math.round((o / beat) * 480)));
    expect(notes.every((n) => n.origin === "played")).toBe(true);
    // What is heard — the grid position plus the offset — is where each note was played.
    notes.forEach((n, i) => {
      const heard = time.secondsAt(n.tick + (n.offset ?? 0));
      expect(Math.abs(heard - (2 + steps[i] * (beat / 4) + off[i]))).toBeLessThan(0.0006);
    });
  });

  it("a note played exactly on the grid has no offset at all", () => {
    const [n] = takeToNotes([play(60, 1)], time, { grid: 16, latencyMs: 0 });
    expect(n).toEqual({ pitch: 60, tick: 960, dur: 240, vel: 0.8, origin: "played" });
  });

  it("the device's input latency is taken off every time", () => {
    const [n] = takeToNotes([play(60, 1 + 0.085)], time, { grid: 16, latencyMs: 85 });
    expect(n.tick).toBe(960);
    expect(n.offset).toBeUndefined();
  });

  it("lengths are tidied to the grid, and nothing is shorter than one step", () => {
    const notes = takeToNotes([play(60, 0, 0.02), play(62, 1, 0.49), play(64, 2, 1.13)], time, {
      grid: 16,
      latencyMs: 0,
    });
    expect(notes.map((n) => n.dur)).toEqual([120, 480, 1080]);
  });

  it("follows the grid chosen: eighths, or triplets", () => {
    expect(takeToNotes([play(60, 0.3)], time, { grid: 8, latencyMs: 0 })[0]).toMatchObject({ tick: 240, offset: 48 });
    expect(takeToNotes([play(60, beat / 3 + 0.01)], time, { grid: "8t", latencyMs: 0 })[0]).toMatchObject({
      tick: 160,
      offset: 10,
    });
  });

  it("a note played a hair before the song begins belongs on its first line", () => {
    const [n] = takeToNotes([play(60, 0.02)], time, { grid: 16, latencyMs: 50 });
    expect(n.tick).toBe(0);
    expect(n.offset ?? 0).toBe(0);
  });

  it("at the end of a loop pass, notes are cut off there and nothing starts beyond it", () => {
    const notes = takeToNotes([play(60, 1.9, 0.6), play(62, 2.01)], time, { grid: 16, latencyMs: 0, until: 1920 });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ pitch: 60, tick: 1800, dur: 120 });
  });

  it("comes out in time order, chords low note first", () => {
    const notes = takeToNotes([play(67, 1.003), play(60, 1), play(55, 0.5)], time, { grid: 16, latencyMs: 0 });
    expect(notes.map((n) => n.pitch)).toEqual([55, 60, 67]);
  });

  it("follows a tempo change", () => {
    const slow = makeTimeMap(
      [
        { tick: 0, bpm: 120 },
        { tick: 1920, bpm: 60 },
      ],
      [{ tick: 0, numerator: 4, denominator: 4 }],
    );
    // Bar 2 starts at 2 s; its second beat, at 60 BPM, is a second later.
    expect(takeToNotes([play(60, 3.01)], slow, { grid: 16, latencyMs: 0 })[0]).toMatchObject({ tick: 2400, offset: 5 });
  });
});
