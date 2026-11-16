import { describe, expect, it } from "vitest";
import { createUiStore, initialUi, lengthTicks, sanitizeSavedUi, savedUiOf } from "./ui-store";

describe("step lengths", () => {
  it("counts ticks at 480 to the quarter note", () => {
    expect(lengthTicks({ base: 1, dotted: false, triplet: false })).toBe(1920);
    expect(lengthTicks({ base: 4, dotted: false, triplet: false })).toBe(480);
    expect(lengthTicks({ base: 16, dotted: false, triplet: false })).toBe(120);
    expect(lengthTicks({ base: 32, dotted: false, triplet: false })).toBe(60);
  });
  it("a dotted note is half as long again, a triplet two thirds", () => {
    expect(lengthTicks({ base: 4, dotted: true, triplet: false })).toBe(720);
    expect(lengthTicks({ base: 8, dotted: false, triplet: true })).toBe(160);
    expect(lengthTicks({ base: 4, dotted: false, triplet: true })).toBe(320);
  });
});

describe("the editor state remembered for a project", () => {
  const tracks = ["melody", "chords", "bass", "drums"];

  it("round-trips through storage", () => {
    const ui = createUiStore("melody");
    ui.setState({ cursor: 1920, tool: "draw", activeTrack: "bass", ticksPerPx: 9, snap: "8t", keyShift: -1 });
    const saved = JSON.parse(JSON.stringify(savedUiOf(ui.getState())));
    const back = createUiStore("melody", sanitizeSavedUi(saved, tracks)).getState();
    expect(back).toMatchObject({
      cursor: 1920,
      tool: "draw",
      activeTrack: "bass",
      ticksPerPx: 9,
      snap: "8t",
      keyShift: -1,
    });
  });

  it("does not remember the selection, an open sheet or playback", () => {
    const saved = savedUiOf({ ...initialUi("melody"), selection: [1, 2], sheet: "tracks", playing: true });
    expect(saved).not.toHaveProperty("selection");
    expect(saved).not.toHaveProperty("sheet");
    expect(saved).not.toHaveProperty("playing");
  });

  it.each([null, undefined, 7, "x", []])("ignores %j", (raw) => {
    expect(sanitizeSavedUi(raw, tracks)).toEqual({});
  });

  it("drops what is damaged and keeps what is sound", () => {
    const out = sanitizeSavedUi(
      {
        cursor: -5,
        tool: "hammer",
        activeTrack: "gone",
        ticksPerPx: 1e9,
        snap: 7,
        keys: "song",
        length: { base: 3 },
        keyShift: 99,
      },
      tracks,
    );
    expect(out).toEqual({ ticksPerPx: 200, keys: "song", keyShift: 4 });
  });

  it("a track that has been deleted is not the active one", () => {
    expect(sanitizeSavedUi({ activeTrack: "bass" }, ["melody"])).toEqual({});
    expect(sanitizeSavedUi({ activeTrack: "bass" }, tracks)).toEqual({ activeTrack: "bass" });
  });
});
