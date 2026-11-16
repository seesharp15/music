/**
 * The editor's view maths: ticks and keys ⇄ pixels, and what is under a point. No canvas and no
 * store here, so it is all unit-tested (and a sideways view could later reuse it).
 *
 * Time runs up the screen: later music is higher. The cursor line is fixed on screen; the music
 * moves under it. Keys run left to right, in white-key units as Practice lays them out.
 */
import { keySpan, layoutKeyboard, TOTAL_WHITES, type KeyRect, type KeyboardLayout } from "../components/keyboard";
import { BLACK_KEY_HEIGHT } from "../components/stage-draw";
import { MAX_PITCH, MIN_PITCH } from "../song/ids";

export interface View {
  /** Canvas size, CSS pixels. */
  width: number;
  height: number;
  /** Width of the bar-number and chord gutters at the left. */
  barGutter: number;
  chordGutter: number;
  /** Width of the drum lane at the right edge; 0 when the song has no drums. */
  lane: number;
  /** Height of the keyboard at the bottom. */
  kbH: number;
  /** The tick under the cursor line; fractional while scrolling or playing. */
  tick: number;
  ticksPerPx: number;
  /** The keys shown, in white-key units (A0 starts at 0, C8 ends at 52). */
  keyLo: number;
  keyHi: number;
}

export const BAR_GUTTER = 26;
export const CHORD_GUTTER = 46;
export const DRUM_LANE = 16;
/** The cursor line sits this share of the waterfall's height above the keyboard. */
export const LINE_AT = 0.4;
/** A note is taken hold of within this many pixels of its centre, however small it is drawn. */
export const MIN_HIT = 44;
/** The strip at a note's top edge that resizes it instead of moving it. */
export const HANDLE_PX = 12;

export const keyboardHeight = (height: number) => Math.round(Math.min(170, Math.max(92, height * 0.24)));

/** Where the pieces of the canvas are. */
export function frame(v: Pick<View, "width" | "height" | "barGutter" | "chordGutter" | "lane" | "kbH">) {
  const left = v.barGutter + v.chordGutter;
  const right = v.width - v.lane;
  const bottom = v.height - v.kbH; // the waterfall's foot, where the keyboard starts
  const lineY = Math.round(bottom - bottom * LINE_AT);
  return { left, right, top: 0, bottom, lineY, keysWidth: Math.max(1, right - left) };
}

export const yAtTick = (v: View, tick: number) => frame(v).lineY - (tick - v.tick) / v.ticksPerPx;
export const tickAtY = (v: View, y: number) => v.tick + (frame(v).lineY - y) * v.ticksPerPx;

/** The ticks on screen, from the foot of the waterfall to its top. */
export function visibleTicks(v: View): { start: number; end: number } {
  const f = frame(v);
  return { start: tickAtY(v, f.bottom), end: tickAtY(v, f.top) };
}

/** The keyboard as laid out across the canvas: key rectangles with x in canvas pixels. */
export function keyboardOf(v: View): KeyboardLayout & { whiteW: number } {
  const f = frame(v);
  const layout = layoutKeyboard(v.keyLo, v.keyHi, f.keysWidth);
  for (const k of layout.keys.values()) k.x += f.left;
  return layout;
}

export function keyRect(v: View, pitch: number): KeyRect {
  const f = frame(v);
  const whiteW = f.keysWidth / (v.keyHi - v.keyLo);
  const [a, b] = keySpan(pitch);
  return { x: f.left + (a - v.keyLo) * whiteW, w: (b - a) * whiteW, black: b - a < 1 };
}

/**
 * The pitch whose column a point is in. In the waterfall a black key's column wins where it
 * overlaps its neighbours, as its notes are drawn on top. On the keyboard itself (`onKeys`), the
 * black keys are only as tall as they are drawn. Null outside the keys.
 */
export function pitchAtX(v: View, x: number, onKeys?: { y: number }): number | null {
  const f = frame(v);
  if (x < f.left || x > f.right) return null;
  const whiteW = f.keysWidth / (v.keyHi - v.keyLo);
  const u = v.keyLo + (x - f.left) / whiteW;
  const blackReach = !onKeys || onKeys.y <= f.bottom + 3 + (v.kbH - 3) * BLACK_KEY_HEIGHT;
  let white: number | null = null;
  for (let p = MIN_PITCH; p <= MAX_PITCH; p++) {
    const [a, b] = keySpan(p);
    if (u < a || u >= b) continue;
    if (b - a < 1) {
      if (blackReach) return p;
    } else white = p;
  }
  return white;
}

// ── Zoom ─────────────────────────────────────────────────────────────────────

/** Zoom runs from one bar on screen to sixteen. */
export function zoomLimits(v: Pick<View, "height" | "kbH">, ticksPerBar: number): { min: number; max: number } {
  const h = Math.max(1, v.height - v.kbH);
  return { min: ticksPerBar / h, max: (16 * ticksPerBar) / h };
}

export function clampZoom(ticksPerPx: number, v: Pick<View, "height" | "kbH">, ticksPerBar: number): number {
  const { min, max } = zoomLimits(v, ticksPerBar);
  return Math.min(max, Math.max(min, ticksPerPx));
}

/**
 * Zoom by `factor` (above 1 shows more music) keeping the music under `y` where it is. Returns
 * the new zoom and the tick the line is then on.
 */
export function zoomAbout(
  v: View,
  factor: number,
  y: number,
  ticksPerBar: number,
): { ticksPerPx: number; tick: number } {
  const ticksPerPx = clampZoom(v.ticksPerPx * factor, v, ticksPerBar);
  const anchor = tickAtY(v, y);
  return { ticksPerPx, tick: anchor - (frame(v).lineY - y) * ticksPerPx };
}

// ── Which keys to show ───────────────────────────────────────────────────────

const OCTAVE_WHITES = 7;
/** White-key position of the C at or below a pitch. */
const cBelow = (pitch: number) => {
  const p = Math.round(pitch);
  return keySpan(p - (((p % 12) + 12) % 12))[0];
};
/** The C an empty track's keyboard starts from, by what the track is for. */
const DEFAULT_LOW: Record<string, number> = { melody: 60, counter: 60, chords: 48, bass: 36, free: 48 };

/**
 * The keys to show. `fit` shows the notes near the cursor (or all the track's, if they fit) with an
 * octave either side, but never so many keys that one is too narrow for a finger: then it shows
 * what fits, centred on the music. `shift` moves the window by whole octaves.
 */
export function chooseKeys(opts: {
  mode: "fit" | "song" | "all";
  /** Pitches of the active track (for `fit`) or of every track (for `song`). */
  pitches: readonly number[];
  /** Pitches of the active track near the cursor, when there are any. */
  near?: readonly number[];
  role?: string;
  shift: number;
  /** Pixels available for keys, and the narrowest a white key may be. */
  width: number;
  minWhite?: number;
}): { keyLo: number; keyHi: number } {
  const minWhite = opts.minWhite ?? 22;
  if (opts.mode === "all") return { keyLo: 0, keyHi: TOTAL_WHITES };
  const fits = Math.max(OCTAVE_WHITES, Math.floor(opts.width / minWhite));
  const slide = (lo: number, hi: number) => {
    const span = hi - lo;
    lo += opts.shift * OCTAVE_WHITES;
    // Stay on the keyboard. The lowest C is two white keys up from A0, so a window may start there.
    lo = Math.min(Math.max(lo, 0), TOTAL_WHITES - span);
    return { keyLo: lo, keyHi: lo + span };
  };
  if (opts.mode === "song") {
    if (!opts.pitches.length) return slide(cBelow(48), cBelow(84));
    const lo = cBelow(Math.max(MIN_PITCH, Math.min(...opts.pitches)));
    const hi = Math.min(TOTAL_WHITES, cBelow(Math.min(MAX_PITCH, Math.max(...opts.pitches))) + OCTAVE_WHITES);
    return slide(Math.max(0, lo), Math.max(hi, lo + 2 * OCTAVE_WHITES));
  }
  // fit
  const basis = opts.near?.length ? opts.near : opts.pitches;
  if (!basis.length) {
    const lo = cBelow(DEFAULT_LOW[opts.role ?? "free"] ?? 48);
    return slide(lo, lo + 2 * OCTAVE_WHITES);
  }
  const low = Math.min(...basis);
  const high = Math.max(...basis);
  // The music, with an octave either side: whole octaves from a C.
  const wantLo = cBelow(low) - OCTAVE_WHITES;
  const wantHi = cBelow(high) + 2 * OCTAVE_WHITES;
  // No more octaves than fit at a playable width, but always two.
  const most = Math.max(2 * OCTAVE_WHITES, Math.floor(fits / OCTAVE_WHITES) * OCTAVE_WHITES);
  if (wantHi - wantLo <= most) return slide(wantLo, wantHi);
  const octaves = most / OCTAVE_WHITES;
  const lo = cBelow((low + high) / 2) - Math.floor((octaves - 1) / 2) * OCTAVE_WHITES;
  return slide(lo, lo + most);
}

// ── Hit-testing notes ────────────────────────────────────────────────────────

export interface NoteBox {
  id: number;
  pitch: number;
  tick: number;
  dur: number;
}

export interface NoteHit {
  id: number;
  /** `top` is the resize handle: the note's later end. */
  part: "body" | "top";
}

/** A note's rectangle on the canvas. */
export function noteRect(v: View, n: Pick<NoteBox, "pitch" | "tick" | "dur">) {
  const k = keyRect(v, n.pitch);
  const bottom = yAtTick(v, n.tick);
  const top = yAtTick(v, n.tick + n.dur);
  return { x: k.x, w: k.w, top, bottom, h: bottom - top };
}

/**
 * The note under a point. A direct hit wins, the last-drawn first. Failing that, the nearest note
 * within reach of a finger — a note is never harder to take hold of than a 44 px target. The top
 * strip of a note (and, for a finger, a little above it) is its resize handle.
 */
export function hitNote(
  v: View,
  notes: readonly NoteBox[],
  x: number,
  y: number,
  opts: { touch?: boolean; handles?: boolean } = {},
): NoteHit | null {
  const f = frame(v);
  if (y > f.bottom || x < f.left || x > f.right) return null;
  const handles = opts.handles ?? true;
  const above = opts.touch ? HANDLE_PX : 4;
  const partOf = (r: ReturnType<typeof noteRect>): NoteHit["part"] => {
    if (!handles) return "body";
    const strip = Math.min(HANDLE_PX, Math.max(4, r.h / 3));
    return y <= r.top + strip ? "top" : "body";
  };
  let best: { id: number; part: NoteHit["part"]; d: number } | null = null;
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    const r = noteRect(v, n);
    if (r.bottom < -MIN_HIT || r.top > f.bottom + MIN_HIT) continue;
    if (x >= r.x && x <= r.x + r.w && y >= r.top - (handles ? above : 0) && y <= r.bottom) {
      return { id: n.id, part: partOf(r) };
    }
    // Not a direct hit: how far is the point from the rectangle?
    const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
    const dy = Math.max(r.top - y, 0, y - r.bottom);
    const reachX = Math.max(0, (MIN_HIT - r.w) / 2);
    const reachY = Math.max(0, (MIN_HIT - r.h) / 2);
    if (dx > reachX || dy > reachY) continue;
    const d = Math.hypot(dx, dy);
    if (!best || d < best.d) best = { id: n.id, part: dy === 0 || y > r.bottom ? "body" : partOf(r), d };
  }
  return best && { id: best.id, part: best.part };
}

/** Ids of the notes a box drawn between two corners touches. */
export function notesInBox(
  v: View,
  notes: readonly NoteBox[],
  a: { x: number; y: number },
  b: { x: number; y: number },
): number[] {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  const out: number[] = [];
  for (const n of notes) {
    const r = noteRect(v, n);
    if (r.x + r.w >= x0 && r.x <= x1 && r.bottom >= y0 && r.top <= y1) out.push(n.id);
  }
  return out;
}

/** Which part of the canvas a point is in. */
export type Zone = "bars" | "chords" | "waterfall" | "keys" | "lane";
export function zoneAt(v: View, x: number, y: number): Zone {
  const f = frame(v);
  if (y >= f.bottom)
    return x >= f.left && x <= f.right ? "keys" : x < f.left ? (x < v.barGutter ? "bars" : "chords") : "lane";
  if (x < v.barGutter) return "bars";
  if (x < f.left) return "chords";
  if (x > f.right) return "lane";
  return "waterfall";
}
