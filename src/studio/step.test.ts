import { describe, expect, it } from "vitest";
import { newProject } from "../project/new";
import { applyOps } from "../project/ops";
import type { NoteTrack, Project } from "../project/types";
import { backspace, CHORD_MS, initialStep, keyDown, keyUp, rest, tie, type StepResult, type StepState } from "./step";

const Q = 480;
const melody = (p: Project) => (p.tracks.find((t) => t.id === "melody") as NoteTrack).notes;

/** A little player: presses and releases keys at given times, applying what step entry asks for. */
function player(start: Project = newProject({ id: "p" })) {
  let project = start;
  let state: StepState = initialStep();
  let cursor = 0;
  const take = (out: StepResult | null) => {
    if (!out) return false;
    project = applyOps(project, out.ops);
    state = out.state;
    if (out.cursor !== undefined) cursor = out.cursor;
    return true;
  };
  return {
    down: (pitch: number, now: number, length = Q, velocity = 0.8) =>
      take(keyDown(state, project, "melody", cursor, length, { pitch, velocity, now })),
    up: () => void (state = keyUp(state)),
    rest: (length = Q) => take(rest(state, cursor, length)),
    tie: (length = Q) => take(tie(state, project, "melody", cursor, length)),
    back: () => take(backspace(state, project, "melody")),
    get notes() {
      return melody(project).map((n) => [n.pitch, n.tick, n.dur]);
    },
    get cursor() {
      return cursor;
    },
    get project() {
      return project;
    },
    set cursorAt(tick: number) {
      cursor = tick;
    },
  };
}

describe("step entry", () => {
  it("a key writes a note of the chosen length at the cursor, and the cursor moves on by that length", () => {
    const p = player();
    p.down(60, 0);
    p.up();
    p.down(62, 500, Q / 2);
    p.up();
    expect(p.notes).toEqual([
      [60, 0, Q],
      [62, Q, Q / 2],
    ]);
    expect(p.cursor).toBe(Q + Q / 2);
    expect(melody(p.project)[0]).toMatchObject({ origin: "manual", vel: 0.8 });
  });

  // ── Acceptance criterion 2 ──
  it("three keys pressed together write one three-note chord and advance the cursor once", () => {
    const p = player();
    p.down(60, 1000);
    p.down(64, 1000 + 20);
    p.down(67, 1000 + 45);
    p.up();
    p.up();
    p.up();
    expect(p.notes).toEqual([
      [60, 0, Q],
      [64, 0, Q],
      [67, 0, Q],
    ]);
    expect(p.cursor).toBe(Q);
    // The next key, played after them, is the next step.
    p.down(65, 2000);
    expect(p.notes.at(-1)).toEqual([65, Q, Q]);
    expect(p.cursor).toBe(2 * Q);
  });

  it(`keys within ${CHORD_MS} ms are a chord even if each is let go at once; later than that, they are a run`, () => {
    const p = player();
    p.down(60, 0);
    p.up();
    p.down(64, CHORD_MS);
    p.up();
    p.down(67, CHORD_MS + CHORD_MS + 1);
    p.up();
    expect(p.notes).toEqual([
      [60, 0, Q],
      [64, 0, Q],
      [67, Q, Q],
    ]);
  });

  it("a key pressed while another is still held joins it, however slowly", () => {
    const p = player();
    p.down(60, 0);
    p.down(67, 900);
    p.up();
    p.up();
    p.down(72, 1800);
    expect(p.notes).toEqual([
      [60, 0, Q],
      [67, 0, Q],
      [72, Q, Q],
    ]);
  });

  it("a chord keeps the length it was begun with, even if the length is changed mid-chord", () => {
    const p = player();
    p.down(60, 0, Q);
    p.down(64, 10, Q / 4);
    expect(p.notes).toEqual([
      [60, 0, Q],
      [64, 0, Q],
    ]);
  });

  it("rest moves on without writing; tie holds the last note or chord for longer", () => {
    const p = player();
    p.down(60, 0);
    p.down(64, 10);
    p.up();
    p.up();
    expect(p.tie()).toBe(true);
    expect(p.notes).toEqual([
      [60, 0, 2 * Q],
      [64, 0, 2 * Q],
    ]);
    expect(p.cursor).toBe(2 * Q);
    p.rest();
    expect(p.cursor).toBe(3 * Q);
    // After a rest the note no longer ends at the cursor: there is nothing to tie.
    expect(p.tie()).toBe(false);
    p.down(67, 5000);
    expect(p.notes.at(-1)).toEqual([67, 3 * Q, Q]);
  });

  it("backspace takes back the last entry — a note, a whole chord, a rest, a tie — and steps back", () => {
    const p = player();
    p.down(60, 0);
    p.up();
    p.down(64, 1000);
    p.down(67, 1010);
    p.up();
    p.up();
    p.tie();
    p.rest();
    expect(p.cursor).toBe(4 * Q);

    expect(p.back()).toBe(true); // the rest
    expect(p.cursor).toBe(3 * Q);
    expect(p.back()).toBe(true); // the tie
    expect(p.notes.slice(1)).toEqual([
      [64, Q, Q],
      [67, Q, Q],
    ]);
    expect(p.cursor).toBe(2 * Q);
    expect(p.back()).toBe(true); // the chord, both notes
    expect(p.notes).toEqual([[60, 0, Q]]);
    expect(p.cursor).toBe(Q);
    expect(p.back()).toBe(true);
    expect(p.notes).toEqual([]);
    expect(p.cursor).toBe(0);
    expect(p.back()).toBe(false);
  });
});

describe("filling a rhythm that is waiting for pitches", () => {
  const withRhythm = () =>
    applyOps(newProject({ id: "p" }), [
      {
        op: "setPending",
        pending: {
          trackId: "melody",
          slots: [
            { tick: 0, dur: 240, vel: 0.9 },
            { tick: 240, dur: 720, vel: 0.5 },
            { tick: 1440, dur: 480, vel: 0.7 },
          ],
        },
      },
    ]);

  it("each key gives the next slot its pitch, keeping the slot's start, length and strength", () => {
    const p = player(withRhythm());
    p.down(60, 0, Q, 0.2);
    p.up();
    expect(p.notes).toEqual([[60, 0, 240]]);
    expect(melody(p.project)[0].vel).toBe(0.9);
    expect(p.cursor).toBe(240);
    expect(p.project.pending?.slots).toHaveLength(2);

    p.down(64, 1000);
    p.down(67, 1020); // a chord fills one slot
    p.up();
    p.up();
    expect(p.notes.slice(1)).toEqual([
      [64, 240, 720],
      [67, 240, 720],
    ]);
    expect(p.cursor).toBe(1440);

    p.down(72, 3000);
    expect(p.notes.at(-1)).toEqual([72, 1440, 480]);
    // The rhythm is used up: nothing is waiting, and keys write at the cursor again.
    expect(p.project.pending).toBeUndefined();
    expect(p.cursor).toBe(1920);
    p.up();
    p.down(74, 5000);
    expect(p.notes.at(-1)).toEqual([74, 1920, Q]);
  });

  it("backspace takes the pitch back and the slot is waiting again", () => {
    const p = player(withRhythm());
    p.down(60, 0);
    p.up();
    p.back();
    expect(p.notes).toEqual([]);
    expect(p.project.pending?.slots.map((s) => s.tick)).toEqual([0, 240, 1440]);
    expect(p.cursor).toBe(0);
  });

  it("a rhythm waiting on another track is left alone", () => {
    const p = player(
      applyOps(newProject({ id: "p" }), [
        { op: "setPending", pending: { trackId: "bass", slots: [{ tick: 960, dur: 240, vel: 0.9 }] } },
      ]),
    );
    p.down(60, 0);
    expect(p.notes).toEqual([[60, 0, Q]]);
    expect(p.project.pending?.slots).toHaveLength(1);
  });
});
