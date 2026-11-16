import { describe, expect, it } from "vitest";
import { keySpan } from "../components/keyboard";
import {
  chooseKeys,
  clampZoom,
  frame,
  hitNote,
  keyRect,
  noteRect,
  notesInBox,
  pitchAtX,
  tickAtY,
  visibleTicks,
  yAtTick,
  zoneAt,
  zoomAbout,
  zoomLimits,
  type NoteBox,
  type View,
} from "./view";

/** A phone-sized canvas showing C4 to B5, a quarter note every 40 px, with the line on tick 960. */
const view = (patch: Partial<View> = {}): View => ({
  width: 390,
  height: 600,
  barGutter: 26,
  chordGutter: 46,
  lane: 0,
  kbH: 140,
  tick: 960,
  ticksPerPx: 12,
  keyLo: keySpan(60)[0],
  keyHi: keySpan(60)[0] + 14,
  ...patch,
});

describe("where things are", () => {
  it("the line is two fifths of the way up the waterfall", () => {
    const f = frame(view());
    expect(f).toMatchObject({ left: 72, right: 390, bottom: 460, lineY: 276, keysWidth: 318 });
  });

  it("later music is higher, and ticks and pixels convert both ways", () => {
    const v = view();
    expect(yAtTick(v, 960)).toBe(276);
    expect(yAtTick(v, 960 + 480)).toBe(236);
    expect(yAtTick(v, 0)).toBe(356);
    for (const y of [0, 100, 276, 459.5]) expect(yAtTick(v, tickAtY(v, y))).toBeCloseTo(y, 9);
    expect(visibleTicks(v)).toEqual({ start: 960 - 184 * 12, end: 960 + 276 * 12 });
  });

  it("names the part of the canvas under a point", () => {
    const v = view({ lane: 16 });
    expect(zoneAt(v, 10, 100)).toBe("bars");
    expect(zoneAt(v, 40, 100)).toBe("chords");
    expect(zoneAt(v, 200, 100)).toBe("waterfall");
    expect(zoneAt(v, 380, 100)).toBe("lane");
    expect(zoneAt(v, 200, 500)).toBe("keys");
  });
});

describe("keys and columns", () => {
  const v = view();
  const white = 318 / 14;

  it("puts middle C at the left edge of the keys", () => {
    expect(keyRect(v, 60)).toMatchObject({ x: 72, black: false });
    expect(keyRect(v, 60).w).toBeCloseTo(white, 9);
    expect(keyRect(v, 61).black).toBe(true);
  });

  it("finds the pitch whose column a point is in; a black key's column wins in the waterfall", () => {
    expect(pitchAtX(v, 72 + white / 4)).toBe(60);
    expect(pitchAtX(v, 72 + white)).toBe(61); // on the line between C and D: C#'s column
    expect(pitchAtX(v, 72 + white * 1.5)).toBe(62);
    expect(pitchAtX(v, 72 + white * 13.5)).toBe(83);
    expect(pitchAtX(v, 20)).toBeNull();
  });

  it("on the keyboard, a black key is only as tall as it is drawn", () => {
    const x = 72 + white; // between C and D
    expect(pitchAtX(v, x, { y: 470 })).toBe(61);
    expect(pitchAtX(v, x + 0.01, { y: 590 })).toBe(62);
    expect(pitchAtX(v, x - 0.01, { y: 590 })).toBe(60);
  });

  it("every key on screen is found from its own middle", () => {
    for (let p = 60; p <= 83; p++) {
      const k = keyRect(v, p);
      expect(pitchAtX(v, k.x + k.w / 2, { y: 465 })).toBe(p);
      expect(pitchAtX(v, k.x + k.w / 2)).toBe(p);
    }
  });
});

describe("zoom", () => {
  const v = view();
  it("runs from one bar on screen to sixteen", () => {
    expect(zoomLimits(v, 1920)).toEqual({ min: 1920 / 460, max: (16 * 1920) / 460 });
    expect(clampZoom(0.01, v, 1920)).toBe(1920 / 460);
    expect(clampZoom(9999, v, 1920)).toBe((16 * 1920) / 460);
  });

  it("keeps the music under the fingers where it is", () => {
    const y = 120;
    const before = tickAtY(v, y);
    const z = zoomAbout(v, 2, y, 1920);
    expect(z.ticksPerPx).toBe(24);
    expect(tickAtY({ ...v, ...z }, y)).toBeCloseTo(before, 9);
  });
});

describe("which keys to show", () => {
  const C = (octave: number) => keySpan(12 * (octave + 1))[0];

  it("an empty melody track gets two octaves a finger can play, around where melodies sit", () => {
    expect(chooseKeys({ mode: "fit", pitches: [], role: "melody", shift: 0, width: 318 })).toEqual({
      keyLo: C(4),
      keyHi: C(6),
    });
    expect(chooseKeys({ mode: "fit", pitches: [], role: "bass", shift: 0, width: 318 })).toEqual({
      keyLo: C(2),
      keyHi: C(4),
    });
  });

  it("shows the track's range and an octave either side when that fits", () => {
    expect(chooseKeys({ mode: "fit", pitches: [60, 67, 72], shift: 0, width: 1200 })).toEqual({
      keyLo: C(3),
      keyHi: C(7),
    });
  });

  it("on a narrow screen shows what fits, around the notes near the cursor", () => {
    const out = chooseKeys({ mode: "fit", pitches: [48, 60, 84], near: [84, 86], shift: 0, width: 318 });
    expect(out.keyHi - out.keyLo).toBe(14);
    expect(out.keyLo).toBeLessThanOrEqual(keySpan(84)[0]);
    expect(out.keyHi).toBeGreaterThanOrEqual(keySpan(86)[1]);
  });

  it("shifts by whole octaves and stops at the ends of the piano", () => {
    const base = chooseKeys({ mode: "fit", pitches: [], role: "melody", shift: 0, width: 318 });
    const up = chooseKeys({ mode: "fit", pitches: [], role: "melody", shift: 1, width: 318 });
    expect(up.keyLo - base.keyLo).toBe(7);
    const top = chooseKeys({ mode: "fit", pitches: [], role: "melody", shift: 9, width: 318 });
    expect(top).toEqual({ keyLo: 52 - 14, keyHi: 52 });
    const bottom = chooseKeys({ mode: "fit", pitches: [], role: "melody", shift: -9, width: 318 });
    expect(bottom).toEqual({ keyLo: 0, keyHi: 14 });
  });

  it("Song shows every note of every track; All shows the whole piano", () => {
    const song = chooseKeys({ mode: "song", pitches: [36, 96], shift: 0, width: 318 });
    expect(song).toEqual({ keyLo: C(2), keyHi: C(8) });
    expect(chooseKeys({ mode: "all", pitches: [], shift: 3, width: 318 })).toEqual({ keyLo: 0, keyHi: 52 });
  });
});

describe("taking hold of a note", () => {
  const v = view();
  // A quarter note on E4 at the line, and a tiny grace note on G4 above it.
  const notes: NoteBox[] = [
    { id: 1, pitch: 64, tick: 960, dur: 480 },
    { id: 2, pitch: 67, tick: 1920, dur: 60 },
  ];
  const e = noteRect(v, notes[0]);
  const g = noteRect(v, notes[1]);

  it("a note's rectangle runs from its start up to its end", () => {
    expect(e.bottom).toBe(276);
    expect(e.top).toBe(236);
    expect(g.h).toBe(5);
  });

  it("the body moves it; the strip at its top resizes it", () => {
    expect(hitNote(v, notes, e.x + e.w / 2, e.bottom - 5)).toEqual({ id: 1, part: "body" });
    expect(hitNote(v, notes, e.x + e.w / 2, e.top + 3)).toEqual({ id: 1, part: "top" });
    expect(hitNote(v, notes, e.x + e.w / 2, e.top + 3, { handles: false })).toEqual({ id: 1, part: "body" });
  });

  it("a finger can catch the handle from a little above the note", () => {
    expect(hitNote(v, notes, e.x + e.w / 2, e.top - 8, { touch: true })).toEqual({ id: 1, part: "top" });
    expect(hitNote(v, notes, e.x + e.w / 2, e.top - 8)?.part).not.toBe("top");
  });

  it("a small note is never harder to take hold of than a 44 px target", () => {
    const cx = g.x + g.w / 2;
    const cy = (g.top + g.bottom) / 2;
    expect(hitNote(v, notes, cx + 20, cy + 18)?.id).toBe(2);
    expect(hitNote(v, notes, cx + 30, cy)).toBeNull();
    expect(hitNote(v, notes, cx, cy + 40)).toBeNull();
  });

  it("of two notes within reach, the nearer one is taken", () => {
    const close: NoteBox[] = [
      { id: 1, pitch: 64, tick: 960, dur: 60 },
      { id: 2, pitch: 65, tick: 960, dur: 60 },
    ];
    const a = noteRect(v, close[0]);
    const b = noteRect(v, close[1]);
    expect(hitNote(v, close, a.x - 6, a.top - 10)?.id).toBe(1);
    expect(hitNote(v, close, b.x + b.w + 6, b.top - 10)?.id).toBe(2);
  });

  it("nothing is taken from the keyboard or the gutters", () => {
    expect(hitNote(v, notes, 30, e.bottom - 5)).toBeNull();
    expect(hitNote(v, notes, e.x + 2, 500)).toBeNull();
  });

  it("a box takes every note it touches", () => {
    expect(notesInBox(v, notes, { x: e.x - 5, y: e.top - 5 }, { x: e.x + 5, y: e.top + 5 })).toEqual([1]);
    expect(notesInBox(v, notes, { x: 72, y: 0 }, { x: 390, y: 460 })).toEqual([1, 2]);
    expect(notesInBox(v, notes, { x: 380, y: 0 }, { x: 390, y: 20 })).toEqual([]);
  });
});
