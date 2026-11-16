/**
 * Musical time. Projects count in ticks; songs count in seconds; a TimeMap converts.
 * See docs/plan/contracts.md §1.
 */

export const PPQ = 480;

export interface TempoEvent {
  tick: number;
  bpm: number;
}
export interface MeterEvent {
  tick: number;
  numerator: number;
  denominator: 2 | 4 | 8 | 16;
}

/** Converts between the two clocks. Built from a project's tempo and meter events. */
export interface TimeMap {
  secondsAt(tick: number): number;
  tickAt(seconds: number): number;
  /** Bar is 1-based; beat is 1-based within the bar; tick is the remainder inside the beat. */
  positionAt(tick: number): { bar: number; beat: number; tick: number };
  tickOfBar(bar: number): number;
  ticksPerBarAt(tick: number): number;
  /** The meter in force at a tick. */
  meterAt(tick: number): MeterEvent;
  /** The tempo in force at a tick, in quarter notes a minute. */
  bpmAt(tick: number): number;
}

export const DEFAULT_BPM = 120;
const DEFAULT_METER: MeterEvent = { tick: 0, numerator: 4, denominator: 4 };

/** Ticks in one beat of a meter: the note its denominator names. */
export const ticksPerBeat = (m: Pick<MeterEvent, "denominator">) => (PPQ * 4) / m.denominator;
/** Ticks in one bar of a meter. */
export const ticksPerBar = (m: Pick<MeterEvent, "numerator" | "denominator">) => m.numerator * ticksPerBeat(m);

/** A tick this close to a whole number is that whole number: what makes the round trip exact. */
const SNAP = 1e-6;

/** Index of the last entry whose `key` is at or before `x`; 0 when `x` is before them all. */
function segmentAt<T>(list: T[], key: (item: T) => number, x: number): number {
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (key(list[mid]) <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Events in tick order, the first pulled back to tick 0, later events at the same tick winning. */
function tidy<T extends { tick: number }>(events: readonly T[], fallback: T): T[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick);
  if (!sorted.length) return [fallback];
  const out: T[] = [];
  for (const e of sorted) {
    if (out.length && out[out.length - 1].tick === e.tick) out[out.length - 1] = e;
    else out.push(e);
  }
  if (out[0].tick !== 0) out[0] = { ...out[0], tick: 0 };
  return out;
}

/**
 * Tempo is piecewise constant, so tick ⇄ seconds is piecewise linear. Meter changes start a new bar
 * where they fall (they belong on bar lines; one that does not cuts its bar short).
 * `tickAt(secondsAt(t)) === t` for every integer tick.
 */
export function makeTimeMap(tempo: readonly TempoEvent[], meter: readonly MeterEvent[]): TimeMap {
  const tempos = tidy(tempo, { tick: 0, bpm: DEFAULT_BPM }).map((e) => ({
    tick: e.tick,
    bpm: e.bpm,
    seconds: 0,
    secondsPerTick: 60 / (e.bpm * PPQ),
  }));
  for (let i = 1; i < tempos.length; i++) {
    const prev = tempos[i - 1];
    tempos[i].seconds = prev.seconds + (tempos[i].tick - prev.tick) * prev.secondsPerTick;
  }

  const meters = tidy(meter, DEFAULT_METER).map((e) => ({ event: e, tick: e.tick, bar: 1, perBar: ticksPerBar(e) }));
  for (let i = 1; i < meters.length; i++) {
    const prev = meters[i - 1];
    meters[i].bar = prev.bar + Math.ceil((meters[i].tick - prev.tick) / prev.perBar);
  }

  const meterSeg = (tick: number) => meters[segmentAt(meters, (m) => m.tick, tick)];

  return {
    secondsAt(tick) {
      const s = tempos[segmentAt(tempos, (t) => t.tick, tick)];
      return s.seconds + (tick - s.tick) * s.secondsPerTick;
    },
    tickAt(seconds) {
      const s = tempos[segmentAt(tempos, (t) => t.seconds, seconds)];
      const raw = s.tick + (seconds - s.seconds) / s.secondsPerTick;
      const whole = Math.round(raw);
      return Math.abs(raw - whole) < SNAP ? whole : raw;
    },
    positionAt(tick) {
      const m = meterSeg(tick);
      const perBeat = ticksPerBeat(m.event);
      const barsIn = Math.floor((tick - m.tick) / m.perBar);
      const inBar = tick - m.tick - barsIn * m.perBar;
      const beat = Math.floor(inBar / perBeat);
      return { bar: m.bar + barsIn, beat: beat + 1, tick: inBar - beat * perBeat };
    },
    tickOfBar(bar) {
      const m = meters[segmentAt(meters, (x) => x.bar, bar)];
      return m.tick + (bar - m.bar) * m.perBar;
    },
    ticksPerBarAt: (tick) => meterSeg(tick).perBar,
    meterAt: (tick) => meterSeg(tick).event,
    bpmAt: (tick) => tempos[segmentAt(tempos, (t) => t.tick, tick)].bpm,
  };
}
