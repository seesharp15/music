import { beatMapOf, type BeatMap } from "./beatmap";
import type { Hand, Song } from "./types";

/** A moment where at least one key goes down. */
export interface Moment {
  time: number;
  hands: Set<Hand>;
  pitches: Record<Hand, number[]>;
}

export interface Rhythm {
  /** Seconds per beat where the song starts. Under a tempo map beats vary: use the functions below. */
  beat: number;
  perBar: number;
  /** Grid cells per beat: 2 = eighths, 4 = sixteenths. */
  sub: number;
  /** Seconds per grid cell where the song starts. */
  cell: number;
  moments: Moment[];
  /** Where the beats fall. Null for a song played freely: there is no grid to count along to. */
  beats: BeatMap | null;
  /**
   * The beats are all one length and the first is at time 0. Then everything below is plain
   * arithmetic on `beat` and `cell` — the very expressions Practice used before it had a BeatMap, so
   * for such a song nothing it shows or plays has moved by so much as a rounding.
   */
  even: boolean;
}

const SAME_MOMENT = 0.03; // seconds

export function analyzeRhythm(song: Song): Rhythm {
  const beats = beatMapOf(song);
  const even = !beats || (!song.tempoMap?.length && !song.gridOffset);
  const beat = even ? 60 / (song.bpm ?? 120) : beats.secondsAt(1) - beats.secondsAt(0);
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
  const inEighths = (t: number) => (even ? t / eighth : beats.beatAt(t) * 2);
  const offGrid = moments.filter((m) => {
    const r = inEighths(m.time) - Math.round(inEighths(m.time));
    return Math.abs(r) > 0.25;
  }).length;
  const sub = offGrid > moments.length * 0.05 ? 4 : 2;
  return { beat, perBar, sub, cell: beat / sub, moments, beats, even };
}

/** Which grid cell a time falls in, counting from the first downbeat, as a fraction: 9.5 is half-way through cell 9. */
export function cellAt(r: Rhythm, t: number): number {
  return r.even || !r.beats ? t / r.cell : r.beats.beatAt(t) * r.sub;
}

/** When a grid cell starts, in seconds. */
export function cellTime(r: Rhythm, cell: number): number {
  return r.even || !r.beats ? cell * r.cell : r.beats.secondsAt(cell / r.sub);
}

/** Which bar a time falls in, counting from 0, as a fraction. */
export function barAt(r: Rhythm, t: number): number {
  return r.even || !r.beats ? t / (r.beat * r.perBar) : r.beats.beatAt(t) / r.perBar;
}

/** The bar a time falls in and `bars − 1` after it: where they start and end, in seconds. */
export function barsFrom(r: Rhythm, t: number, bars: number): { start: number; end: number } {
  if (r.even || !r.beats) {
    const barLen = r.beat * r.perBar;
    const start = Math.floor(t / barLen) * barLen;
    return { start, end: start + bars * barLen };
  }
  const first = Math.floor(barAt(r, t));
  return { start: r.beats.secondsAt(first * r.perBar), end: r.beats.secondsAt((first + bars) * r.perBar) };
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
  const cellIdx = Math.round(cellAt(r, t));
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
