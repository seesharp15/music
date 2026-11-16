import { describe, expect, it } from "vitest";
import { newProject } from "../../project/new";
import { applyOps } from "../../project/ops";
import { checkProject } from "../../project/schema";
import type { NoteTrack } from "../../project/types";
import { addTrack, isEmptyTrack, moveTrack, removeTrack } from "./ops";

const base = () =>
  applyOps(newProject({ id: "p" }), [
    { op: "addNotes", trackId: "chords", notes: [{ pitch: 48, tick: 0, dur: 480, vel: 0.7, origin: "manual" }] },
  ]);
const order = (p: ReturnType<typeof base>) => p.tracks.map((t) => t.id);

describe("tracks", () => {
  it("a new note track goes at the end, empty, for the left hand; a second drum track is numbered", () => {
    const p = base();
    const added = addTrack(p, "notes");
    const after = applyOps(p, added.ops);
    expect(order(after)).toEqual(["melody", "chords", "bass", "drums", "track1"]);
    expect(after.tracks[4]).toMatchObject({ kind: "notes", name: "Track 5", role: "free", hand: "L", notes: [] });
    expect(added.trackId).toBe("track1");
    const drums = applyOps(after, addTrack(after, "drums").ops);
    expect(drums.tracks[5]).toMatchObject({ kind: "drums", name: "Drums 2" });
    expect(checkProject(drums)).toEqual([]);
  });

  it("moving a track changes only the order: its notes come with it", () => {
    const p = base();
    const after = applyOps(p, moveTrack(p, "chords", -1)!.ops);
    expect(order(after)).toEqual(["chords", "melody", "bass", "drums"]);
    const chords = after.tracks[0] as NoteTrack;
    expect(chords.notes.map((n) => [n.pitch, n.tick, n.dur])).toEqual([[48, 0, 480]]);
    expect(checkProject(after)).toEqual([]);
    const down = applyOps(p, moveTrack(p, "chords", 1)!.ops);
    expect(order(down)).toEqual(["melody", "bass", "chords", "drums"]);
  });

  it("the first cannot go up, the last cannot go down, and a locked track stays put", () => {
    const p = base();
    expect(moveTrack(p, "melody", -1)).toBeNull();
    expect(moveTrack(p, "drums", 1)).toBeNull();
    expect(moveTrack(p, "nothing", 1)).toBeNull();
    const locked = applyOps(p, [{ op: "patchTrack", trackId: "bass", patch: { locked: true } }]);
    expect(moveTrack(locked, "bass", -1)).toBeNull();
    expect(removeTrack(locked, "bass")).toBeNull();
  });

  it("a rhythm waiting on a track survives the track being moved", () => {
    const p = applyOps(base(), [
      { op: "setPending", pending: { trackId: "bass", slots: [{ tick: 0, dur: 240, vel: 0.8 }] } },
    ]);
    const after = applyOps(p, moveTrack(p, "bass", -1)!.ops);
    expect(after.pending).toEqual(p.pending);
    expect(checkProject(after)).toEqual([]);
  });

  it("removing a track takes it out; whether it had anything in it can be asked first", () => {
    const p = base();
    expect(isEmptyTrack(p.tracks[0])).toBe(true);
    expect(isEmptyTrack(p.tracks[1])).toBe(false);
    expect(isEmptyTrack(p.tracks[3])).toBe(true);
    expect(order(applyOps(p, removeTrack(p, "chords")!.ops))).toEqual(["melody", "bass", "drums"]);
  });
});
