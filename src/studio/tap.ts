/**
 * Tap tempo: the tempo of the last few taps. A plain average of the gaps — whoever taps at 150
 * means 150, so (unlike `estimateTempo`, which reads a whole rhythm) nothing is halved or doubled.
 */

/** A gap longer than this starts a new count: the tapper stopped and began again. */
export const TAP_RESET_MS = 2000;
const MOST_TAPS = 8;
export const MIN_BPM = 30;
export const MAX_BPM = 300;

/** The taps still counting after a new one at `now`: the recent run, without long-ago ones. */
export function addTap(taps: readonly number[], now: number): number[] {
  const last = taps[taps.length - 1];
  const run = last !== undefined && now - last <= TAP_RESET_MS && now > last ? [...taps, now] : [now];
  return run.slice(-MOST_TAPS);
}

/** Beats a minute from a run of taps (milliseconds), or null until there are two. */
export function tappedBpm(taps: readonly number[]): number | null {
  if (taps.length < 2) return null;
  const gap = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
  if (!(gap > 0)) return null;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(60000 / gap)));
}
