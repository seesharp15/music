# Stage 2 — Music core

**Goal:** the engine room for everything creative: musical time, a theory kernel, the editable project
format with undo, compiling a project into a playable song, an audio engine that can play several tracks
and be played live, and local storage. No new screen; Practice gains the ability to play richer songs.

**Depends on:** Stage 0, and Stage 1's master bus · **Unlocks:** Stages 3, 4, 5, 7, 8 · **Size:** large ·
**Flag:** none needed (no UI); Practice changes are behaviour-preserving

## Why a separate stage

Studio, drum pads, the assistant, humming and audio import all need the same things: "which bar is this
tick in", "what key is this", "what chord are these notes", "apply this edit and let me undo it", "play
this right now". Built once, here, in the pure zone with tests, they are shared by the browser, the
server and every later stage. Built ad hoc inside features, they would be built five times and disagree.

## Design

### 2.1 Musical time — `src/music/time.ts`, `src/music/quantize.ts`

- `makeTimeMap(tempo, meter)` implements `TimeMap` (contracts §1): piecewise-linear tick ⇄ seconds
  across tempo changes, bar and beat arithmetic across meter changes. Exact round trip:
  `tickAt(secondsAt(t)) === t` for integer ticks.
- `beatMapOf(song)` implements `BeatMap` for songs: constant tempo from `bpm` and `gridOffset`, piecewise
  from `tempoMap`, `null` for free-time songs such as Divenire.
- `quantize(tick, grid, strength)`, `quantizeNotes(notes, { grid, strength, swing, groove, keepOffset })`.
  With `keepOffset`, the distance moved is stored in `PNote.offset`, so quantizing tidies the grid
  position without discarding the feel.
- `gridTicks(grid)` for `4 | 8 | 16 | 32 | "8t" | "16t"`; `swingOffset(tick, swing)`;
  `grooveOffset(tick, groove, meter)`.
- **Migrate the existing callers.** `src/song/rhythm.ts`, the beat lines in `Stage.tsx`, the rhythm map
  and the metronome in the player all compute beats as `time / (60 / bpm)`. Move them to `BeatMap`. For a
  constant-tempo song with no offset the results must be bit-for-bit the same as today.

### 2.2 Theory kernel — `src/music/theory.ts`, `src/music/analysis.ts`

A thin, typed layer over [`tonal`](https://github.com/tonaljs/tonal) (MIT), so the rest of the app never
imports `tonal` directly and the library could be swapped.

| Function | Meaning |
| --- | --- |
| `scaleOf(key)` → pitch classes, `degreeOf(pitch, key)` → `"1"…"7"` with accidentals, `pitchOfDegree(degree, key, near)` | Scale and scale-degree arithmetic |
| `parseChord(symbol)` → `{ root, quality, tones, bass }`, `formatChord(...)`, `chordTones(symbol, range)` | Chord symbols; one canonical spelling per chord |
| `romanOf(symbol, key)`, `chordOfRoman(roman, key)` | Function in the key: `Am` in C major is `vi` |
| `diatonicChords(key, { sevenths })`, `borrowedChords(key)`, `substitutesFor(symbol, key)` | The palette the chord picker and the harmonizer draw from |
| `detectChord(pitches)` → ranked symbols | Name the chord in a set of sounding notes |
| `detectKey(notes, { window? })` → ranked keys with confidence | Duration-weighted pitch-class profile matched against major and minor key profiles (Krumhansl–Schmuckler with Temperley's profiles); the windowed form finds a key change |
| `spell(pitch, key)` → `"F#4"` or `"Gb4"` | Note names that fit the key; replaces the sharps-only `noteName` where a key is known |
| `interval(a, b)`, `transposeDiatonic(pitch, steps, key)` | Used by motif transforms in Stage 5 |
| `chordAt(project, tick)`, `keyAt(project, tick)`, `metricWeight(tick, timeMap)` | Reading a project |

`analysis.ts` holds the read-only measurements other stages reuse: phrase boundaries (rests and long
notes), contour, interval histogram, range and tessitura, repeated-motif finder (transposition-invariant
matching of interval-and-rhythm n-grams), rhythm onset pattern per bar.

### 2.3 Project model and store — `src/project/`

- `types.ts` (from Stage 0), `schema.ts` (zod `ProjectSchema`, `migrate`), `ops.ts` (a pure
  `applyOps(project, ops): Project`), `new.ts` (`newProject({ title, bpm, meter, key })` with a Melody
  track on the right hand, a Chords track and a Bass track on the left, and an empty drum track).
- `store.ts` implements `ProjectStore` (contracts §5). Zustand's vanilla store holding the project;
  `apply` runs `applyOps` through Immer's `produceWithPatches` and pushes the inverse patches as one undo
  step. Undo depth 200. Selection, cursor and view state are *not* in the project and not undoable; they
  live in a separate UI store in Stage 3.
- Invariants `applyOps` enforces, each with a test: ids are unique and come from `seq`; notes stay inside
  21–108 and `dur > 0`; notes and chords are kept sorted by tick; chords never overlap; editing a note
  whose `origin` is not `manual`, `played` or `tapped` sets `edited: true`; ops addressed to a locked
  track are rejected unless the op itself unlocks it.
- **Autosave:** debounce 800 ms after the last change, write `projects` and `projectMeta`; every fifth
  save also writes a `snapshots` entry, keeping the newest 20. Flush on `pagehide` and when the tab is
  hidden, the same way Practice saves its session.

### 2.4 Compile and decompile — `src/project/compile.ts`, `src/project/fromSong.ts`

Per contracts §4.

- `compileProject`: expand drum clips into hits; apply swing, groove and `offset` unless `straight`;
  convert ticks to seconds through the `TimeMap`; emit `tracks`, `chords`, `drums`, `key`, `bpm`,
  `timeSignature`, `tempoMap` (only when tempo changes), `sections`, and `origin`.
- `projectFromSong`: for a song with a beat grid, snap each onset to the nearest grid step and keep the
  remainder in `offset`; right-hand notes go to a Melody track and left-hand notes to a Chords track
  (roles can be changed afterwards). For a free-time song, estimate a tempo map from inter-onset
  intervals and mark the project so the Studio can warn that the grid is a guess; Stage 8's beat tracker
  later does this properly.
- Round trip: `compileProject(projectFromSong(song))` reproduces every note of Rewrite the Stars within
  2 ms of its original start and duration.

### 2.5 Audio engine — `src/audio/engine.ts`, `src/audio/player.ts`

Today `Player` owns the instruments, buses and scheduling for one song. Split it:

- **`AudioEngine`** (contracts §6), one per page: context (`latencyHint: "interactive"`), instrument
  cache, the Stage 1 hand buses and master chain, a gain strip per track, a drum bus, a click bus. It
  answers "make this sound now or at time *t*".
- **`Player`** keeps its public surface and its scheduler exactly as they are and calls the engine
  instead of Tone. It gains:
  - `setSong(song, { keepPosition })` — swap the song under a running or paused transport without a gap,
    so Studio can recompile after each edit;
  - scheduling of `song.drums` and per-track mix (`trackMix`, `setTrackMix`, `solo`);
  - a count-in: `play({ countInBars })` clicks before the range starts.
- **Live playing:** `engine.noteOn/noteOff` sound immediately (no look-ahead) for on-screen keys, MIDI and
  auditioning. Live notes respect the sustain setting.
- **Drums:** a synthesized kit built from Tone's `MembraneSynth`, `NoiseSynth` and `MetalSynth` covering
  every `DrumPadId`. It needs no downloads and is the fallback for every sampled kit Stage 4 adds.
- **More sounds:** the `SoundId` list may grow (a bass, a pad, strings) for non-piano tracks; each new
  sound is a synth preset first, samples optional.
- **Routing:** instrument (per track × hand × sound) → track strip → hand bus → master. In Practice a
  bank song has no tracks, so the path collapses to exactly what Stage 1 built.

### 2.6 Storage and the user library — `src/storage/`, `src/library/catalog.ts`

- `src/storage/db.ts`: IndexedDB through [`idb`](https://github.com/jakearchibald/idb), database and
  stores per contracts §10, with a versioned `upgrade`. Request persistent storage
  (`navigator.storage.persist()`) the first time a project is saved, and surface a quiet warning when it
  is refused, because the browser may then evict the author's songs.
- `catalog.ts`: one `Catalog` that merges the bank index with user songs and project metadata, so the
  Library and the router resolve `u-…` ids the same way as bank ids.
- **Export and import:** a project or song as a `.json` file download and file-picker upload, validated
  on the way in. This is the backup story until there is cloud sync.

## Work packages

| Id | Deliverable | Owns | Needs |
| --- | --- | --- | --- |
| S2.1 | `TimeMap`, `BeatMap`, quantize, swing and groove; existing callers migrated | `src/music/time.ts`, `quantize.ts`, `src/song/rhythm.ts` | S0.4 |
| S2.2 | Theory kernel and analysis | `src/music/theory.ts`, `analysis.ts` | S0.4 |
| S2.3 | Project schema, `applyOps`, store with undo, autosave | `src/project/` except compile | S0.4, S2.6 for autosave |
| S2.4 | `compileProject`, `projectFromSong`, round-trip tests | `src/project/compile.ts`, `fromSong.ts` | S2.1, S2.3 |
| S2.5 | `AudioEngine` extraction; player on top of it; `setSong`, tracks, drums, count-in, live notes, synth kit | `src/audio/` | S1.4, S1.5 |
| S2.6 | IndexedDB layer, catalog, export and import | `src/storage/`, `src/library/catalog.ts` | S0 |

S2.1, S2.2, S2.5 and S2.6 are independent and can run in parallel. S2.3 follows S2.6; S2.4 follows S2.1
and S2.3. S2.5 is the only package that touches Practice's audio path and should be reviewed against the
Stage 0 scheduling test before anything else builds on it.

## Acceptance criteria

1. `TimeMap` round-trips every integer tick across a tempo map with three changes; bar and beat positions
   are right across a 4/4 → 3/4 → 6/8 change.
2. With `BeatMap` in place, the rhythm map, beat lines and metronome of Rewrite the Stars are unchanged
   (same labels, same click times within 1 ms); Divenire still shows no grid.
3. `detectKey` names the key of a 24-case fixture set (12 major, 12 minor short melodies) with at least
   22 right, and the relative key as runner-up in the others.
4. `detectChord` and `parseChord` agree on a table of 60 chords including sevenths, sus, added-tone,
   slash and altered dominants; `romanOf` is right for diatonic and common borrowed chords in major and
   minor.
5. Every invariant in §2.3 has a failing-input test that `applyOps` rejects or repairs as specified.
6. 200 random edits followed by 200 undos return a project deep-equal to the starting project; redo
   replays to the same end state.
7. A project edited, then the tab closed without an explicit save, reopens with the edits; a corrupted
   stored project opens read-only with the repair prompt and the last good snapshot offered.
8. The compile round trip in §2.4 holds for Rewrite the Stars.
9. The Stage 0 scheduling test passes unchanged after the engine extraction; Practice's bundle grows by
   no more than 10 KB gzipped.
10. Calling `setSong` with an edited song during playback produces no gap and no doubled note: the
    offline render differs from a clean render of the edited song only after the edit point.
11. A fixture song with two tracks, a drum part and a tempo change plays with every hit within 5 ms of
    its compiled time; soloing a track silences the others.
12. `engine.noteOn` from a pointer event starts sound within one render quantum of the call (no
    look-ahead delay), measured in the page.
13. Exporting a project and importing the file yields a deep-equal project; importing a malformed file is
    refused with a message that names the problem.

## Test plan

Almost everything here is pure and belongs in Vitest: time maps, quantize, theory tables, ops and
invariants (use property-based tests with a seeded generator for criteria 5 and 6), compile round trips.
The engine and player use the Playwright offline-render harness from Stage 0. Storage tests run in
Playwright against real IndexedDB, including an upgrade from an empty database.

## Risks

- **Regressing Practice** during the engine split. Mitigation: the scheduling test, the bundle budget,
  and landing the split as its own pull request with no feature mixed in.
- **Undo memory** on long sessions. Patches are small, but measure: 200 steps on a 3,000-note project
  should stay under 5 MB.
- **`tonal` naming quirks** (chord aliases, enharmonics). The kernel owns one canonical spelling; tests
  pin it so a library update cannot silently change stored chord symbols.
- **Free-time songs** have no honest grid. `projectFromSong` makes a guess and says so; do not present it
  as truth.

## Build notes

_Empty._
