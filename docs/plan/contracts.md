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
export function beatMapOf(song: Song): BeatMap | null;
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
  notes: PNote[];
}

export interface DrumPattern {
  id: string;
  name: string;
  steps: 16 | 32;             // per bar
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

export interface PSection { id: string; name: string; tick: number; dur: number; color?: string }

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
  sections: PSection[];
  chords: ChordEvent[];
  tracks: Track[];
  brief?: Brief;
  /** Parked alternatives: options kept for later, hummed takes, tapped rhythms. */
  ideas: Idea[];
  /** A tapped or hummed rhythm waiting for pitches: drawn as outlines, never compiled. */
  pending?: { trackId: string; slots: { tick: number; dur: number; vel: number }[] };
  assist: { profile: PreferenceProfile; history: SuggestionRecord[] };
  /** Present on imported projects. */
  source?: {
    kind: "audio" | "youtube" | "midi" | "song";
    ref?: string;             // URL, or id of the reference audio blob
    engines?: Record<string, string>;   // model name → version, for reproducibility
    importedAt: string;
  };
}
```

Every stored project passes `ProjectSchema` (zod) on load; a failing project opens read-only with a
repair prompt instead of crashing. A `migrate(raw)` function upgrades older versions.

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
  | { op: "putPattern"; trackId: string; pattern: DrumPattern }
  | { op: "placeClip"; trackId: string; patternId: string; tick: number; repeats: number }
  | { op: "addTrack"; track: Track; index?: number }
  | { op: "removeTrack"; trackId: string }
  | { op: "patchTrack"; trackId: string; patch: Partial<Pick<NoteTrack, "name" | "role" | "hand" | "sound" | "volume" | "muted" | "locked">> }
  | { op: "setSections"; sections: PSection[] }
  /** Range operations move everything on every track, plus chords, clips and sections. */
  | { op: "insertTime"; tick: number; dur: number }
  | { op: "deleteTime"; tick: number; dur: number }
  | { op: "copyRange"; from: { start: number; end: number }; to: number }
  | { op: "patchSong"; patch: Partial<Pick<Project, "title" | "author" | "tempo" | "meter" | "key" | "swing" | "groove" | "lengthTicks" | "brief">> }
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
```

An option from the assistant, a hummed take and a pasted clipboard are all just `EditOp[]`. That single
shape is what makes preview, accept, partial accept and undo work the same way everywhere.

## 6. Audio engine and player

```ts
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
and `sustain: boolean` is added. Stage 2 adds `trackMix`, `setSong(song, { keepPosition })` for hot-swapping
the compiled song while editing, and scheduling of `drums` and `tracks`.

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

The server converts `Project ⇄ GridBar[]`; triplets use a twelfth-of-a-beat variant of the same shape.
Every bar a model returns is validated (positions inside the bar, no overlaps within a voice, pitches in
range) before it becomes an `Option`.

## 8. Capture (hum and tap)

```ts
export interface PitchFrame { time: number; f0: number | null; confidence: number; rms: number }

export interface PitchTracker {
  id: string;                       // "mpm", "crepe-tiny", …
  sampleRate: number;
  hopSeconds: number;
  /** Loads model weights if any. */
  ready(): Promise<void>;
  process(block: Float32Array): PitchFrame[];
  reset(): void;
}

/** A recording waiting to be turned into notes. The contour is kept so it can be re-segmented. */
export interface Take {
  id: string;
  kind: "hum" | "tap";
  createdAt: string;
  frames?: PitchFrame[];
  taps?: { time: number; velocity: number; pad?: DrumPadId }[];
  /** Tempo the take was recorded against, if the metronome was on. */
  bpm?: number;
  audioBlobId?: string;
}

export interface SegmentOptions {
  sensitivity: number;              // 0..1, more = more, shorter notes
  minNoteMs: number;
  /** Cents the singer is sharp or flat overall; estimated when omitted. */
  tuningCents?: number;
  snapToKey?: { tonic: string; mode: string };
  quantize?: { grid: 8 | 16 | 12; strength: number };
  octaveShift?: number;
}
export function segmentTake(take: Take, opts: SegmentOptions): { notes: Omit<PNote, "id">[]; bpm: number; tuningCents: number };
```

## 9. Server API

A small Node service (`server/`) that holds the keys and the long jobs. JSON in and out; errors are
`{ error: { code, message, retryable } }` with a matching HTTP status. All routes except `health` need the
header `x-access-code`.

| Route | Purpose | Stage |
| --- | --- | --- |
| `GET /api/health` | Liveness and which features are configured | 6 |
| `POST /api/assist/options` | `AssistRequest` (project trimmed to the context window) → `{ options: Option[] }` | 6 |
| `POST /api/assist/critique` | Selection → observations, each with an optional `Option` that acts on it | 6 |
| `POST /api/assist/chat` | Conversation turn → `{ say, options, question? }`, streamed as server-sent events | 6 |
| `POST /api/import` | Audio upload or `{ url }` → `{ jobId }` | 8 |
| `GET /api/import/:id` | `{ status, stage, progress, result?, error? }` | 8 |
| `GET /api/import/:id/events` | The same as server-sent events | 8 |
| `DELETE /api/import/:id` | Cancel and delete the job's files | 8 |

The ML worker (`ml/`, Python) is private to the server. It does inference only and answers in seconds,
never in ticks; all musical post-processing happens in TypeScript using the same `music/` code as the
browser.

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
| | store `blobs` | audio: hummed takes, reference audio for imports |
| | store `kv` | assist cache, global preference profile |

## 11. Routes and feature flags

Hash routes, so the app keeps working on any static host and old links survive.

| Route | Screen | Stage |
| --- | --- | --- |
| `#/` | Library | 1 |
| `#/play/:songId` | Practice (bank id, or `u-…` for a user song) | 1 |
| `#/studio` | Project list and "new song" | 3 |
| `#/studio/:projectId` | Studio | 3 |
| `#/import` | Import from audio | 8 |
| `#/settings` | Access code, latency calibration, data export | 6 |
| `#<songId>` (legacy) | Redirects to `#/play/<songId>` | 1 |

Flags let unfinished stages merge without showing: `studio`, `drums`, `assist`, `assist-ai`, `hum`,
`import`, `import-youtube`. On when listed in `piano-tutor:flags` or in `?flags=a,b`. A stage removes its
flag when its acceptance criteria pass.

## 12. Source layout and the pure zone

```
src/
  app/        shell, router, flags, settings, error boundary
  library/    home page, catalog, user-song listing
  components/ Practice (existing files stay where they are)
  song/       Song types, loader, BeatMap, rhythm analysis
  music/      ★ time, theory, quantize, analysis
  project/    ★ Project types, schema, edit ops, compile  (store.ts is not pure)
  assist/
    core/     ★ hints, generators, scoring, grid notation
    ui/       tray, controls, coach panel
    providers/ local.ts, ai.ts
  audio/      engine, player, instruments, drums, mic worklet
  studio/     editor canvas, tools, panels
  capture/    hum: trackers, segmentation (★ segment.ts), review UI
  import/     upload, job progress, review
  storage/    IndexedDB
server/       Node API (imports the ★ modules)
ml/           Python inference worker
docs/plan/    this plan
```

★ marks the **pure zone**: no DOM, no Web Audio, no React, no `tone`. These modules are type-checked by a
second `tsconfig` without the DOM library, so they are guaranteed to run in the browser, in the server and
in unit tests alike. Musical logic goes here; everything else calls it.
