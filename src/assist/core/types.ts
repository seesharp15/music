/**
 * Everything the assistant offers is an Option: a labelled, explained set of edit operations the
 * author can hear, take, take part of, park, evolve or dismiss.
 * See docs/plan/contracts.md §7. Implementations arrive in Stage 5.
 */

import type { EditOp, Project } from "../../project/types";

export type AssistKind =
  | "melody.continue"
  | "melody.vary"
  | "melody.answer"
  | "melody.fill"
  | "melody.fromRhythm"
  | "melody.fromContour"
  | "melody.fromChords"
  | "melody.fromText"
  | "harmony.harmonize"
  | "harmony.reharmonize"
  | "harmony.substitute"
  | "bass.line"
  | "accompaniment.pattern"
  | "drums.pattern"
  | "drums.fill";

export interface Controls {
  /** 0 = safest, most expected; 1 = boldest. */
  surprise: number;
  /** 0 = sparse, 1 = busy. */
  density: number;
  contour?: "rise" | "fall" | "arch" | "valley" | "flat";
  range?: [number, number];
  /** Keep the rhythm of the selection and change only pitches, or the reverse. */
  keep?: "rhythm" | "pitches";
  flavor?: "simple" | "pop" | "soulful" | "moody" | "bright" | "classical";
  /** Chords per bar for harmony requests. */
  harmonicRhythm?: 1 | 2 | 4;
  style?: string; // bass or accompaniment style id
  text?: string; // the author's words, for *.fromText and chat
  /** A line drawn by the author, for melody.fromContour: one height per beat, 0 (low) to 1 (high). */
  shape?: number[];
  /** For evolve: how far children may stray from the parent, 0 (nearly the same) to 1 (loosely related). */
  distance?: number;
}

export interface AssistRequest {
  kind: AssistKind;
  project: Project; // read-only
  target: { trackId: string; start: number; end: number };
  selection?: number[]; // note ids the request is about
  /** Note ids that must come back unchanged. */
  locked?: number[];
  controls: Controls;
  count: number; // options wanted, usually 4
  seed: number; // same request + same seed = same local options
  /** For "evolve": the option to vary. */
  parent?: Option;
  /** The author's preferences, read from storage by the caller; absent when the profile is switched off. */
  profile?: PreferenceProfile;
}

export interface Option {
  id: string;
  kind: AssistKind;
  /** Three or four plain words: "Steps down, lands home". */
  label: string;
  /** One sentence on what it does and why it might fit. */
  rationale: string;
  tags: string[];
  ops: EditOp[];
  source: "local" | "ai";
  parentId?: string;
  /** Local analysis, shown on demand; never a single grade. */
  traits?: Record<string, number>;
}

export interface Idea {
  id: string;
  kind: "melody" | "chords" | "bass" | "accompaniment" | "drums" | "take" | "rhythm";
  label: string;
  createdAt: string;
  source: "local" | "ai" | "hum" | "tap" | "import" | "author";
  /** Ops relative to tick 0; re-anchored when dropped into the song. */
  ops: EditOp[];
  parentId?: string;
  rationale?: string;
  /** For kind "take": the stored recording this idea was made from (§8, §10). */
  takeId?: string;
}

export interface SuggestionRecord {
  id: string;
  at: string;
  kind: AssistKind;
  controls: Controls;
  optionIds: string[];
  outcome: "accepted" | "partly" | "evolved" | "parked" | "dismissed" | "ignored";
  acceptedId?: string;
}

/** What the assistant has noticed the author prefers. Local, visible and resettable. */
export interface PreferenceProfile {
  version: 1;
  /** Running preferences in 0..1, each with the number of observations behind it. */
  traits: Record<string, { value: number; n: number }>;
  enabled: boolean;
}

// ── Key hints ────────────────────────────────────────────────────────────────

export interface Hint {
  pitch: number;
  strength: number; // 0..1
  /** Machine-readable reasons, turned into plain words by the UI. */
  why: (
    "chordTone" | "scaleTone" | "tension" | "step" | "resolvesLeap" | "tendency" | "motif" | "yourHabit" | "model"
  )[];
}
export type HintMode = "off" | "scale" | "chord" | "smart";

// ── Grid notation for language models ────────────────────────────────────────

export interface GridBar {
  bar: number; // 1-based within the request window
  chord?: string; // chord sounding at the start of the bar, if known
  events: {
    start: number; // sixteenths from the start of the bar: 0..15 in 4/4
    len: number; // sixteenths
    pitch: string; // scientific pitch: "E4", "F#4"
    degree?: string; // scale degree in the key: "3", "b7" — given to the model, ignored coming back
  }[];
}
