import { describe, expect, it } from "vitest";
import { addTap, tappedBpm, TAP_RESET_MS } from "./tap";

const run = (gaps: number[], start = 1000) =>
  gaps.reduce((taps, g) => addTap(taps, taps[taps.length - 1] + g), addTap([], start));

describe("tap tempo", () => {
  it("needs two taps", () => {
    expect(tappedBpm([])).toBeNull();
    expect(tappedBpm(addTap([], 500))).toBeNull();
    expect(tappedBpm(run([600]))).toBe(100);
  });

  it("is what was tapped: fast is fast and slow is slow, nothing halved or doubled", () => {
    expect(tappedBpm(run([400, 400, 400, 400]))).toBe(150);
    expect(tappedBpm(run([1500, 1500]))).toBe(40);
    expect(tappedBpm(run([250, 250, 250]))).toBe(240);
  });

  it("averages uneven taps", () => {
    expect(tappedBpm(run([480, 520, 510, 490]))).toBe(120);
  });

  it("only the last eight taps count, so the tempo follows a tapper who speeds up", () => {
    const taps = run([...new Array(10).fill(1000), ...new Array(7).fill(500)]);
    expect(taps).toHaveLength(8);
    expect(tappedBpm(taps)).toBe(120);
  });

  it("a long pause starts again", () => {
    const taps = run([500, 500, TAP_RESET_MS + 1]);
    expect(taps).toHaveLength(1);
    expect(tappedBpm(taps)).toBeNull();
    expect(tappedBpm(addTap(taps, taps[0] + 750))).toBe(80);
  });

  it("stays within what a song can be set to", () => {
    expect(tappedBpm(run([50, 50]))).toBe(300);
    expect(tappedBpm(run([1999, 1999]))).toBe(30);
  });
});
