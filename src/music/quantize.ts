import type { Groove } from "../project/types";
import { PPQ, ticksPerBeat, type TimeMap } from "./time";

/** A grid to snap to: 4 = quarter notes, 8 = eighths … "8t" = eighth-note triplets. */
export type Grid = 4 | 8 | 16 | 32 | "8t" | "16t";

export interface Swing {
  /** Share of each pair taken by its first note: 0.5 straight, 0.667 triplet swing. */
  amount: number;
  unit: 8 | 16;
}

const GRID_TICKS: Record<Grid, number> = {
  4: PPQ,
  8: PPQ / 2,
  16: PPQ / 4,
  32: PPQ / 8,
  "8t": PPQ / 3,
  "16t": PPQ / 6,
};

/** Ticks between lines of a grid. */
export function gridTicks(grid: Grid): number {
  return GRID_TICKS[grid];
}

/** Move a tick towards the nearest grid line: all the way at strength 1, not at all at 0. */
export function quantize(tick: number, grid: Grid, strength = 1): number {
  const step = gridTicks(grid);
  const line = Math.round(tick / step) * step;
  return Math.round(tick + (line - tick) * strength);
}

/**
 * How far swing moves a tick, in ticks. Time inside each pair of units is stretched so that the
 * pair's mid-point lands at `amount` of the way through: the off-beat eighth of triplet swing moves
 * 80 ticks later, the beats themselves do not move, and anything between moves in proportion.
 * `from` is where pairs are counted from: the start of the bar, when bars are not whole pairs.
 */
export function swingOffset(tick: number, swing: Swing, from = 0): number {
  if (swing.amount === 0.5) return 0;
  const pair = (PPQ * 8) / swing.unit;
  const half = pair / 2;
  const rel = tick - from;
  const inPair = rel - Math.floor(rel / pair) * pair;
  const mid = swing.amount * pair;
  const warped = inPair <= half ? (inPair / half) * mid : mid + ((inPair - half) / half) * (pair - mid);
  return warped - inPair;
}

/** Which step of a groove a tick belongs to, or -1 when it is nearer the gap between steps. */
function grooveStep(tick: number, groove: Groove, time: TimeMap): number {
  if (!groove.offsets.length && !groove.accents.length) return -1;
  const step = (PPQ * 4) / groove.unit;
  const pos = time.positionAt(tick);
  const inBar = (pos.beat - 1) * ticksPerBeat(time.meterAt(tick)) + pos.tick;
  const index = Math.round(inBar / step);
  return Math.abs(inBar - index * step) <= step / 4 ? index : -1;
}

/** How far a groove moves a tick that sits on one of its steps, in ticks. The pattern repeats each bar. */
export function grooveOffset(tick: number, groove: Groove, time: TimeMap): number {
  const i = grooveStep(tick, groove, time);
  return i < 0 || !groove.offsets.length ? 0 : (groove.offsets[i % groove.offsets.length] ?? 0);
}

/** The velocity multiplier a groove gives a tick on one of its steps; 1 elsewhere. */
export function grooveAccent(tick: number, groove: Groove, time: TimeMap): number {
  const i = grooveStep(tick, groove, time);
  return i < 0 || !groove.accents.length ? 1 : (groove.accents[i % groove.accents.length] ?? 1);
}

export interface QuantizeOptions {
  grid: Grid;
  /** 0..1; default 1. */
  strength?: number;
  /** Snap to swung grid lines rather than straight ones. */
  swing?: Swing;
  /** Snap to the grid as a groove plays it. Needs `time`, to know where bars start. */
  groove?: Groove;
  time?: TimeMap;
  /**
   * Keep the feel: the note's grid position is tidied, and the distance it moved is stored in
   * `offset`, so it still sounds where it was played (as far as its track's `feel` allows).
   */
  keepOffset?: boolean;
}

/**
 * Quantize notes (or drum hits: anything with a tick and an optional offset). A note is heard at
 * `tick + offset`; that is the position quantized.
 *
 * - Without `keepOffset` the note moves, by `strength`, to where its grid line is heard — including
 *   swing and groove when given — and loses its offset.
 * - With `keepOffset` the note's tick moves, by `strength`, to the straight grid line, and the offset
 *   becomes whatever keeps the sound where it was.
 */
export function quantizeNotes<T extends { tick: number; offset?: number }>(
  notes: readonly T[],
  opts: QuantizeOptions,
): T[] {
  const step = gridTicks(opts.grid);
  const strength = opts.strength ?? 1;
  const felt = (line: number) =>
    line +
    (opts.swing
      ? swingOffset(line, opts.swing, opts.time ? opts.time.tickOfBar(opts.time.positionAt(line).bar) : 0)
      : 0) +
    (opts.groove && opts.time ? grooveOffset(line, opts.groove, opts.time) : 0);

  return notes.map((n) => {
    const heard = n.tick + (n.offset ?? 0);
    // The nearest line as it is heard; a swung line can be nearer than the straight one beside it.
    const near = Math.round(heard / step) * step;
    let line = near;
    for (const candidate of [near - step, near + step]) {
      if (Math.abs(felt(candidate) - heard) < Math.abs(felt(line) - heard)) line = candidate;
    }
    const { offset: _old, ...rest } = n;
    if (opts.keepOffset) {
      const tick = Math.round(heard + (line - heard) * strength);
      const offset = Math.round(heard - tick);
      return (offset ? { ...rest, tick, offset } : { ...rest, tick }) as T;
    }
    return { ...rest, tick: Math.round(heard + (felt(line) - heard) * strength) } as T;
  });
}
