import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditError } from "./errors";
import { newProject } from "./new";
import { applyOps } from "./ops";
import { createProjectStore, type ProjectPersistence } from "./store";
import { randomOp, rng } from "./testing/random";
import type { EditOp, NoteTrack, Project } from "./types";

const NOW = new Date("2026-11-16T12:00:00Z");
const fresh = () => newProject({ id: "p1", now: NOW });
const add = (pitch: number, tick = 0): EditOp => ({
  op: "addNotes",
  trackId: "melody",
  notes: [{ pitch, tick, dur: 240, vel: 0.7, origin: "manual" }],
});
const notes = (p: Project) => (p.tracks[0] as NoteTrack).notes;

describe("the project store", () => {
  it("starts clean, with nothing to undo", () => {
    const store = createProjectStore(fresh());
    expect(store.getState()).toMatchObject({
      canUndo: false,
      canRedo: false,
      dirty: false,
      undoLabel: null,
      redoLabel: null,
    });
  });

  it("applies edits, and tells its subscribers", () => {
    const store = createProjectStore(fresh());
    const seen = vi.fn();
    const stop = store.subscribe(seen);
    store.apply([add(60)], "Add a note");
    expect(notes(store.getState().project)).toHaveLength(1);
    expect(store.getState()).toMatchObject({ canUndo: true, canRedo: false, dirty: true, undoLabel: "Add a note" });
    expect(seen).toHaveBeenCalledTimes(1);
    stop();
    store.apply([add(62)], "Another");
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("undoes and redoes one step at a time, several ops to a step", () => {
    const start = fresh();
    const store = createProjectStore(start);
    store.apply([add(60), add(64), add(67)], "Add a chord");
    store.apply([add(72, 480)], "Add a note");
    const end = store.getState().project;
    store.undo();
    expect(notes(store.getState().project)).toHaveLength(3);
    expect(store.getState()).toMatchObject({ undoLabel: "Add a chord", redoLabel: "Add a note", canRedo: true });
    store.undo();
    expect(store.getState().project).toEqual(start);
    expect(store.getState().canUndo).toBe(false);
    store.undo(); // nothing left: no harm
    store.redo();
    store.redo();
    expect(store.getState().project).toEqual(end);
    store.redo();
    expect(store.getState().project).toEqual(end);
  });

  it("a new edit after an undo forgets what could have been redone", () => {
    const store = createProjectStore(fresh());
    store.apply([add(60)], "One");
    store.undo();
    store.apply([add(62)], "Two");
    expect(store.getState().canRedo).toBe(false);
    expect(notes(store.getState().project).map((n) => n.pitch)).toEqual([62]);
  });

  it("a refused edit changes nothing and is not an undo step", () => {
    const store = createProjectStore(fresh());
    const seen = vi.fn();
    store.subscribe(seen);
    const before = store.getState();
    expect(() => store.apply([add(60), add(200)], "Bad")).toThrow(EditError);
    expect(store.getState()).toBe(before);
    expect(seen).not.toHaveBeenCalled();
  });

  it("an edit that changes nothing is not an undo step", () => {
    const store = createProjectStore(fresh());
    store.apply([{ op: "patchTrack", trackId: "melody", patch: { volume: 0.8 } }], "Same volume");
    expect(store.getState()).toMatchObject({ canUndo: false, dirty: false });
  });

  it("previews without touching the project", () => {
    const store = createProjectStore(fresh());
    const before = store.getState();
    const preview = store.preview([add(60)]);
    expect(notes(preview)).toHaveLength(1);
    expect(store.getState()).toBe(before);
  });

  it("keeps the last 200 steps", () => {
    const store = createProjectStore(fresh());
    for (let i = 0; i < 230; i++) store.apply([add(60, i * 240)], `Note ${i}`);
    let undone = 0;
    while (store.getState().canUndo) {
      store.undo();
      undone++;
    }
    expect(undone).toBe(200);
    expect(notes(store.getState().project)).toHaveLength(30);
  });

  // Acceptance criterion 6.
  it.each([1, 2, 3])(
    "seed %i: 200 random edits then 200 undos give back the starting project; redo replays them",
    (seed) => {
      const r = rng(seed);
      const start = applyOps(fresh(), [
        add(60),
        add(64, 480),
        {
          op: "setChords",
          range: { start: 0, end: 1920 },
          chords: [{ tick: 0, dur: 1920, symbol: "C", origin: "manual" }],
        },
      ]);
      const snapshot = structuredClone(start);
      const store = createProjectStore(start);
      const states: Project[] = [];
      let edits = 0;
      for (let i = 0; edits < 200; i++) {
        const before = store.getState().project;
        store.apply([randomOp(before, r, i)], `Edit ${i}`);
        if (store.getState().project !== before) {
          edits++;
          states.push(store.getState().project);
        }
      }
      const end = store.getState().project;
      for (let i = 0; i < 200; i++) {
        store.undo();
        // Every step on the way back is exactly the state it was on the way there.
        const expected = i === 199 ? snapshot : states[198 - i];
        try {
          expect(store.getState().project).toEqual(expected);
        } catch {
          throw new Error(`seed ${seed}: undo ${i} did not restore the earlier state`);
        }
      }
      expect(store.getState().project).toEqual(start);
      expect(store.getState().project).toEqual(snapshot);
      expect(store.getState().canUndo).toBe(false);
      for (let i = 0; i < 200; i++) store.redo();
      expect(store.getState().project).toEqual(end);
      expect(store.getState().canRedo).toBe(false);
    },
  );

  it("200 steps of undo on a 3,000-note project stay under 5 MB", () => {
    const r = rng(7);
    let big = fresh();
    for (const [trackId, base] of [
      ["melody", 60],
      ["chords", 48],
      ["bass", 36],
    ] as const) {
      big = applyOps(big, [
        {
          op: "addNotes",
          trackId,
          notes: Array.from({ length: 1000 }, (_, i) => ({
            pitch: base + (i % 12),
            tick: i * 120,
            dur: 120,
            vel: 0.7,
            origin: "manual" as const,
          })),
        },
      ]);
    }
    const store = createProjectStore(big);
    const started = performance.now();
    for (let i = 0; i < 200; i++) {
      const p = store.getState().project;
      const track = p.tracks[i % 3] as NoteTrack;
      const victim = track.notes[Math.floor(r() * track.notes.length)];
      // The everyday edits: add a note somewhere in the middle, move one, delete one.
      const op: EditOp =
        i % 3 === 0
          ? {
              op: "addNotes",
              trackId: track.id,
              notes: [{ pitch: 70, tick: Math.floor(r() * 1000) * 120, dur: 120, vel: 0.7, origin: "manual" }],
            }
          : i % 3 === 1
            ? { op: "shiftNotes", trackId: track.id, ids: [victim.id], ticks: 240, semitones: 1 }
            : { op: "removeNotes", trackId: track.id, ids: [victim.id] };
      store.apply([op], `Edit ${i}`);
    }
    const perEdit = (performance.now() - started) / 200;
    expect(store.historySize()).toBeLessThan(5 * 1024 * 1024);
    // In fact it is three orders of magnitude under.
    expect(store.historySize()).toBeLessThan(100 * 1024);
    expect(perEdit).toBeLessThan(20);
    for (let i = 0; i < 200; i++) store.undo();
    expect(store.getState().project).toEqual(big);
  });
});

describe("autosave", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  function recorder(opts: { fail?: () => boolean; delayMs?: number } = {}) {
    const saved: { project: Project; snapshot: boolean }[] = [];
    const now: Project[] = [];
    const persistence: ProjectPersistence = {
      async save(project, { snapshot }) {
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
        if (opts.fail?.()) throw new Error("disk full");
        saved.push({ project, snapshot });
      },
      saveNow: (project) => void now.push(project),
    };
    return { saved, now, persistence };
  }

  it("saves 800 ms after the last change, not after each", async () => {
    const { saved, persistence } = recorder();
    const store = createProjectStore(fresh(), { persistence });
    store.apply([add(60)], "One");
    await vi.advanceTimersByTimeAsync(500);
    store.apply([add(62)], "Two");
    await vi.advanceTimersByTimeAsync(799);
    expect(saved).toHaveLength(0);
    expect(store.getState().dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(saved).toHaveLength(1);
    expect(notes(saved[0].project)).toHaveLength(2);
    expect(store.getState().dirty).toBe(false);
    store.dispose();
  });

  it("stamps what it saves with the time of saving", async () => {
    const { saved, persistence } = recorder();
    const store = createProjectStore(fresh(), { persistence, now: () => new Date("2026-12-01T00:00:00Z") });
    store.apply([add(60)], "One");
    await vi.advanceTimersByTimeAsync(800);
    expect(saved[0].project.updatedAt).toBe("2026-12-01T00:00:00.000Z");
    expect({ ...saved[0].project, updatedAt: "" }).toEqual({ ...store.getState().project, updatedAt: "" });
  });

  it("keeps a snapshot with every fifth save", async () => {
    const { saved, persistence } = recorder();
    const store = createProjectStore(fresh(), { persistence });
    for (let i = 0; i < 11; i++) {
      store.apply([add(60, i * 240)], `Note ${i}`);
      await vi.advanceTimersByTimeAsync(800);
    }
    expect(saved.map((s) => s.snapshot)).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      true,
      false,
    ]);
  });

  it("saves undo and redo as well", async () => {
    const { saved, persistence } = recorder();
    const store = createProjectStore(fresh(), { persistence });
    store.apply([add(60)], "One");
    await vi.advanceTimersByTimeAsync(800);
    store.undo();
    await vi.advanceTimersByTimeAsync(800);
    expect(saved.map((s) => notes(s.project).length)).toEqual([1, 0]);
  });

  it("flush saves at once, and does nothing when there is nothing to save", async () => {
    const { saved, persistence } = recorder();
    const store = createProjectStore(fresh(), { persistence });
    await store.flush();
    expect(saved).toHaveLength(0);
    store.apply([add(60)], "One");
    await store.flush();
    expect(saved).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(saved).toHaveLength(1); // the pending timer was cancelled
  });

  it("stays dirty and says why when a save fails, then recovers", async () => {
    let failing = true;
    const { saved, persistence } = recorder({ fail: () => failing });
    const store = createProjectStore(fresh(), { persistence });
    store.apply([add(60)], "One");
    await vi.advanceTimersByTimeAsync(800);
    expect(store.getState()).toMatchObject({ dirty: true, saveError: "disk full" });
    failing = false;
    store.apply([add(62)], "Two");
    await vi.advanceTimersByTimeAsync(800);
    expect(store.getState()).toMatchObject({ dirty: false, saveError: null });
    expect(notes(saved[0].project)).toHaveLength(2);
  });

  it("a change made while a save is being written is saved after it, in order", async () => {
    const { saved, persistence } = recorder({ delayMs: 1000 });
    const store = createProjectStore(fresh(), { persistence });
    store.apply([add(60)], "One");
    await vi.advanceTimersByTimeAsync(900); // the first save is in flight
    store.apply([add(62)], "Two");
    await vi.advanceTimersByTimeAsync(950); // first lands; second has started
    expect(saved.map((s) => notes(s.project).length)).toEqual([1]);
    expect(store.getState().dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(saved.map((s) => notes(s.project).length)).toEqual([1, 2]);
    expect(store.getState().dirty).toBe(false);
  });

  it("writes at once when the page is hidden or closed", async () => {
    const { saved, now, persistence } = recorder();
    const store = createProjectStore(fresh(), { persistence });
    store.apply([add(60)], "One");
    window.dispatchEvent(new Event("pagehide"));
    expect(now).toHaveLength(1);
    expect(notes(now[0])).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(saved).toHaveLength(1);

    // Nothing new: nothing written.
    window.dispatchEvent(new Event("pagehide"));
    expect(now).toHaveLength(1);

    store.apply([add(62)], "Two");
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(now).toHaveLength(2);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });

    store.dispose();
    store.apply([add(64)], "Three");
    window.dispatchEvent(new Event("pagehide"));
    expect(now).toHaveLength(2);
  });

  it("listens for the tab being closed only while there is something unsaved", async () => {
    const { now, persistence } = recorder();
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");
    const count = (spy: typeof added) => spy.mock.calls.filter(([type]) => type === "beforeunload").length;
    const store = createProjectStore(fresh(), { persistence });
    expect(count(added)).toBe(0);
    store.apply([add(60)], "One");
    store.apply([add(62)], "Two");
    expect(count(added)).toBe(1);
    window.dispatchEvent(new Event("beforeunload"));
    expect(now).toHaveLength(1);
    expect(notes(now[0])).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().dirty).toBe(false);
    expect(count(removed)).toBe(1);
    window.dispatchEvent(new Event("beforeunload"));
    expect(now).toHaveLength(1);
    store.dispose();
    added.mockRestore();
    removed.mockRestore();
  });

  it("without somewhere to save, it never tries", async () => {
    const store = createProjectStore(fresh());
    store.apply([add(60)], "One");
    await vi.advanceTimersByTimeAsync(5000);
    await store.flush();
    expect(store.getState().dirty).toBe(true);
  });
});
