import { describe, expect, it } from "vitest";
import { clamp, MIN_LOOP, playRange } from "./range";

const off = { enabled: false, start: 10, end: 20 };
const loop = { enabled: true, start: 10, end: 20 };

describe("playRange", () => {
  it("plays the whole song when nothing is selected", () => {
    expect(playRange(off, null, 60)).toEqual({ start: 0, end: 60 });
  });

  it("plays the loop when one is on, and ignores a remembered loop that is off", () => {
    expect(playRange(loop, null, 60)).toEqual({ start: 10, end: 20 });
    expect(playRange(off, null, 60)).toEqual({ start: 0, end: 60 });
  });

  it("plays what is visible when zoomed in with no loop", () => {
    expect(playRange(off, { start: 30, end: 40 }, 60)).toEqual({ start: 30, end: 40 });
  });

  it("clips the loop to the visible window where they overlap", () => {
    expect(playRange(loop, { start: 15, end: 40 }, 60)).toEqual({ start: 15, end: 20 });
    expect(playRange(loop, { start: 5, end: 12 }, 60)).toEqual({ start: 10, end: 12 });
    expect(playRange(loop, { start: 12, end: 18 }, 60)).toEqual({ start: 12, end: 18 });
  });

  it("lets the window win when the loop is out of view", () => {
    expect(playRange(loop, { start: 30, end: 40 }, 60)).toEqual({ start: 30, end: 40 });
  });

  it("lets the window win when the overlap is shorter than the shortest loop", () => {
    const sliver = { start: 20 - MIN_LOOP / 2, end: 40 };
    expect(playRange(loop, sliver, 60)).toEqual(sliver);
    const justEnough = { start: 20 - MIN_LOOP, end: 40 };
    expect(playRange(loop, justEnough, 60)).toEqual({ start: 20 - MIN_LOOP, end: 20 });
  });
});

describe("clamp", () => {
  it("holds a value between two bounds", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});
