import { describe, expect, it } from "vitest";
import { isBlack, keyRangeFor, keySpan, layoutKeyboard, noteName, TOTAL_WHITES } from "./keyboard";

describe("keyboard", () => {
  it("knows black keys from white", () => {
    expect([60, 62, 64, 65, 67, 69, 71].some(isBlack)).toBe(false);
    expect([61, 63, 66, 68, 70].every(isBlack)).toBe(true);
  });

  it("names notes with sharps and octaves", () => {
    expect(noteName(21)).toBe("A0");
    expect(noteName(60)).toBe("C4");
    expect(noteName(61)).toBe("C#4");
    expect(noteName(108)).toBe("C8");
  });

  it("places keys in white-key units from A0 to C8", () => {
    expect(keySpan(21)).toEqual([0, 1]);
    expect(keySpan(108)).toEqual([TOTAL_WHITES - 1, TOTAL_WHITES]);
    const [a, b] = keySpan(22); // A#0 straddles the line between the first two whites
    expect((a + b) / 2).toBe(1);
    expect(b - a).toBeLessThan(1);
  });

  it("picks a padded range of whole octaves around the notes, at least three octaves wide", () => {
    expect(keyRangeFor([])).toEqual([48, 83]);
    expect(keyRangeFor([60])).toEqual([36, 71]);
    const [low, high] = keyRangeFor([38, 88]);
    expect(low % 12).toBe(0);
    expect(high % 12).toBe(11);
    expect(low).toBeLessThanOrEqual(36);
    expect(high).toBeGreaterThanOrEqual(90);
  });

  it("never runs off either end of the piano", () => {
    expect(keyRangeFor([21, 108])).toEqual([21, 108]);
  });

  it("lays out exactly the keys in view, scaled to the width", () => {
    const layout = layoutKeyboard(0, TOTAL_WHITES, 520);
    expect(layout.whiteW).toBe(10);
    expect(layout.keys.size).toBe(88);
    expect(layout.keys.get(21)).toEqual({ x: 0, w: 10, black: false });
    const oneOctave = layoutKeyboard(keySpan(60)[0], keySpan(71)[1], 700);
    expect(oneOctave.whiteW).toBe(100);
    expect([...oneOctave.keys.values()].filter((k) => !k.black && k.x >= 0 && k.x < 700)).toHaveLength(7);
  });
});
