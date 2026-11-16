/**
 * A recorded take, turned into notes: pure. Each note that was played is filed on the nearest grid
 * line and the distance it was played from that line is kept in `offset`, so the take can be
 * heard as played or exactly on the grid without being recorded again.
 */
import { quantizeNotes, type Grid, gridTicks } from "../music/quantize";
import type { TimeMap } from "../music/time";
import type { PNote } from "../project/types";

/** One key press as it was played: when it went down and came up, in song seconds. */
export interface Played {
  pitch: number;
  velocity: number;
  /** Song seconds, at the song's own speed. */
  on: number;
  off: number;
}

export interface TakeOptions {
  grid: Grid;
  /** The device's calibrated input latency: every time is this much later than it was played. */
  latencyMs: number;
  /** Notes are cut off here (the end of a loop pass); nothing may start at or after it. */
  until?: number;
}

export function takeToNotes(played: readonly Played[], time: TimeMap, opts: TakeOptions): Omit<PNote, "id">[] {
  const late = opts.latencyMs / 1000;
  const step = gridTicks(opts.grid);
  const raw = played
    .map((p) => {
      const on = Math.max(0, p.on - late);
      const off = Math.max(on, p.off - late);
      return { pitch: p.pitch, vel: p.velocity, tick: Math.round(time.tickAt(on)), end: Math.round(time.tickAt(off)) };
    })
    .filter((n) => opts.until === undefined || n.tick < opts.until);

  const filed = quantizeNotes(
    raw.map((n) => ({ ...n, offset: 0 })),
    { grid: opts.grid, keepOffset: true },
  );
  return filed
    .map((n, i) => {
      const lasted = raw[i].end - raw[i].tick;
      // Lengths are tidied to the grid too, and no note is shorter than one step.
      let dur = Math.max(step, Math.round(lasted / step) * step);
      let tick = n.tick;
      let offset = n.offset ?? 0;
      if (tick < 0) {
        // Played a hair before the song starts: it belongs on the first line.
        offset = Math.max(tick + offset, 0);
        tick = 0;
      }
      if (opts.until !== undefined) dur = Math.max(1, Math.min(dur, opts.until - tick));
      const note: Omit<PNote, "id"> = {
        pitch: n.pitch,
        tick,
        dur,
        vel: Math.round(Math.min(1, Math.max(0.05, n.vel)) * 100) / 100,
        origin: "played",
      };
      if (offset) note.offset = offset;
      return note;
    })
    .sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
}
