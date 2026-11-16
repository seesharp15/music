/**
 * Tempo, meter and swing from a list of onset times: taps, hummed notes, or notes from a recording.
 * See docs/plan/contracts.md §8.
 */

export interface Onset {
  time: number;
  weight?: number;
}

export interface TempoEstimate {
  /** Quarter notes a minute. */
  bpm: number;
  meter: [number, number];
  /** Share of each beat taken by its first half: 0.5 straight, 0.667 triplet swing. */
  swing: number;
  /** 0..1: how well the onsets sit on the grid that was found. */
  confidence: number;
  /** The same rhythm read at half and at double speed, for a one-tap correction. */
  alternatives: number[];
}

const MIN_BPM = 40;
const MAX_BPM = 240;
/** When two readings an octave apart fit equally, the one in here wins. */
const PREFERRED: [number, number] = [70, 140];
const SAME_ONSET = 0.03; // seconds: onsets closer than this are one event
const BIN = 0.002; // seconds per autocorrelation bin
const SMOOTH = 0.012; // seconds: how forgiving the autocorrelation is of loose timing
const MAX_LAG = 6.5; // seconds

const round2 = (x: number) => Math.round(x * 100) / 100;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** 1 inside the preferred range, falling away gently outside it. */
function prior(bpm: number): number {
  const octavesOut =
    bpm < PREFERRED[0] ? Math.log2(PREFERRED[0] / bpm) : bpm > PREFERRED[1] ? Math.log2(bpm / PREFERRED[1]) : 0;
  return 1 / (1 + 0.6 * octavesOut);
}

function foldIntoRange(bpm: number): number {
  while (bpm < PREFERRED[0]) bpm *= 2;
  while (bpm > PREFERRED[1]) bpm /= 2;
  return bpm;
}

interface Event {
  time: number;
  weight: number;
}

/** Onsets in time order, with those that fall together (a chord) made one heavier event. */
function gather(onsets: readonly Onset[]): Event[] {
  const sorted = onsets.filter((o) => Number.isFinite(o.time)).sort((a, b) => a.time - b.time);
  const events: Event[] = [];
  for (const o of sorted) {
    const last = events[events.length - 1];
    if (last && o.time - last.time <= SAME_ONSET) last.weight += o.weight ?? 1;
    else events.push({ time: o.time, weight: o.weight ?? 1 });
  }
  return events;
}

/** How often two onsets are a given time apart, smoothed; `at(lag)` reads it. */
function autocorrelation(events: Event[], span: number) {
  const size = Math.ceil(Math.min(MAX_LAG, span) / BIN) + 2;
  const raw = new Float64Array(size);
  for (let i = 0; i < events.length; i++) {
    const wi = Math.sqrt(events[i].weight);
    for (let j = i + 1; j < events.length; j++) {
      const bin = Math.round((events[j].time - events[i].time) / BIN);
      if (bin >= size) break;
      raw[bin] += wi * Math.sqrt(events[j].weight);
    }
  }
  const reach = Math.ceil((SMOOTH * 3) / BIN);
  const kernel = Array.from({ length: 2 * reach + 1 }, (_, k) => Math.exp(-0.5 * (((k - reach) * BIN) / SMOOTH) ** 2));
  const smooth = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    if (!raw[i]) continue;
    for (let k = -reach; k <= reach; k++) {
      const at = i + k;
      if (at >= 0 && at < size) smooth[at] += raw[i] * kernel[k + reach];
    }
  }
  return (lag: number): number => {
    const x = lag / BIN;
    const i = Math.floor(x);
    if (i < 0 || i + 1 >= size) return 0;
    // Longer lags have fewer pairs to offer in a short take; even that out.
    return (smooth[i] + (smooth[i + 1] - smooth[i]) * (x - i)) / Math.max(span - lag, span * 0.25);
  };
}

/** The phase (seconds, 0..period) that puts most onsets on a beat. */
function bestPhase(events: Event[], period: number): number {
  const sigma = period / 16;
  const stride = Math.max(1, Math.floor(events.length / 160));
  let best = 0;
  let bestScore = -1;
  for (let c = 0; c < events.length; c += stride) {
    const phase = events[c].time % period;
    let score = 0;
    for (const e of events) {
      const r = (e.time - phase) / period;
      const d = (r - Math.round(r)) * period;
      score += e.weight * Math.exp(-0.5 * (d / sigma) ** 2);
    }
    if (score > bestScore) {
      bestScore = score;
      best = phase;
    }
  }
  return best;
}

/** Least-squares line through the onsets that sit on beats: a sharper period and phase. */
function refine(events: Event[], period: number, phase: number): { period: number; phase: number } {
  for (let pass = 0; pass < 3; pass++) {
    let n = 0;
    let sk = 0;
    let st = 0;
    let skk = 0;
    let skt = 0;
    for (const e of events) {
      const k = Math.round((e.time - phase) / period);
      if (Math.abs(e.time - phase - k * period) > period / 6) continue;
      n++;
      sk += k;
      st += e.time;
      skk += k * k;
      skt += k * e.time;
    }
    const spread = n * skk - sk * sk;
    if (n < 3 || spread === 0) break;
    const slope = (n * skt - sk * st) / spread;
    if (!(slope > 0) || Math.abs(slope - period) > period * 0.08) break;
    phase = (st - slope * sk) / n;
    period = slope;
  }
  return { period, phase };
}

/** How strongly a sequence repeats every `lag` steps (mean removed). */
function repeatStrength(values: number[], lag: number): number {
  if (values.length < lag * 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  let sum = 0;
  let energy = 0;
  for (let i = 0; i < values.length; i++) {
    energy += (values[i] - mean) ** 2;
    if (i + lag < values.length) sum += (values[i] - mean) * (values[i + lag] - mean);
  }
  return energy > 1e-9 ? sum / energy : 0;
}

export function estimateTempo(onsets: readonly Onset[]): TempoEstimate {
  const events = gather(onsets);
  const fallback = (bpm: number, confidence: number): TempoEstimate => ({
    bpm: round2(bpm),
    meter: [4, 4],
    swing: 0.5,
    confidence,
    alternatives: [round2(bpm / 2), round2(bpm * 2)],
  });
  if (events.length < 2) return fallback(120, 0);
  const span = events[events.length - 1].time - events[0].time;
  if (events.length < 4) {
    // Too few to correlate: the taps are taken as beats.
    return fallback(foldIntoRange(clamp(60 / (span / (events.length - 1)), MIN_BPM / 4, MAX_BPM * 4)), 0.2);
  }

  // 1. The beat: the period, and its multiples, at which onsets most often recur.
  const ac = autocorrelation(events, span);
  let period = 0.5;
  let bestScore = -1;
  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += 0.25) {
    const p = 60 / bpm;
    let sum = 0;
    let n = 0;
    for (let k = 1; k <= 4; k++) {
      if (k > 1 && k * p > Math.min(MAX_LAG, span * 0.75)) break;
      sum += ac(k * p);
      n++;
    }
    const score = (sum / n) * prior(bpm);
    if (score > bestScore) {
      bestScore = score;
      period = p;
    }
  }
  let phase = bestPhase(events, period);
  ({ period, phase } = refine(events, period, phase));

  // 2. Where onsets fall inside the beat.
  const total = events.reduce((s, e) => s + e.weight, 0);
  const fracs = events.map((e) => {
    const r = (e.time - phase) / period;
    return { frac: r - Math.floor(r), beat: Math.round(r), weight: e.weight };
  });
  const near = (x: number, width = 0.07) =>
    fracs.reduce((s, f) => s + (Math.abs(f.frac - x) <= width ? f.weight : 0), 0) / total;
  const third = near(1 / 3);
  const twoThirds = near(2 / 3);
  const half = near(0.5);
  // Both inner thirds in use and the half-way point empty: the beat divides in three (6/8, 12/8).
  const compound = third > 0.08 && twoThirds > 0.08 && half < 0.05;

  // 3. Swing: where the off-beat notes sit, when they are not on the half-way point.
  let swing = 0.5;
  if (!compound) {
    const off = fracs.filter((f) => f.frac > 0.4 && f.frac < 0.8).sort((a, b) => a.frac - b.frac);
    const offWeight = off.reduce((s, f) => s + f.weight, 0);
    if (off.length >= 3 && offWeight / total >= 0.1) {
      let acc = 0;
      let median = 0.5;
      for (const f of off) {
        acc += f.weight;
        if (acc >= offWeight / 2) {
          median = f.frac;
          break;
        }
      }
      swing = clamp(Math.round(median * 1000) / 1000, 0.5, 0.75);
      if (Math.abs(swing - 0.5) < 0.03) swing = 0.5;
    }
  }

  // 4. Meter: how many beats pass before the pattern of accents comes round again.
  const firstBeat = Math.min(...fracs.map((f) => f.beat));
  const accents: number[] = [];
  for (const f of fracs) {
    const onBeat = Math.min(f.frac, 1 - f.frac) < 1 / 6;
    if (onBeat) accents[f.beat - firstBeat] = (accents[f.beat - firstBeat] ?? 0) + f.weight;
  }
  for (let i = 0; i < accents.length; i++) accents[i] ??= 0;
  const two = repeatStrength(accents, 2);
  const three = repeatStrength(accents, 3);
  const four = repeatStrength(accents, 4);
  const triple = three > 0.15 && three > four + 0.05 && three > two + 0.05;

  let bpm = 60 / period;
  let meter: [number, number] = triple ? [3, 4] : [4, 4];
  if (compound) {
    // The beat found is a dotted quarter; tempo is counted in quarters.
    bpm *= 1.5;
    meter = triple ? [9, 8] : four > two + 0.05 && four > 0.15 ? [12, 8] : [6, 8];
  }

  // 5. Confidence: how tightly the onsets cluster on halves, thirds or quarters of the beat.
  const cluster = (divisions: number) => {
    let re = 0;
    let im = 0;
    for (const f of fracs) {
      re += f.weight * Math.cos(2 * Math.PI * divisions * f.frac);
      im += f.weight * Math.sin(2 * Math.PI * divisions * f.frac);
    }
    return Math.hypot(re, im) / total;
  };
  const confidence = clamp(Math.max(cluster(2), cluster(3), cluster(4)) * Math.min(1, events.length / 6), 0, 1);

  return {
    bpm: round2(bpm),
    meter,
    swing,
    confidence: Math.round(confidence * 1000) / 1000,
    alternatives: [round2(bpm / 2), round2(bpm * 2)],
  };
}
