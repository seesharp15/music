import { describe, expect, it } from "vitest";
import { faster, posToSpeed, slower, snapRate, SPEED_MAX, SPEED_MIN, speedToPos } from "./speed";

describe("speed slider", () => {
  it("runs from 5% at one end to 200% at the other", () => {
    expect(speedToPos(SPEED_MIN)).toBeCloseTo(0);
    expect(speedToPos(SPEED_MAX)).toBeCloseTo(1);
    expect(posToSpeed(0)).toBeCloseTo(0.05);
    expect(posToSpeed(1)).toBeCloseTo(2);
  });

  it("is logarithmic: 100% sits well past the middle, so slow speeds get the room", () => {
    expect(speedToPos(1)).toBeGreaterThan(0.75);
    expect(speedToPos(0.5)).toBeGreaterThan(0.55);
  });

  it("round-trips any speed", () => {
    for (const r of [0.05, 0.1, 0.33, 0.5, 0.75, 1, 1.5, 2]) expect(posToSpeed(speedToPos(r))).toBeCloseTo(r, 10);
  });

  it("settles on 10, 50, 75 and 100% when close, and nowhere else", () => {
    expect(snapRate(0.98)).toBe(1);
    expect(snapRate(1.06)).toBe(1);
    expect(snapRate(0.52)).toBe(0.5);
    expect(snapRate(0.73)).toBe(0.75);
    expect(snapRate(0.104)).toBe(0.1);
    expect(snapRate(0.6)).toBe(0.6);
    expect(snapRate(1.25)).toBe(1.25);
    expect(snapRate(0.6149)).toBe(0.61);
  });

  it("steps by 5%, and by 1% below 25%, without leaving the range", () => {
    expect(slower(1)).toBe(0.95);
    expect(faster(1)).toBe(1.05);
    expect(slower(0.25)).toBe(0.24);
    expect(faster(0.24)).toBe(0.25);
    expect(faster(0.25)).toBe(0.3);
    expect(slower(0.3)).toBe(0.25);
    expect(slower(SPEED_MIN)).toBe(SPEED_MIN);
    expect(faster(SPEED_MAX)).toBe(SPEED_MAX);
  });
});
