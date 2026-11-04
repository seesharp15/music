const BLACK = new Set([1, 3, 6, 8, 10]);

export const isBlack = (pitch: number) => BLACK.has(pitch % 12);

export interface KeyRect {
  x: number;
  w: number;
  black: boolean;
}

export interface KeyboardLayout {
  low: number;
  high: number;
  keys: Map<number, KeyRect>;
}

/** Picks a key range that covers the song, padded and aligned to C…B. */
export function keyRangeFor(pitches: number[]): [number, number] {
  if (pitches.length === 0) return [48, 83];
  let low = Math.min(...pitches) - 2;
  let high = Math.max(...pitches) + 2;
  low = Math.max(21, low - (low % 12)); // down to a C
  high = Math.min(108, high + (11 - (high % 12))); // up to a B
  while (high - low < 35) {
    if (low > 21) low = Math.max(21, low - 12);
    if (high < 108 && high - low < 35) high = Math.min(108, high + 12);
    if (low === 21 && high === 108) break;
  }
  return [low, high];
}

export const LOWEST_KEY = 21; // A0
export const HIGHEST_KEY = 108; // C8
export const TOTAL_WHITES = 52;
const BLACK_W = 0.62; // black key width, in white keys

/** White keys from A0 up to (not including) each pitch. */
const WHITES_BELOW: number[] = [];
for (let p = LOWEST_KEY, w = 0; p <= HIGHEST_KEY; p++) {
  WHITES_BELOW[p] = w;
  if (!isBlack(p)) w++;
}

/** Where a key sits in white-key units: A0 starts at 0, C8 ends at 52. */
export function keySpan(p: number): [number, number] {
  const w = WHITES_BELOW[Math.min(HIGHEST_KEY, Math.max(LOWEST_KEY, p))];
  return isBlack(p) ? [w - BLACK_W / 2, w + BLACK_W / 2] : [w, w + 1];
}

/**
 * Lay out the keys between white-key positions `lo`..`hi` (fractions allowed,
 * so the view can zoom smoothly) across `width` pixels.
 */
export function layoutKeyboard(lo: number, hi: number, width: number): KeyboardLayout & { whiteW: number } {
  const whiteW = width / (hi - lo);
  const keys = new Map<number, KeyRect>();
  for (let p = LOWEST_KEY; p <= HIGHEST_KEY; p++) {
    const [a, b] = keySpan(p);
    if (b < lo || a > hi) continue;
    keys.set(p, { x: (a - lo) * whiteW, w: (b - a) * whiteW, black: isBlack(p) });
  }
  return { low: Math.ceil(lo), high: Math.floor(hi), keys, whiteW };
}

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const noteName = (p: number) => `${NAMES[p % 12]}${Math.floor(p / 12) - 1}`;
