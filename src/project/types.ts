/**
 * The project format — what Studio edits. Musical time, several tracks, a chord track, and a record
 * of where every note came from. A project is the source; a song is compiled from it.
 * See docs/plan/contracts.md §3 and §5. Implementations arrive in Stage 2.
 */

import type { Idea } from "../assist/core/types";
import type { MeterEvent, TempoEvent } from "../music/time";
import type { DrumPadId, Hand, SoundId, TrackRole } from "../song/types";

export type Origin = "manual" | "played" | "tapped" | "hummed" | "imported" | "suggested";

export interface PNote {
  id: number; // unique within the project, from Project.seq
  pitch: number; // MIDI 21..108
  tick: number; // quantized start
  dur: number; // ticks, > 0
  vel: number; // 0..1
  /** Signed ticks added at compile time: the feel of a played, hummed or imported note. Default 0. */
  offset?: number;
  /** Overrides the track's hand for this note. */
  hand?: Hand;
  origin: Origin;
  /** Set the first time the author changes a note that came from anywhere but their own hands. */
  edited?: boolean;
  /** Suggestion this note was accepted from; see SuggestionRecord. */
  sid?: string;
  /** 0..1 confidence from transcription (hummed, imported). Absent = certain. */
  conf?: number;
}

export interface NoteTrack {
  kind: "notes";
  id: string;
  name: string;
  role: TrackRole;
  hand: Hand; // default hand for practice: melody R, everything else L
  sound: SoundId;
  volume: number; // 0..1
  muted: boolean;
  locked: boolean; // assist never proposes edits to a locked track
  /** Share of each note's `offset` applied at compile: 1 = as played, 0 = exactly on the grid. */
  feel: number;
  notes: PNote[];
}

export interface DrumPattern {
  id: string;
  name: string;
  /** Columns per bar, any even division of it: 16 or 32 in 4/4; 12 in 3/4, in 6/8, or for a triplet feel. */
  stepsPerBar: number;
  bars: 1 | 2 | 4;
  /** Per pad, one velocity per step (0 = silent). */
  lanes: Partial<Record<DrumPadId, number[]>>;
}

export interface DrumTrack {
  kind: "drums";
  id: string;
  name: string;
  kit: string;
  volume: number;
  muted: boolean;
  locked: boolean;
  /** As on NoteTrack. The pads' Tighten slider is 1 − feel. */
  feel: number;
  patterns: DrumPattern[];
  /** Patterns placed on the timeline. */
  clips: { id: number; patternId: string; tick: number; repeats: number }[];
  /** Free hits recorded from the pads, outside any pattern. */
  hits: { id: number; pad: DrumPadId; tick: number; vel: number; offset?: number; origin: Origin }[];
}

export type Track = NoteTrack | DrumTrack;

export interface ChordEvent {
  id: number;
  tick: number;
  dur: number;
  /** Canonical chord symbol parsed by the theory kernel, e.g. "Am7", "F/A", "G7b9". */
  symbol: string;
  origin: Origin;
  edited?: boolean;
  sid?: string;
  conf?: number;
}

export interface PSection {
  id: string;
  name: string;
  tick: number;
  dur: number;
  color?: string;
  /** Review mode (Stage 8): the author has checked this section against the recording. */
  checked?: boolean;
}

/** Timing feel extracted from a drum performance and applied when other tracks are quantized. */
export interface Groove {
  unit: 8 | 16;
  /** Signed tick offset per step across one bar. */
  offsets: number[];
  /** Velocity multiplier per step. */
  accents: number[];
}

/** What the author says the song is. Written by the author; the assistant may only propose additions. */
export interface Brief {
  mood?: string;
  genre?: string;
  references?: string[]; // "like the chorus of …"
  notes?: string; // free text: theme, lyric idea, do and don't
}

export interface Project {
  format: "piano-project/v1";
  id: string;
  title: string;
  author?: string;
  createdAt: string;
  updatedAt: string;
  seq: number; // next note / chord / clip id
  lengthTicks: number;
  tempo: TempoEvent[]; // at least one, at tick 0
  meter: MeterEvent[]; // at least one, at tick 0
  key: { tick: number; tonic: string; mode: "major" | "minor" | "dorian" | "mixolydian" | "lydian" | "phrygian" }[];
  /** Share of each beat pair taken by the first note: 0.5 straight, 0.667 triplet swing. */
  swing: { amount: number; unit: 8 | 16 };
  groove?: Groove;
  /** Widest stretch, in semitones, that a writer may ask of one hand. Default 14 (a ninth). */
  handSpan: number;
  sections: PSection[];
  chords: ChordEvent[];
  tracks: Track[];
  brief?: Brief;
  /** Parked alternatives: options kept for later, hummed takes, tapped rhythms. */
  ideas: Idea[];
  /** A tapped or hummed rhythm waiting for pitches: drawn as outlines, never compiled. */
  pending?: { trackId: string; slots: { tick: number; dur: number; vel: number }[] };
  /** Present on imported projects. */
  source?: {
    kind: "audio" | "youtube" | "midi" | "song";
    ref?: string; // URL, or id of the reference audio blob
    engines?: Record<string, string>; // model name → version and licence class
    importedAt: string;
    /** The bar grid was estimated, not known: a free-time song, or a quick import. */
    gridGuessed?: boolean;
    /** How full an arrangement was asked for. */
    level?: "lead" | "easy" | "intermediate" | "full";
    /** Id of the stored `AnalyzeResult`, kept so the level can be changed without another job. */
    analysisBlobId?: string;
    warnings?: { tick?: number; text: string }[];
  };
}

// ── Edit operations and the store (contracts §5) ─────────────────────────────

export type EditOp =
  | { op: "addNotes"; trackId: string; notes: Omit<PNote, "id">[] }
  | { op: "removeNotes"; trackId: string; ids: number[] }
  | { op: "patchNotes"; trackId: string; ids: number[]; patch: Partial<Omit<PNote, "id">> }
  | { op: "shiftNotes"; trackId: string; ids: number[]; ticks: number; semitones: number }
  | { op: "setChords"; range: { start: number; end: number }; chords: Omit<ChordEvent, "id">[] }
  | { op: "addHits"; trackId: string; hits: Omit<DrumTrack["hits"][number], "id">[] }
  | { op: "removeHits"; trackId: string; ids: number[] }
  | { op: "patchHits"; trackId: string; ids: number[]; patch: Partial<Omit<DrumTrack["hits"][number], "id">> }
  | { op: "putPattern"; trackId: string; pattern: DrumPattern } // adds, or replaces the pattern with that id
  | { op: "removePattern"; trackId: string; patternId: string } // and its clips
  | { op: "placeClip"; trackId: string; patternId: string; tick: number; repeats: number }
  | { op: "removeClip"; trackId: string; id: number }
  | { op: "addTrack"; track: Track; index?: number }
  | { op: "removeTrack"; trackId: string }
  | {
      op: "patchTrack";
      trackId: string;
      patch: Partial<
        Pick<NoteTrack, "name" | "role" | "hand" | "sound" | "volume" | "muted" | "locked" | "feel"> &
          Pick<DrumTrack, "kit">
      >;
    }
  | { op: "setSections"; sections: PSection[] }
  /** Range operations act on every track, plus chords, clips and sections. */
  | { op: "insertTime"; tick: number; dur: number } // opens a gap; later material moves later
  | { op: "deleteTime"; tick: number; dur: number } // removes the range; later material moves earlier
  /** Opens a gap as long as the range at `to`, then fills it with a copy. Never overwrites. */
  | { op: "copyRange"; from: { start: number; end: number }; to: number }
  | {
      op: "patchSong";
      patch: Partial<
        Pick<
          Project,
          "title" | "author" | "tempo" | "meter" | "key" | "swing" | "groove" | "handSpan" | "lengthTicks" | "brief"
        >
      >;
    }
  | { op: "putIdea"; idea: Idea }
  | { op: "removeIdea"; id: string }
  | { op: "setPending"; pending: Project["pending"] };

export interface ProjectStore {
  getState(): { project: Project; canUndo: boolean; canRedo: boolean; dirty: boolean };
  subscribe(fn: () => void): () => void;
  /** Applies ops atomically as one undo step. `label` appears in the undo menu. */
  apply(ops: EditOp[], label: string): void;
  undo(): void;
  redo(): void;
  /** A copy with `ops` applied, without touching the store: how options are auditioned. */
  preview(ops: EditOp[]): Project;
}
