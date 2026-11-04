/**
 * Song format v1 — the standard input format for every tutorial.
 * See docs/song-format.md for the full spec.
 */

export type Hand = "L" | "R";

export interface Note {
  /** MIDI pitch number (21 = A0, 60 = middle C, 108 = C8). */
  pitch: number;
  /** Start time in seconds from the beginning of the song. */
  time: number;
  /** Length in seconds. */
  duration: number;
  /** Which hand plays the note. */
  hand: Hand;
  /** Loudness 0..1. Defaults to 0.7. */
  velocity?: number;
}

export interface Section {
  name: string;
  /** Seconds. */
  start: number;
  /** Seconds. */
  end: number;
}

export interface Song {
  format: "piano-song/v1";
  id: string;
  title: string;
  artist?: string;
  arranger?: string;
  /** Where the arrangement comes from (e.g. a video URL). */
  source?: string;
  /** Nominal tempo, used for display and beat grid. */
  bpm?: number;
  timeSignature?: [number, number];
  /** Total length in seconds. Defaults to the end of the last note. */
  duration?: number;
  sections?: Section[];
  notes: Note[];
}

export interface SongIndexEntry {
  id: string;
  title: string;
  artist?: string;
  file: string;
}
