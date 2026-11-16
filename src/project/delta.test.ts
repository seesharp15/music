import { describe, expect, it } from "vitest";
import { applyDelta, deltaSize, diff } from "./delta";
import { newProject } from "./new";
import { applyOps } from "./ops";
import { randomOp, rng } from "./testing/random";

const note = (pitch: number, tick: number) => ({ pitch, tick, dur: 120, vel: 0.7, origin: "manual" as const });

describe("diff and applyDelta", () => {
  it("is empty for no change", () => {
    const p = newProject({ id: "x" });
    expect(diff(p, p)).toEqual([]);
  });

  it("records one added note as one item, not as the whole list", () => {
    let p = newProject({ id: "x" });
    p = applyOps(p, [
      { op: "addNotes", trackId: "melody", notes: Array.from({ length: 500 }, (_, i) => note(60, i * 120)) },
    ]);
    const next = applyOps(p, [{ op: "addNotes", trackId: "melody", notes: [note(72, 60)] }]);
    const delta = diff(p, next);
    expect(deltaSize(delta)).toBeLessThan(400);
    expect(applyDelta(next, delta, "undo")).toEqual(p);
    expect(applyDelta(p, delta, "redo")).toEqual(next);
  });

  it("records a changed field as that field", () => {
    const p = newProject({ id: "x" });
    const next = applyOps(p, [{ op: "patchTrack", trackId: "bass", patch: { volume: 0.3 } }]);
    expect(diff(p, next)).toEqual([{ path: ["tracks", 2, "volume"], before: 0.8, after: 0.3 }]);
  });

  it("records a field that appears or disappears", () => {
    const p = newProject({ id: "x" });
    const next = applyOps(p, [{ op: "patchSong", patch: { author: "Me" } }]);
    const delta = diff(p, next);
    expect(delta).toEqual([{ path: ["author"], before: undefined, after: "Me" }]);
    expect("author" in applyDelta(next, delta, "undo")).toBe(false);
  });

  it("undoes and redoes every kind of edit exactly", () => {
    for (const seed of [11, 12, 13, 14]) {
      const r = rng(seed);
      let p = newProject({ id: "x", now: new Date(0) });
      for (let i = 0; i < 400; i++) {
        const op = randomOp(p, r, i);
        const next = applyOps(p, [op]);
        const delta = diff(p, next);
        const back = applyDelta(next, delta, "undo");
        try {
          expect(back).toEqual(p);
        } catch {
          throw new Error(`seed ${seed}, edit ${i}: undo of ${JSON.stringify(op)} went wrong`);
        }
        expect(applyDelta(p, delta, "redo")).toEqual(next);
        p = next;
      }
    }
  });

  it("handles several ops in one step", () => {
    const r = rng(5);
    let p = newProject({ id: "x", now: new Date(0) });
    for (let i = 0; i < 100; i++) {
      let next = p;
      for (let k = 0; k < 5; k++) next = applyOps(next, [randomOp(next, r, i * 10 + k)]);
      const delta = diff(p, next);
      expect(applyDelta(next, delta, "undo")).toEqual(p);
      expect(applyDelta(p, delta, "redo")).toEqual(next);
      p = next;
    }
  });
});
