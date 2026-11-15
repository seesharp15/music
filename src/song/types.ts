/**
 * The song format — what Practice plays and what the song bank stores.
 * `piano-song/v2` is v1 plus optional fields: every v1 file is still valid.
 * See docs/song-format.md and docs/plan/contracts.md §2.
 */

/** The instrument sounds. More may be added for non-piano tracks. */
export type SoundId = "clear" | "soft" | "epiano" | "bright" | "piano";

export type Hand = "L" | "R";
export type TrackRole = "melody" | "chords" | "bass" | "counter" | "free";
export type DrumPadId =
  | "kick"
  | "snare"
  | "rim"
  | "clap"
  | "hat"
  | "hatOpen"
  | "hatPedal"
  | "tomLow"
  | "tomMid"
  | "tomHigh"
  | "crash"
  | "ride"
  | "shaker"
  | "tamb"
  | "cowbell"
  | "perc";

export interface Note {
  pitch: number; // MIDI 21..108
  time: number; // seconds
  duration: number; // seconds
  hand: Hand;
  velocity?: number; // 0..1, default 0.7
  track?: string; // v2: id of an entry in Song.tracks; absent on bank songs
}

export interface Section {
  name: string;
  start: number;
  end: number;
} // seconds; unchanged from v1

export interface Song {
  format: "piano-song/v1" | "piano-song/v2";
  id: string;
  title: string;
  artist?: string;
  arranger?: string;
  source?: string;
  bpm?: number; // nominal tempo; absent = free time, no beat grid
  timeSignature?: [number, number];
  duration?: number;
  sections?: Section[];
  notes: Note[];

  // ── v2, all optional ───────────────────────────────────────────────
  key?: string; // tonal key name, e.g. "A minor"
  /** Seconds of the first downbeat (pickup bars, leading silence). Default 0. */
  gridOffset?: number;
  /** Present only when tempo changes; `bpm` stays the nominal value shown in the UI. */
  tempoMap?: { time: number; bpm: number }[];
  tracks?: { id: string; name: string; role: TrackRole; sound?: SoundId }[];
  chords?: { time: number; duration: number; symbol: string }[];
  drums?: { kit: string; hits: { pad: DrumPadId; time: number; velocity?: number }[] };
  /** Sustain pedal as written or transcribed. Stage 1's toggle ignores this; Stage 9 plays it. */
  pedal?: { time: number; down: boolean }[];
  origin?: { kind: "bank" | "studio" | "import"; projectId?: string; createdAt?: string };
}

export interface SongIndexEntry {
  id: string;
  title: string;
  artist?: string;
  file: string;
  // hand-authored
  genre?: Genre;
  tags?: string[];
  difficulty?: 1 | 2 | 3 | 4 | 5;
  addedAt?: string; // ISO date
  // derived by `npm run songs:index`, never edited by hand
  duration?: number;
  bpm?: number;
  key?: string;
  noteCount?: number;
  range?: [number, number]; // lowest and highest pitch
  preview?: number[]; // 48 values 0..1: note density over time, for the card thumbnail
}

export type Genre =
  "pop" | "film-tv" | "classical" | "neoclassical" | "jazz" | "rock" | "folk" | "game" | "holiday" | "original";
