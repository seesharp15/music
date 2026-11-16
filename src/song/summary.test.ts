import { describe, expect, it } from "vitest";
import { parseSong } from "./schema";
import { density, summarize } from "./summary";

describe("summarize", () => {
  it("handles a song with no notes", () => {
    expect(summarize({ format: "piano-song/v2", id: "u-x", title: "Empty", notes: [] })).toEqual({
      duration: 0,
      noteCount: 0,
      preview: new Array(48).fill(0),
    });
  });
  it("measures density in any unit", () => {
    expect(density([{ time: 0, duration: 480 }], 1920, 4)).toEqual([1, 0, 0, 0]);
    expect(
      density(
        [
          { time: 0, duration: 960 },
          { time: 480, duration: 480 },
        ],
        1920,
        4,
      ),
    ).toEqual([0.5, 1, 0, 0]);
  });
});

describe("parseSong", () => {
  it("accepts a song and gives it back as written", () => {
    const raw = {
      format: "piano-song/v1",
      id: "x",
      title: "T",
      notes: [{ pitch: 60, time: 1, duration: 1, hand: "R" }],
    };
    expect(parseSong(raw)).toEqual({ ok: true, song: raw });
  });
  it("refuses what is not a song, and says where a song is damaged", () => {
    expect(parseSong(null)).toMatchObject({ ok: false });
    const wrong = parseSong({ format: "piano-project/v1" });
    expect(!wrong.ok && wrong.errors[0]).toContain("piano-project/v1");
    const noFormat = parseSong({ notes: [] });
    expect(!noFormat.ok && noFormat.errors[0]).toMatch(/no "format" field/);
    const damaged = parseSong({
      format: "piano-song/v1",
      id: "x",
      title: "T",
      notes: [{ pitch: 60, time: "soon", duration: 1, hand: "R" }],
    });
    expect(!damaged.ok && damaged.errors[0]).toMatch(/^notes\.0\.time:/);
    const hand = parseSong({
      format: "piano-song/v1",
      id: "x",
      title: "T",
      notes: [{ pitch: 60, time: 0, duration: 1, hand: "X" }],
    });
    expect(!hand.ok && hand.errors[0]).toMatch(/^notes\.0\.hand:/);
  });
});
