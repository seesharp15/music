# Contracts

The shared shapes every stage builds against: data formats, module interfaces, server API, storage keys.
Stage documents refer here instead of redefining anything. If two documents disagree, this one wins.

Changing a contract is allowed, but it is a change to everyone's work: update this file in the same pull
request, add a line to [CHANGELOG.md](CHANGELOG.md), and say so in the PR description. See
[agent-protocol.md](agent-protocol.md).

Types below are TypeScript and are **normative for names and meaning**. Stage 0 lands them as code; from
then on the code is the source of truth and this file is kept in step with it.

- [1. Time](#1-time)
- [2. Song — the playback format](#2-song--the-playback-format-piano-songv2)
- [3. Project — the editable format](#3-project--the-editable-format-piano-projectv1)
- [4. Compile and decompile](#4-compile-and-decompile)
- [5. Project store and edit operations](#5-project-store-and-edit-operations)
- [6. Audio engine and player](#6-audio-engine-and-player)
- [7. Assist](#7-assist)
- [8. Capture (hum and tap)](#8-capture-hum-and-tap)
- [9. Server API](#9-server-api)
- [10. Storage](#10-storage)
- [11. Routes and feature flags](#11-routes-and-feature-flags)
- [12. Source layout and the pure zone](#12-source-layout-and-the-pure-zone)

---

## 1. Time

Two clocks exist and they never mix inside one type.

| Clock | Unit | Used by | Why |
| --- | --- | --- | --- |
| **Performance time** | seconds at original speed | `Song`, `Player`, everything in Practice | Playback and practice need real time; slowing down is the player's job. |
| **Musical time** | ticks, `PPQ = 480` per quarter note | `Project`, Studio, Assist | Editing, quantizing and suggesting need bars and beats. |

`480` divides evenly into sixteenths (120), triplet eighths (160) and thirty-seconds (60).

```ts
export const PPQ = 480;

export interface TempoEvent { tick: number; bpm: number }
export interface MeterEvent { tick: number; numerator: number; denominator: 2 | 4 | 8 | 16 }

/** Converts between the two clocks. Built from a project's tempo and meter events. */
export interface TimeMap {
  secondsAt(tick: number): number;
  tickAt(seconds: number): number;
  /** Bar is 1-based; beat is 1-based within the bar; tick is the remainder inside the beat. */
  positionAt(tick: number): { bar: number; beat: number; tick: number };
  tickOfBar(bar: number): number;
  ticksPerBarAt(tick: number): number;
}
```

`BeatMap` is the same idea for a `Song` (seconds only), so Practice can count along to songs whose tempo
moves. It replaces the constant-`bpm` arithmetic in `src/song/rhythm.ts`, `Stage.tsx` and the metronome.

```ts
export interface BeatMap {
  /** Fractional beat index at a time; beat 0 is the first downbeat. */
  beatAt(seconds: number): number;
  secondsAt(beat: number): number;
  beatsPerBar: number;
}
/** Constant tempo when the song has only `bpm`; piecewise when it has `tempoMap`; null when it has neither. */
export function beatMapOf(song: Song): BeatMap | null;        // src/song/beatmap.ts
```

## 2. Song — the playback format (`piano-song/v2`)

What Practice plays and what the song bank stores. **v2 is v1 plus optional fields**: every existing v1
file is a valid input, `normalize()` accepts both, and the in-memory `Song` always has the v2 shape.
Files written by the app say `"piano-song/v2"`.

```ts
export type Hand = "L" | "R";
export type TrackRole = "melody" | "chords" | "bass" | "counter" | "free";
export type DrumPadId =
  | "kick" | "snare" | "rim" | "clap" | "hat" | "hatOpen" | "hatPedal"
  | "tomLow" | "tomMid" | "tomHigh" | "crash" | "ride" | "shaker" | "tamb" | "cowbell" | "perc";

export interface Note {
  pitch: number;       // MIDI 21..108
  time: number;        // seconds
  duration: number;    // seconds
  hand: Hand;
  velocity?: number;   // 0..1, default 0.7
  track?: string;      // v2: id of an entry in Song.tracks; absent on bank songs
}

export interface Section { name: string; start: number; end: number }   // seconds; unchanged from v1

export interface Song {
  format: "piano-song/v1" | "piano-song/v2";
  id: string;
  title: string;
  artist?: string;
  arranger?: string;
  source?: string;
  bpm?: number;                       // nominal tempo; absent = free time, no beat grid
  timeSignature?: [number, number];
  duration?: number;
  sections?: Section[];
  notes: Note[];

  // ── v2, all optional ───────────────────────────────────────────────
  key?: string;                       // tonal key name, e.g. "A minor"
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
```

### Song index (`public/songs/index.json`)

```ts
export interface SongIndexEntry {
  id: string;
  title: string;
  artist?: string;
  file: string;
  // hand-authored
  genre?: Genre;
  tags?: string[];
  difficulty?: 1 | 2 | 3 | 4 | 5;
  addedAt?: string;                   // ISO date
  // derived by `npm run songs:index`, never edited by hand
  duration?: number;
  bpm?: number;
  key?: string;
  noteCount?: number;
  range?: [number, number];           // lowest and highest pitch
  preview?: number[];                 // 48 values 0..1: note density over time, for the card thumbnail
}

export type Genre =
  | "pop" | "film-tv" | "classical" | "neoclassical" | "jazz" | "rock" | "folk" | "game" | "holiday" | "original";
```

## 3. Project — the editable format (`piano-project/v1`)

What Studio edits. Musical time, several tracks, a chord track, and a record of where every note came
from. A project is the *source*; a song is *compiled* from it (section 4).

```ts
export type Origin = "manual" | "played" | "tapped" | "hummed" | "imported" | "suggested";

export interface PNote {
  id: number;                 // unique within the project, from Project.seq
  pitch: number;              // MIDI 21..108
  tick: number;               // quantized start
  dur: number;                // ticks, > 0
  vel: number;                // 0..1
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
  hand: Hand;                 // default hand for practice: melody R, everything else L
  sound: SoundId;
  volume: number;             // 0..1
  muted: boolean;
  locked: boolean;            // assist never proposes edits to a locked track
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
  id: string; name: string; tick: number; dur: number; color?: string;
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
  references?: string[];      // "like the chorus of …"
  notes?: string;             // free text: theme, lyric idea, do and don't
}

export interface Project {
  format: "piano-project/v1";
  id: string;
  title: string;
  author?: string;
  createdAt: string;
  updatedAt: string;
  seq: number;                // next note / chord / clip id
  lengthTicks: number;
  tempo: TempoEvent[];        // at least one, at tick 0
  meter: MeterEvent[];        // at least one, at tick 0
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
    ref?: string;             // URL, or id of the reference audio blob
    engines?: Record<string, string>;   // model name → version and licence class
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
```

Every stored project passes `ProjectSchema` (zod) on load; a failing project opens read-only with a
repair prompt instead of crashing. A `migrate(raw)` function upgrades older versions.

The assistant's records — what it offered, what the author took, what they seem to prefer — are
deliberately **not** in the project. They are stored beside it (§10), so asking for ideas, dismissing
them or answering a listening question never changes the song.

## 4. Compile and decompile

```ts
/** Project → Song. Pure and deterministic. Applies swing, groove and per-note offsets. */
export function compileProject(p: Project, opts?: {
  /** Leave out swing, groove and offsets: exactly on the grid. */
  straight?: boolean;
  /** Only these tracks (solo). */
  tracks?: string[];
  /** Only this tick range, shifted to start at 0. */
  range?: { start: number; end: number };
}): Song;

/** Song → Project, to edit a bank song or an import. Needs a beat grid; without one, estimates it. */
export function projectFromSong(song: Song, opts?: { ppqGrid?: 16 | 32 }): Project;
```

Rules `compileProject` guarantees: output passes `normalize()`; notes are sorted by time then pitch;
`hand` is the note's override or its track's hand; `track` is the track id; the song id is
`u-<projectId>`; overlapping notes of the same pitch on one track are trimmed so they never overlap.

## 5. Project store and edit operations

One store holds the open project. Nothing writes to a project except through `apply`.

```ts
export type EditOp =
  | { op: "addNotes"; trackId: string; notes: Omit<PNote, "id">[] }
  | { op: "removeNotes"; trackId: string; ids: number[] }
  | { op: "patchNotes"; trackId: string; ids: number[]; patch: Partial<Omit<PNote, "id">> }
  | { op: "shiftNotes"; trackId: string; ids: number[]; ticks: number; semitones: number }
  | { op: "setChords"; range: { start: number; end: number }; chords: Omit<ChordEvent, "id">[] }
  | { op: "addHits"; trackId: string; hits: Omit<DrumTrack["hits"][number], "id">[] }
  | { op: "removeHits"; trackId: string; ids: number[] }
  | { op: "patchHits"; trackId: string; ids: number[]; patch: Partial<Omit<DrumTrack["hits"][number], "id">> }
  | { op: "putPattern"; trackId: string; pattern: DrumPattern }       // adds, or replaces the pattern with that id
  | { op: "removePattern"; trackId: string; patternId: string }       // and its clips
  | { op: "placeClip"; trackId: string; patternId: string; tick: number; repeats: number }
  | { op: "removeClip"; trackId: string; id: number }
  | { op: "addTrack"; track: Track; index?: number }
  | { op: "removeTrack"; trackId: string }
  | { op: "patchTrack"; trackId: string; patch: Partial<Pick<NoteTrack, "name" | "role" | "hand" | "sound" | "volume" | "muted" | "locked" | "feel"> & Pick<DrumTrack, "kit">> }
  | { op: "setSections"; sections: PSection[] }
  /** Range operations act on every track, plus chords, clips and sections. */
  | { op: "insertTime"; tick: number; dur: number }      // opens a gap; later material moves later
  | { op: "deleteTime"; tick: number; dur: number }      // removes the range; later material moves earlier
  /** Opens a gap as long as the range at `to`, then fills it with a copy. Never overwrites. */
  | { op: "copyRange"; from: { start: number; end: number }; to: number }
  | { op: "patchSong"; patch: Partial<Pick<Project, "title" | "author" | "tempo" | "meter" | "key" | "swing" | "groove" | "handSpan" | "lengthTicks" | "brief">> }
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

export class EditError extends Error {
  code: "unknownId" | "lockedTrack" | "outOfRange" | "overlap" | "badValue";
  /** Index in the `ops` array of the op that was refused. */
  opIndex: number;
}
```

`apply` is all-or-nothing. If any op is invalid — an id that does not exist, a locked track, a pitch
outside 21–108, a length of zero, one chord overlapping another — it throws an `EditError` and the project
is unchanged. What is not an error is put right silently: notes and chords are kept sorted by tick, new
ids come from `seq`, `lengthTicks` grows to fit, and `edited` is set when the author changes a note that
was not their own.

An option from the assistant, a hummed take and a pasted clipboard are all just `EditOp[]`. That single
shape is what makes preview, accept, partial accept and undo work the same way everywhere.

## 6. Audio engine and player

```ts
/** Declared in src/song/types.ts so the pure zone can use it; src/audio/player.ts re-exports it. */
export type SoundId = "clear" | "soft" | "epiano" | "bright" | "piano";   // Stage 2 may add more

export interface HandMix { volume: number; muted: boolean }               // volume 0..1 on the slider

/** One per page. Owns the audio context, instruments, buses and the master limiter. */
export interface AudioEngine {
  /** Resumes the context; must be called from a user gesture. */
  start(): Promise<void>;
  now(): number;                                                           // audio-context seconds
  /** Live playing: on-screen keys, MIDI, auditioning a dragged note. */
  noteOn(pitch: number, velocity: number, ch: Channel, when?: number): void;
  noteOff(pitch: number, ch: Channel, when?: number): void;
  /** Scheduled playing: the Player. */
  play(pitch: number, duration: number, velocity: number, ch: Channel, when: number): void;
  drum(pad: DrumPadId, velocity: number, when?: number, kit?: string): void;
  click(accent: boolean, when: number): void;
  setHandMix(hand: Hand, mix: HandMix): void;
  setTrackMix(trackId: string, mix: HandMix): void;
  setDrumMix(mix: HandMix): void;
  setStereoSplit(on: boolean): void;
  setSustain(down: boolean): void;
  setSound(sound: SoundId): void;
  releaseAll(): void;
  /** Output latency in seconds, for lining up recorded input. */
  latency(): number;
}
export interface Channel { hand: Hand; track?: string; sound?: SoundId }
```

`PlayerState` changes (Stage 1): `levels: Record<Hand, HandLevel>` becomes `mix: Record<Hand, HandMix>`,
and `sustain: boolean` is added. Stage 2 adds `trackMix`, `drumMix`, `setSong(song, { keepPosition })` for
hot-swapping the compiled song while editing, and scheduling of `drums` and `tracks`.

`inputLatencyMs()` in `src/audio/latency.ts` returns the calibrated input latency stored under
`piano-tutor:latency`, or 0 when this device has not been calibrated. Every recording path — live notes,
pads, humming — subtracts it. Stage 2 provides the reader; Stage 4 adds the calibration screen that writes
it.

**The sink.** The player never calls Tone directly to make a sound; it calls a `Sink` — in Stage 0 a thin
wrapper round today's instruments, from Stage 2 the `AudioEngine`. Tests substitute a recording sink to
check *when* things are scheduled, and an offline engine to check *what* they sound like.

```ts
export interface Sink {
  play(pitch: number, duration: number, velocity: number, ch: Channel, when: number): void;
  click(accent: boolean, when: number): void;
  releaseAll(): void;
}
```

Slider-to-gain law, used everywhere a volume slider exists: `gain = muted ? 0 : volume²`.

## 7. Assist

Everything the assistant offers is an `Option`: a labelled, explained set of edit operations that the
author can hear, take, take part of, park, evolve or dismiss. Providers differ; the shape does not.

```ts
export type AssistKind =
  | "melody.continue" | "melody.vary" | "melody.answer" | "melody.fill"
  | "melody.fromRhythm" | "melody.fromContour" | "melody.fromChords" | "melody.fromText"
  | "harmony.harmonize" | "harmony.reharmonize" | "harmony.substitute"
  | "bass.line" | "accompaniment.pattern" | "drums.pattern" | "drums.fill";

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
  style?: string;                   // bass or accompaniment style id
  text?: string;                    // the author's words, for *.fromText and chat
  /** A line drawn by the author, for melody.fromContour: one height per beat, 0 (low) to 1 (high). */
  shape?: number[];
  /** For evolve: how far children may stray from the parent, 0 (nearly the same) to 1 (loosely related). */
  distance?: number;
}

export interface AssistRequest {
  kind: AssistKind;
  project: Project;                 // read-only
  target: { trackId: string; start: number; end: number };
  selection?: number[];             // note ids the request is about
  /** Note ids that must come back unchanged. */
  locked?: number[];
  controls: Controls;
  count: number;                    // options wanted, usually 4
  seed: number;                     // same request + same seed = same local options
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

/** Declared in src/assist/providers/types.ts, outside the pure zone: `AbortSignal` is a platform type. */
export interface AssistProvider {
  id: "local" | "ai";
  supports(kind: AssistKind): boolean;
  suggest(req: AssistRequest, signal: AbortSignal): Promise<Option[]>;
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
```

Every `Option`, whichever provider made it, passes `validateOption(project, request, option)` in
`src/assist/core/validate.ts` before it is shown: notes in range and on the grid, no overlaps within a
voice, the requested length, locked notes untouched, nothing outside the target. Stage 5 writes it;
Stage 6 adds repair for model output.

`SuggestionRecord`s and the per-project `PreferenceProfile` are stored beside the project, not in it (§10).

Key-highlight hints are synchronous and local, so they have their own small interface:

```ts
export interface Hint {
  pitch: number;
  strength: number;                 // 0..1
  /** Machine-readable reasons, turned into plain words by the UI. */
  why: ("chordTone" | "scaleTone" | "tension" | "step" | "resolvesLeap" | "tendency" | "motif" | "yourHabit" | "model")[];
}
export type HintMode = "off" | "scale" | "chord" | "smart";
export function hintsAt(project: Project, trackId: string, tick: number, mode: HintMode, spice: number): Hint[];
```

### Grid notation for language models

Language models are reliable with explicit positions and unreliable with running arithmetic, so the
assistant never asks one to add up durations. Melodies cross the wire as bars of events on a
sixteenth-note grid, each with its own start position:

```ts
export interface GridBar {
  bar: number;                      // 1-based within the request window
  chord?: string;                   // chord sounding at the start of the bar, if known
  events: {
    start: number;                  // sixteenths from the start of the bar: 0..15 in 4/4
    len: number;                    // sixteenths
    pitch: string;                  // scientific pitch: "E4", "F#4"
    degree?: string;                // scale degree in the key: "3", "b7" — given to the model, ignored coming back
  }[];
}
```

`src/assist/core/grid.ts` (pure zone, run by the server) converts `Project ⇄ GridBar[]`; triplets use a
twelfth-of-a-beat variant of the same shape.
Every bar a model returns is validated (positions inside the bar, no overlaps within a voice, pitches in
range) before it becomes an `Option`.

## 8. Capture (hum and tap)

```ts
export interface PitchFrame { time: number; f0: number | null; confidence: number; rms: number }

export interface PitchTracker {
  id: string;                       // "mpm", "swift-f0"
  sampleRate: number;
  hopSeconds: number;
  /** Loads model weights if any. */
  ready(): Promise<void>;
  /** Asynchronous, because model inference is. */
  process(block: Float32Array): Promise<PitchFrame[]>;
  reset(): void;
}

/** A recording waiting to be turned into notes. The contour is kept so it can be re-read later. */
export interface Take {
  id: string;
  kind: "hum" | "tap";
  createdAt: string;
  frames?: PitchFrame[];
  /** `held` is how long the pad or key stayed down, in seconds. */
  taps?: { time: number; velocity: number; held: number; pad?: DrumPadId }[];
  /** Set when the take was recorded against the click: the song position, in ticks, where it began. */
  startTick?: number;
  audioBlobId?: string;
}

export interface SegmentOptions {
  sensitivity: number;              // 0..1, more = more, shorter notes
  minNoteMs: number;
  /** Cents the singer is sharp or flat overall; estimated when omitted. */
  tuningCents?: number;
  snapToKey?: { tonic: string; mode: string };
}

/** A note in the take's own time, before it has a place in the song. */
export interface HeardNote { pitch: number; start: number; end: number; vel: number; conf: number }

/** Step 1 — contour to notes, in seconds. Knows nothing about the song. */
export function segmentTake(take: Take, opts: SegmentOptions): { notes: HeardNote[]; tuningCents: number };

/** Step 2 — notes in seconds to notes in the song. */
export function placeNotes(notes: HeardNote[], where: {
  timeMap: TimeMap;
  /** Song position of the take's first sample. */
  startTick: number;
  /** Calibrated input latency to subtract. */
  latencyMs: number;
  quantize?: { grid: 8 | 16 | "8t" | "16t"; strength: number; groove?: Groove };
  /** Whole octaves to shift; when omitted, chosen so the notes sit inside `range`. */
  octaveShift?: number;
  range?: [number, number];
  origin: Origin;
}): Omit<PNote, "id">[];

/** Tempo, meter and swing from a list of onset times: taps, hummed notes, or notes from a recording. */
export function estimateTempo(onsets: { time: number; weight?: number }[]): {
  bpm: number; meter: [number, number]; swing: number; confidence: number;
  /** The same rhythm read at half and at double speed, for a one-tap correction. */
  alternatives: number[];
};                                                                    // src/music/tempo.ts
```

A take recorded without the click has no `startTick`: its tempo comes from `estimateTempo` and it is
placed at the cursor. Stage 8 uses `segmentTake` and `placeNotes` unchanged for the vocal and bass lines of
a recording.

## 9. Server API

A small Node service (`server/`) that holds the keys and the long jobs. JSON in and out; errors are
`{ error: { code, message, retryable } }` with a matching HTTP status. All routes except `health` need the
header `x-access-code`.

| Route | Request → response | Stage |
| --- | --- | --- |
| `GET /api/health` | → which features are configured | 6 |
| `POST /api/assist/options` | `AssistOptionsBody` → `{ options: Option[] }` | 6 |
| `POST /api/assist/critique` | `{ request: AssistRequest }` → `{ observations: Observation[] }` | 6 |
| `POST /api/assist/chat` | `ChatBody` → `ChatReply`, streamed over the response body | 6 |
| `POST /api/import` | multipart: `file` or `url`, and `kind` (`piano` or `song`) → `{ jobId }` | 8 |
| `GET /api/import/:id` | → `ImportJob`; polled every two seconds | 8 |
| `DELETE /api/import/:id` | cancels, and deletes the job's files | 8 |

```ts
export interface AssistOptionsBody {
  /** The project inside is trimmed by the client to the section in question plus eight bars either side. */
  request: AssistRequest;
  /** Options already on screen, so the server does not repeat them. */
  shown?: Pick<Option, "id" | "ops">[];
}
export interface Observation { dimension: string; text: string; try?: { kind: AssistKind; controls: Controls } }
export interface ChatBody { request: AssistRequest; turns: { role: "author" | "cowriter"; text: string }[] }
export interface ChatReply {
  say: string;
  options?: Option[];
  question?: { prompt: string; choices: { label: string; controls?: Controls }[] };
  briefPatch?: Partial<Brief>;
}
export interface ImportJob {
  status: "queued" | "running" | "done" | "error";
  stage?: "uploading" | "separating" | "transcribing" | "beats" | "chords";
  progress?: number;                // 0..1
  /** Present when done. Building a project from it happens in the browser. */
  analysis?: AnalyzeResult;
  error?: { code: string; message: string; retryable: boolean };
}
```

The server builds the model's prompt from the `AssistRequest` with `src/assist/core/prompt.ts` and checks
what comes back with `validate.ts`. Both are pure-zone modules, so the browser and the server cannot
disagree about what a valid option is.

Streaming uses the `fetch` response body, not `EventSource`: requests need the access-code header and a
body, and `EventSource` can send neither. Import progress is polled; a job runs for a minute or more.

The ML worker (`ml/`, Python) is private to the server. It does inference only and answers in seconds,
never in ticks. Turning an `AnalyzeResult` into a project is TypeScript in the pure zone
(`src/import/build/`) and **runs in the browser**, which keeps the result (§10) so the arrangement level
can be changed later without another job.

```ts
/** POST {ML_WORKER_URL}/analyze — multipart audio or { audioUrl } plus options. */
export interface AnalyzeResult {
  duration: number;
  /** Engine name → version and licence class, e.g. { "beat-this": "1.1.0 clean" }. */
  engines: Record<string, string>;
  beats: number[];                  // seconds
  downbeats: number[];              // seconds
  bpm: number;
  meter: [number, number];
  key?: { tonic: string; mode: "major" | "minor"; confidence: number };
  sections?: { start: number; end: number; label: string }[];
  chords?: { start: number; end: number; symbol: string; confidence: number }[];
  /** One entry per source: "piano" for a solo recording, or "vocals" / "bass" / "other" for a mix. */
  stems: {
    name: string;
    /** Polyphonic sources: note events. */
    notes?: { pitch: number; start: number; end: number; velocity: number; confidence: number }[];
    /** Single-line sources (voice, bass): a pitch contour, turned into notes by `segmentTake`. */
    frames?: PitchFrame[];
    pedal?: { time: number; down: boolean }[];
  }[];
  drums?: { pad: DrumPadId; time: number; velocity: number }[];
  warnings: string[];
}
```

## 10. Storage

Local-first: a song the author builds lives in their browser until they export it.

| Where | Key | Holds |
| --- | --- | --- |
| `localStorage` | `piano-tutor:prefs` | sound, stereo, sustain, sync lines, key mode (existing, extended) |
| `localStorage` | `piano-tutor:open:<panel>` | collapsed panels (existing) |
| `localStorage` | `piano-tutor:recent` | recently played: `{ id, at, time, duration }[]`, newest first, max 12 |
| `localStorage` | `piano-tutor:flags` | feature flags turned on by hand |
| `localStorage` | `piano-tutor:access-code` | the code sent as `x-access-code` |
| `localStorage` | `piano-tutor:latency` | measured input latency per device, ms |
| `sessionStorage` | `piano-tutor:session:<songId>` | position, speed, loop, zoom, mix (existing, migrated) |
| IndexedDB `piano-tutor` | store `projects` | `Project` by id |
| | store `projectMeta` | `{ id, title, updatedAt, bars, preview }` for fast listing |
| | store `snapshots` | last 20 autosaved versions per project |
| | store `songs` | user `Song`s by id (`u-…`): compiled or imported |
| | store `takes` | `Take`s by id: contours and taps, kept so they can be re-read |
| | store `blobs` | audio (hummed takes, reference audio for imports) and stored `AnalyzeResult`s |
| | store `kv` | `assist:<projectId>` — `{ history: SuggestionRecord[]; profile: PreferenceProfile }` |
| | | `assist:profile` — the author's preferences across all songs |
| | | `studio:<projectId>` — cursor, zoom, active track, tool, hint mode, authorship view |
| | | `chat:<projectId>` — the last thirty co-writer turns |

Exporting one project writes the project alone. "Export all my songs" (Stage 3) also carries each
project's `kv` entries and takes.

## 11. Routes and feature flags

Hash routes, so the app keeps working on any static host and old links survive.

| Route | Screen | Stage |
| --- | --- | --- |
| `#/` | Library | 1 |
| `#/play/:songId` | Practice (bank id, or `u-…` for a user song) | 1 |
| `#/studio` | Project list and "new song" | 3 |
| `#/studio/:projectId` | Studio | 3 |
| `#/import` | Import from audio | 8 |
| `#/settings` | Storage and backup (Stage 3), latency calibration (4), access code (6) | 3 |
| `#<songId>` (legacy) | Redirects to `#/play/<songId>` | 1 |

Flags let unfinished stages merge without showing: `studio`, `drums`, `assist`, `assist-ai`, `hum`,
`import`, `import-youtube`. On when listed in `piano-tutor:flags` or in `?flags=a,b`. A stage removes its
flag when its acceptance criteria pass. One more, `test-hooks`, exposes `window.__app` (player, project
store, UI store) in a production build for end-to-end tests; it is always on in development builds.

## 12. Source layout and the pure zone

```
src/
  app/        shell, router, flags, settings, error boundary
  library/    home page, catalog, user-song listing
  components/ Practice (existing files stay where they are)
  song/       ★ Song types, normalize, BeatMap, rhythm analysis  (load.ts is not pure: it fetches)
  music/      ★ time, tempo, theory, quantize, analysis, groove, voicing
  project/    ★ Project types, schema, edit ops, compile  (store.ts is not pure)
  assist/
    core/     ★ hints, generators, scoring, grid notation
    ui/       tray, controls, coach panel
    providers/ local.ts, ai.ts
  audio/      engine, player, instruments, drums, mic worklet
  studio/     editor canvas, tools, panels
  capture/    hum: trackers, segmentation (★ segment.ts), review UI
  import/     upload, job progress, review  (★ build/: AnalyzeResult → Project)
  storage/    IndexedDB
server/       Node API (imports the ★ modules)
ml/           Python inference worker
docs/plan/    this plan
```

★ marks the **pure zone**: no DOM, no Web Audio, no React, no `tone`. These modules are type-checked by a
second `tsconfig` without the DOM library, so they are guaranteed to run in the browser, in the server and
in unit tests alike. Musical logic goes here; everything else calls it.
