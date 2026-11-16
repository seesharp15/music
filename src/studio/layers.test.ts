import { describe, expect, it } from "vitest";
import { newProject, noteTrack } from "../project/new";
import { applyOps } from "../project/ops";
import { editableTracks, layerIds, registerLayer, trackColor } from "./layers";

describe("layers", () => {
  it("the built-in layers are drawn in order: the background first, the keyboard over the notes", () => {
    const ids = layerIds();
    expect(ids).toEqual([
      "background",
      "grid",
      "notes",
      "pending",
      "drums",
      "loop",
      "line",
      "gutters",
      "keyboard",
      "box",
    ]);
  });

  it("a later stage adds its layer between two others without editing the canvas", () => {
    const remove = registerLayer({ id: "hints", order: 65, draw() {} });
    expect(layerIds().indexOf("hints")).toBe(layerIds().indexOf("gutters") + 1);
    // Registering the same id again replaces it.
    registerLayer({ id: "hints", order: 5, draw() {} })();
    expect(layerIds()).not.toContain("hints");
    remove();
    expect(layerIds()).toHaveLength(10);
  });
});

describe("track colours", () => {
  const base = newProject({ id: "p" });
  it("melody is the right hand's green, chords the left hand's blue, bass its own indigo", () => {
    expect(trackColor(base, "melody").fill).toBe("#5fd38d");
    expect(trackColor(base, "chords").fill).toBe("#5aa8f8");
    expect(trackColor(base, "bass").fill).toBe("#7b7ff0");
  });
  it("extra tracks take colours from a palette, each its own", () => {
    const p = applyOps(base, [
      { op: "addTrack", track: noteTrack("lead2", "Second melody", "melody", "R") },
      { op: "addTrack", track: noteTrack("pad", "Pad", "free", "L") },
    ]);
    const colors = ["melody", "chords", "bass", "lead2", "pad"].map((id) => trackColor(p, id).fill);
    expect(new Set(colors).size).toBe(5);
  });
});

describe("which notes can be taken hold of", () => {
  const p = applyOps(newProject({ id: "p" }), [{ op: "patchTrack", trackId: "bass", patch: { locked: true } }]);
  it("only the active track's, unless every track is being edited — and then not a locked one", () => {
    expect(editableTracks(p, { activeTrack: "chords", editAll: false }).map((t) => t.id)).toEqual(["chords"]);
    expect(editableTracks(p, { activeTrack: "chords", editAll: true }).map((t) => t.id)).toEqual(["melody", "chords"]);
  });
});
