import type { Hand, Song } from "./types";

/** A moment where at least one key goes down. */
export interface Moment {
  time: number;
  hands: Set<Hand>;
  pitches: Record<Hand, number[]>;
}

export interface Rhythm {
  beat: number; // seconds per beat
  perBar: number;
  /** Grid cells per beat: 2 = eighths, 4 = sixteenths. */
  sub: number;
  cell: number; // seconds per grid cell
  moments: Moment[];
}

const SAME_MOMENT = 0.03; // seconds

export function analyzeRhythm(song: Song): Rhythm {
  const beat = 60 / (song.bpm ?? 120);
  const perBar = song.timeSignature?.[0] ?? 4;

  const moments: Moment[] = [];
  for (const n of song.notes) {
    let m = moments[moments.length - 1];
    if (!m || n.time - m.time > SAME_MOMENT) {
      m = { time: n.time, hands: new Set(), pitches: { L: [], R: [] } };
      moments.push(m);
    }
    m.hands.add(n.hand);
    m.pitches[n.hand].push(n.pitch);
  }

  // Use sixteenths only if a meaningful share of onsets fall between eighths.
  const eighth = beat / 2;
  const offGrid = moments.filter((m) => {
    const r = m.time / eighth - Math.round(m.time / eighth);
    return Math.abs(r) > 0.25;
  }).length;
  const sub = offGrid > moments.length * 0.05 ? 4 : 2;
  return { beat, perBar, sub, cell: beat / sub, moments };
}

/** Index of the last moment at or before t (or -1). */
export function momentIndexAt(moments: Moment[], t: number): number {
  let lo = 0;
  let hi = moments.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (moments[mid].time <= t + 1e-6) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

const COUNT_8 = ["", "&"];
const COUNT_16 = ["", "e", "&", "a"];

/** Musical position of a time, e.g. { bar: 12, label: "2&" }. */
export function positionOf(r: Rhythm, t: number): { bar: number; beatInBar: number; label: string } {
  const cellIdx = Math.round(t / r.cell);
  const cellsPerBar = r.perBar * r.sub;
  const bar = Math.floor(cellIdx / cellsPerBar) + 1;
  const inBar = ((cellIdx % cellsPerBar) + cellsPerBar) % cellsPerBar;
  const beatInBar = Math.floor(inBar / r.sub) + 1;
  const subName = (r.sub === 2 ? COUNT_8 : COUNT_16)[inBar % r.sub];
  return { bar, beatInBar, label: `${beatInBar}${subName}` };
}

export function countLabel(r: Rhythm, cellInBar: number): string {
  const beatNum = Math.floor(cellInBar / r.sub) + 1;
  const s = cellInBar % r.sub;
  return s === 0 ? String(beatNum) : (r.sub === 2 ? COUNT_8 : COUNT_16)[s];
}
