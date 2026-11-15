/**
 * Musical time. Projects count in ticks; songs count in seconds; a TimeMap converts.
 * See docs/plan/contracts.md §1. Implementations arrive in Stage 2.
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
}
