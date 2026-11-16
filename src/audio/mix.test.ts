import { describe as group, expect, it } from "vitest";
import { alphaOf, audible, defaultMix, describe, fromLevels, gainOf, lookOf, sanitizeMix } from "./mix";

group("hand mix", () => {
  it("starts with both hands at full volume", () => {
    expect(defaultMix()).toEqual({ L: { volume: 1, muted: false }, R: { volume: 1, muted: false } });
  });

  it("turns the slider into gain by squaring, and mute into silence", () => {
    expect(gainOf({ volume: 1, muted: false })).toBe(1);
    expect(gainOf({ volume: 0.5, muted: false })).toBe(0.25);
    expect(gainOf({ volume: 0, muted: false })).toBe(0);
    expect(gainOf({ volume: 0.8, muted: true })).toBe(0);
    expect(20 * Math.log10(gainOf({ volume: 0.5, muted: false }))).toBeCloseTo(-12.04, 1);
  });

  it("keeps out-of-range values in range", () => {
    expect(gainOf({ volume: 3, muted: false })).toBe(1);
    expect(gainOf({ volume: -1, muted: false })).toBe(0);
  });

  it("knows a slider at zero is silent but not muted", () => {
    expect(audible({ volume: 0, muted: false })).toBe(false);
    expect(audible({ volume: 0.3, muted: true })).toBe(false);
    expect(audible({ volume: 0.3, muted: false })).toBe(true);
    expect(describe({ volume: 0, muted: false })).toBe("0%");
  });

  it("draws quieter hands fainter, and a muted hand faintest", () => {
    expect(alphaOf({ volume: 1, muted: false })).toBe(1);
    expect(alphaOf({ volume: 0, muted: false })).toBeCloseTo(0.45);
    expect(alphaOf({ volume: 1, muted: true })).toBe(0.2);
    expect(lookOf({ volume: 1, muted: false })).toBe("on");
    expect(lookOf({ volume: 0.59, muted: false })).toBe("soft");
    expect(lookOf({ volume: 0.6, muted: false })).toBe("on");
    expect(lookOf({ volume: 1, muted: true })).toBe("off");
  });

  it("describes a hand in words", () => {
    expect(describe({ volume: 0.7, muted: false })).toBe("70%");
    expect(describe({ volume: 0.7, muted: true })).toBe("Muted");
  });
});

group("sessions saved before hands had a volume", () => {
  it("map on, soft and off to the nearest new setting", () => {
    expect(fromLevels({ L: "soft", R: "off" })).toEqual({
      L: { volume: 0.47, muted: false },
      R: { volume: 1, muted: true },
    });
    expect(fromLevels({ L: "on", R: "on" })).toEqual(defaultMix());
    expect(fromLevels({})).toEqual(defaultMix());
  });

  it("put soft at the same loudness it used to be", () => {
    expect(gainOf(fromLevels({ L: "soft" }).L)).toBeCloseTo(0.22, 2);
  });
});

group("a mix read back from storage", () => {
  it("is accepted when it is whole, and clamped", () => {
    expect(sanitizeMix({ L: { volume: 0.6, muted: false }, R: { volume: 7, muted: 1 } })).toEqual({
      L: { volume: 0.6, muted: false },
      R: { volume: 1, muted: true },
    });
  });
  it("is refused when it is not", () => {
    expect(sanitizeMix(null)).toBeNull();
    expect(sanitizeMix({ L: { volume: 0.5 } })).toBeNull();
    expect(sanitizeMix({ L: { volume: "x" }, R: { volume: 1 } })).toBeNull();
  });
});
