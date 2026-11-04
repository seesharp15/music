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

export function layoutKeyboard(low: number, high: number, width: number): KeyboardLayout {
  const whites: number[] = [];
  for (let p = low; p <= high; p++) if (!isBlack(p)) whites.push(p);
  const whiteW = width / whites.length;
  const blackW = whiteW * 0.62;
  const keys = new Map<number, KeyRect>();
  let wi = 0;
  for (let p = low; p <= high; p++) {
    if (isBlack(p)) {
      keys.set(p, { x: wi * whiteW - blackW / 2, w: blackW, black: true });
    } else {
      keys.set(p, { x: wi * whiteW, w: whiteW, black: false });
      wi++;
    }
  }
  return { low, high, keys };
}

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const noteName = (p: number) => `${NAMES[p % 12]}${Math.floor(p / 12) - 1}`;
