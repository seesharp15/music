/** Ranges of song time. Kept apart from the player so they can be tested without an audio context. */

export const MIN_LOOP = 0.25;

export interface LoopRange {
  enabled: boolean;
  start: number;
  end: number;
}

export interface TimeRange {
  start: number;
  end: number;
}

/**
 * The stretch that actually plays on repeat: the loop (or the whole song)
 * clipped to the visible window when the timeline is zoomed in. If the loop
 * is mostly out of view, what's visible wins.
 */
export function playRange(loop: LoopRange, visible: TimeRange | null, duration: number): TimeRange {
  const base = loop.enabled ? loop : { start: 0, end: duration };
  if (!visible) return { start: base.start, end: base.end };
  const start = Math.max(base.start, visible.start);
  const end = Math.min(base.end, visible.end);
  return end - start >= MIN_LOOP ? { start, end } : { start: visible.start, end: visible.end };
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}
