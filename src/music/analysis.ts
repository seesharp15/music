/**
 * Read-only measurements of a line of notes, shared by the assistant, the coach and the importers:
 * phrases, contour, intervals, range, repeated motifs, rhythm per bar. They describe; none of them
 * grades.
 */
import { PPQ, type TimeMap } from "./time";

/** What these functions need of a note. A `PNote` fits. */
export interface LineNote {
  pitch: number;
  tick: number;
  dur: number;
}

/**
 * The top line of some notes: sorted by time, one note per onset (the highest). Most measurements
 * below are of a single line, so chords are reduced to their top note first.
 */
export function melodyLine<T extends LineNote>(notes: readonly T[]): T[] {
  const sorted = [...notes].sort((a, b) => a.tick - b.tick || b.pitch - a.pitch);
  return sorted.filter((n, i) => i === 0 || n.tick !== sorted[i - 1].tick);
}

// ── Phrases ──────────────────────────────────────────────────────────────────

export interface Phrase {
  /** Index of the first and last note in the line (inclusive). */
  first: number;
  last: number;
  start: number;
  end: number;
  /** What ended it. */
  endedBy: "rest" | "longNote" | "end";
}

/**
 * Where a line breathes. A phrase ends at a rest of at least `minRest` ticks (default a quarter
 * note), or after a note at least twice as long as the typical one and no shorter than `minLong`
 * (default a half note) — but never leaving a phrase of fewer than `minNotes` notes.
 */
export function phraseBoundaries(
  notes: readonly LineNote[],
  opts: { minRest?: number; minLong?: number; minNotes?: number } = {},
): Phrase[] {
  const line = melodyLine(notes);
  if (!line.length) return [];
  const minRest = opts.minRest ?? PPQ;
  const minLong = opts.minLong ?? PPQ * 2;
  const minNotes = opts.minNotes ?? 2;
  const durs = line.map((n) => n.dur).sort((a, b) => a - b);
  const typical = durs[Math.floor(durs.length / 2)];

  const phrases: Phrase[] = [];
  let first = 0;
  for (let i = 0; i < line.length; i++) {
    const n = line[i];
    const next = line[i + 1];
    let endedBy: Phrase["endedBy"] | null = null;
    if (!next) endedBy = "end";
    else if (next.tick - (n.tick + n.dur) >= minRest) endedBy = "rest";
    else if (n.dur >= minLong && n.dur >= typical * 2 && i - first + 1 >= minNotes) endedBy = "longNote";
    if (!endedBy) continue;
    phrases.push({ first, last: i, start: line[first].tick, end: n.tick + n.dur, endedBy });
    first = i + 1;
  }
  return phrases;
}

// ── Contour ──────────────────────────────────────────────────────────────────

export type Shape = "rise" | "fall" | "arch" | "valley" | "flat";

/**
 * The shape of a line: the direction of each move (1 up, -1 down, 0 repeated), and the overall
 * shape — which of rise, fall, arch, valley or flat fits best.
 */
export function contour(notes: readonly LineNote[]): { moves: (-1 | 0 | 1)[]; shape: Shape } {
  const line = melodyLine(notes);
  const moves = line.slice(1).map((n, i) => Math.sign(n.pitch - line[i].pitch) as -1 | 0 | 1);
  if (line.length < 2) return { moves, shape: "flat" };
  const pitches = line.map((n) => n.pitch);
  const first = pitches[0];
  const last = pitches[pitches.length - 1];
  const high = Math.max(...pitches);
  const low = Math.min(...pitches);
  if (high - low < 3) return { moves, shape: "flat" };
  const span = high - low;
  const inner = (i: number) => i > 0 && i < pitches.length - 1;
  // A peak or a trough well inside the line, standing clear of both ends, makes an arch or a valley.
  const peakInside = inner(pitches.indexOf(high)) && high - Math.max(first, last) >= span * 0.4;
  const troughInside = inner(pitches.indexOf(low)) && Math.min(first, last) - low >= span * 0.4;
  if (peakInside && !troughInside) return { moves, shape: "arch" };
  if (troughInside && !peakInside) return { moves, shape: "valley" };
  if (peakInside && troughInside) {
    return { moves, shape: high - Math.max(first, last) >= Math.min(first, last) - low ? "arch" : "valley" };
  }
  if (Math.abs(last - first) < span * 0.25) return { moves, shape: "flat" };
  return { moves, shape: last > first ? "rise" : "fall" };
}

// ── Intervals ────────────────────────────────────────────────────────────────

export interface IntervalStats {
  /** Signed semitones → how many times the line moves by it. */
  histogram: Record<number, number>;
  /** Shares of all moves: repeated notes, steps (1–2 semitones), skips (3–4), leaps (5 or more). */
  repeats: number;
  steps: number;
  skips: number;
  leaps: number;
  /** The widest move, in semitones (unsigned). */
  largest: number;
}

export function intervalHistogram(notes: readonly LineNote[]): IntervalStats {
  const line = melodyLine(notes);
  const histogram: Record<number, number> = {};
  const count = { repeats: 0, steps: 0, skips: 0, leaps: 0 };
  let largest = 0;
  for (let i = 1; i < line.length; i++) {
    const d = line[i].pitch - line[i - 1].pitch;
    histogram[d] = (histogram[d] ?? 0) + 1;
    const size = Math.abs(d);
    largest = Math.max(largest, size);
    count[size === 0 ? "repeats" : size <= 2 ? "steps" : size <= 4 ? "skips" : "leaps"]++;
  }
  const total = Math.max(1, line.length - 1);
  return {
    histogram,
    repeats: count.repeats / total,
    steps: count.steps / total,
    skips: count.skips / total,
    leaps: count.leaps / total,
    largest,
  };
}

// ── Range ────────────────────────────────────────────────────────────────────

export interface RangeStats {
  low: number;
  high: number;
  /** Where the line mostly sits: the pitches between which the middle 80% of its sounding time falls. */
  tessitura: [number, number];
  /** Duration-weighted mean pitch. */
  centre: number;
}

/** Null for no notes. All notes count, not only the top line. */
export function rangeOf(notes: readonly LineNote[]): RangeStats | null {
  if (!notes.length) return null;
  const sorted = [...notes].sort((a, b) => a.pitch - b.pitch);
  const total = sorted.reduce((s, n) => s + Math.max(n.dur, 1), 0);
  const at = (share: number) => {
    let acc = 0;
    for (const n of sorted) {
      acc += Math.max(n.dur, 1);
      if (acc >= total * share) return n.pitch;
    }
    return sorted[sorted.length - 1].pitch;
  };
  return {
    low: sorted[0].pitch,
    high: sorted[sorted.length - 1].pitch,
    tessitura: [at(0.1), at(0.9)],
    centre: sorted.reduce((s, n) => s + n.pitch * Math.max(n.dur, 1), 0) / total,
  };
}

// ── Motifs ───────────────────────────────────────────────────────────────────

export interface Motif {
  /** Notes in the motif. */
  length: number;
  /** Semitone moves between its notes. */
  intervals: number[];
  /** Ticks between its onsets. */
  rhythm: number[];
  /** Each place it appears: index of its first note in the line, and semitones above the first appearance. */
  occurrences: { index: number; tick: number; transpose: number }[];
}

/**
 * Repeated motifs: runs of notes whose intervals and rhythm recur, at any transposition. Found by
 * matching n-grams of (interval, time to the next onset). Longer motifs come first; a shorter one is
 * dropped when every appearance of it lies inside a longer one. Appearances do not overlap each other.
 */
export function findMotifs(
  notes: readonly LineNote[],
  opts: { minLength?: number; maxLength?: number; minOccurrences?: number } = {},
): Motif[] {
  const line = melodyLine(notes);
  const minLength = Math.max(2, opts.minLength ?? 3);
  const maxLength = Math.min(opts.maxLength ?? 8, line.length);
  const minOccurrences = opts.minOccurrences ?? 2;
  const found: Motif[] = [];
  const covered = (index: number, length: number) =>
    found.some((m) => m.occurrences.some((o) => index >= o.index && index + length <= o.index + m.length));

  for (let length = maxLength; length >= minLength; length--) {
    const groups = new Map<string, number[]>();
    for (let i = 0; i + length <= line.length; i++) {
      const parts: string[] = [];
      for (let k = 0; k < length - 1; k++) {
        parts.push(`${line[i + k + 1].pitch - line[i + k].pitch}:${line[i + k + 1].tick - line[i + k].tick}`);
      }
      const key = parts.join(",");
      const list = groups.get(key);
      if (list) list.push(i);
      else groups.set(key, [i]);
    }
    for (const starts of groups.values()) {
      // Drop overlapping appearances (a run of repeated notes matches itself one step along).
      const apart: number[] = [];
      for (const s of starts) if (!apart.length || s >= apart[apart.length - 1] + length) apart.push(s);
      if (apart.length < minOccurrences) continue;
      if (apart.every((s) => covered(s, length))) continue;
      const first = apart[0];
      found.push({
        length,
        intervals: Array.from({ length: length - 1 }, (_, k) => line[first + k + 1].pitch - line[first + k].pitch),
        rhythm: Array.from({ length: length - 1 }, (_, k) => line[first + k + 1].tick - line[first + k].tick),
        occurrences: apart.map((s) => ({ index: s, tick: line[s].tick, transpose: line[s].pitch - line[first].pitch })),
      });
    }
  }
  return found.sort((a, b) => b.length - a.length || b.occurrences.length - a.occurrences.length);
}

// ── Rhythm ───────────────────────────────────────────────────────────────────

/**
 * The onset pattern of each bar: one array per bar from the first bar with a note to the last, each
 * with `stepsPerBar` cells holding how many notes start in that cell (0 for none). A note is counted
 * in the nearest cell.
 */
export function onsetPattern(
  notes: readonly LineNote[],
  time: TimeMap,
  stepsPerBar = 16,
): { bar: number; steps: number[] }[] {
  if (!notes.length) return [];
  const bars = new Map<number, number[]>();
  for (const n of notes) {
    let bar = time.positionAt(n.tick).bar;
    const start = time.tickOfBar(bar);
    const perBar = time.ticksPerBarAt(n.tick);
    let step = Math.round(((n.tick - start) / perBar) * stepsPerBar);
    if (step >= stepsPerBar) {
      step = 0;
      bar++;
    }
    const steps = bars.get(bar) ?? new Array<number>(stepsPerBar).fill(0);
    steps[step]++;
    bars.set(bar, steps);
  }
  const numbers = [...bars.keys()];
  const out: { bar: number; steps: number[] }[] = [];
  for (let bar = Math.min(...numbers); bar <= Math.max(...numbers); bar++) {
    out.push({ bar, steps: bars.get(bar) ?? new Array<number>(stepsPerBar).fill(0) });
  }
  return out;
}
