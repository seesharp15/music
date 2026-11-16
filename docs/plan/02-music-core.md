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
- `beatMapOf(song)` in `src/song/beatmap.ts` implements `BeatMap` for songs: constant tempo from `bpm` and
  `gridOffset`, piecewise from `tempoMap`, `null` for free-time songs such as Divenire.
- `quantize(tick, grid, strength)`, `quantizeNotes(notes, { grid, strength, swing, groove, keepOffset })`.
  With `keepOffset`, the distance moved is stored in `PNote.offset`, so quantizing tidies the grid
  position without discarding the feel.
- `gridTicks(grid)` for `4 | 8 | 16 | 32 | "8t" | "16t"`; `swingOffset(tick, swing)`;
  `grooveOffset(tick, groove, meter)`.
- `estimateTempo(onsets)` in `src/music/tempo.ts` (contracts §8): tempo from the autocorrelation of onset
  times, preferring 70–140 BPM when two readings an octave apart fit equally; meter from the period of the
  accent pattern; swing from the ratio of long to short off-beat gaps. Tap the beat (Stage 4), humming
  without a click (Stage 7), quick import (Stage 8) and free-time songs (§2.4) all use it, which is why it
  lives here and not in any one of them.
- **Moving Practice onto `BeatMap`** is a separate package, S2.7, because it edits files that Stage 1 and
  S2.5 are also changing. Today `src/song/rhythm.ts` (which feeds the rhythm map, the coach and the default
  loop), the beat lines in `Stage.tsx` and `Trimmer.tsx`, and the player's metronome all compute beats as
  `time / (60 / bpm)`. For a constant-tempo song with no offset the results must be bit-for-bit the same
  afterwards.

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
- `applyOps` follows the rules in contracts §5, each with a test. **Refused** with an `EditError`, leaving
  the project unchanged: an id that does not exist; a pitch outside 21–108, or a length of zero or less;
  a chord that would overlap another; any op addressed to a locked track other than the `patchTrack` that
  unlocks it. **Put right silently:** ids assigned from `seq`; notes and chords kept sorted by tick;
  `lengthTicks` grown to fit; `edited: true` set when a note whose `origin` is not `manual`, `played` or
  `tapped` is changed.
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
  (roles can be changed afterwards). For a free-time song, estimate the tempo with `estimateTempo`
  and set `source.gridGuessed`, so the Studio can warn that the grid is a guess; Stage 8's beat tracker
  later does this properly.
- Round trip: `compileProject(projectFromSong(song))` reproduces every note of Rewrite the Stars within
  2 ms of its original start and duration.

### 2.5 Audio engine — `src/audio/engine.ts`, `src/audio/player.ts`

Today `Player` owns the instruments, buses and scheduling for one song. Split it:

- **`AudioEngine`** (contracts §6), one per page: context (`latencyHint: "interactive"`), instrument
  cache, the Stage 1 hand buses and master chain, a gain strip per track, a drum bus, a click bus. It
  answers "make this sound now or at time *t*".
- **`Player`** keeps its public surface and its scheduler exactly as they are; the engine takes the place
  of the `Sink` Stage 0 introduced. It gains:
  - `setSong(song, { keepPosition })` — swap the song under a running or paused transport without a gap,
    so Studio can recompile after each edit;
  - scheduling of `song.drums`, per-track mix (`trackMix`, `setTrackMix`, `solo`) and a drum mix
    (`drumMix`, `setDrumMix`);
  - a count-in: `play({ countInBars })` clicks before the range starts.
- **Live playing:** `engine.noteOn/noteOff` sound immediately (no look-ahead) for on-screen keys, MIDI and
  auditioning. Live notes respect the sustain setting.
- **Drums:** a synthesized kit built from Tone's `MembraneSynth`, `NoiseSynth` and `MetalSynth` covering
  every `DrumPadId`. It needs no downloads and is the fallback for every sampled kit Stage 4 adds.
- **More sounds:** the `SoundId` list may grow (a bass, a pad, strings) for non-piano tracks; each new
  sound is a synth preset first, samples optional.
- **Latency:** `src/audio/latency.ts` with `inputLatencyMs()` (contracts §6) — the reader only, returning 0
  until a device is calibrated. The calibration screen that writes the value is Stage 4.
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
| S2.1 | `TimeMap`, `BeatMap`, quantize, swing and groove offsets, `estimateTempo` — new files only | `src/music/time.ts`, `quantize.ts`, `tempo.ts`, `src/song/beatmap.ts` | S0.4 |
| S2.2 | Theory kernel and analysis | `src/music/theory.ts`, `analysis.ts` | S0.4 |
| S2.3 | Project schema, `applyOps`, store with undo, autosave | `src/project/` except compile | S0.4, S2.6 for autosave |
| S2.4 | `compileProject`, `projectFromSong`, round-trip tests | `src/project/compile.ts`, `fromSong.ts` | S2.1, S2.3 |
| S2.5 | `AudioEngine` extraction; player on top of it; `setSong`, tracks, drums, count-in, live notes, synth kit | `src/audio/` | S1.4, S1.5 |
| S2.6 | IndexedDB layer, catalog, export and import | `src/storage/`, `src/library/catalog.ts` | S0 |
| S2.7 | Practice on `BeatMap`: rhythm analysis, beat lines in the waterfall and the trimmer, rhythm map, metronome | `src/song/rhythm.ts`, `src/components/Stage.tsx`, `Trimmer.tsx`, `RhythmMap.tsx`, the metronome in `src/audio/` | S2.1, S2.5, all of Stage 1 |

S2.1, S2.2 and S2.6 add new files only and can run in parallel with each other and with Stage 1. S2.3
follows S2.6; S2.4 follows S2.1 and S2.3. S2.5 waits for Stage 1's audio work (S1.5) and is the package
that rebuilds Practice's audio path: review it against the Stage 0 scheduling test before anything else
builds on it. S2.7 comes last and is the only other package that edits Practice.

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
5. Every rule in §2.3 has a test: each refusal throws an `EditError` with the right code and leaves the
   project deep-equal to before; each silent correction produces the stated result.
6. 200 random edits followed by 200 undos return a project deep-equal to the starting project; redo
   replays to the same end state.
7. A project edited, then the tab closed without an explicit save, reopens with the edits. Loading a
   corrupted stored project returns a typed failure carrying the validation errors and the newest valid
   snapshot — never a throw, never a half-valid project. (The read-only screen built on this is Stage 3.)
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

Built from 16 November 2026, one package at a time on one branch (`claude/stage-2-implementation-p1wlxt`),
one commit per package, in the order S2.1, S2.2, S2.6, S2.3, S2.4, S2.5, S2.7 — S2.6 moved up because
S2.3's autosave needs it.

### S2.1 — musical time

- **`TimeMap` has two more methods**, `meterAt` and `bpmAt` (contract change, additive). `metricWeight`
  and the groove functions are handed a time map and need to know how its bars divide.
- **A beat is the meter's denominator**: six beats in a bar of 6/8, each an eighth. Tempo stays in
  quarter notes a minute everywhere.
- **A meter change that is not on a bar line starts a new bar where it falls.** The plan does not say;
  the alternative is a time map that can throw.
- **Swing is a stretch, not a nudge.** `swingOffset` warps the whole pair of units, so a sixteenth
  between a beat and a swung off-beat moves in proportion and notes never cross. On the beats it is 0 and
  on the off-beat eighth of triplet swing it is 80 ticks, as expected.
- **`grooveOffset` takes a `TimeMap`, not the meter events** the plan's signature shows: it needs bar
  starts, and every caller already holds the map. `grooveAccent` is its companion for the velocity half
  of a `Groove`.
- **`quantizeNotes` with `keepOffset`** quantizes where the note is *heard* (`tick + offset`), files it
  under the straight grid line, and puts the difference in `offset`: what is heard does not move. Without
  `keepOffset` the note moves to where its line is heard, swing and groove included.
- **`estimateTempo`** reads steady taps 0.4 s apart as 75, not 150 — the plan's rule (prefer 70–140 when
  octave readings fit equally) taken literally; `alternatives` is the one-tap correction. Compound time
  is reported with the tempo in quarter notes (6/8 at 80 dotted quarters comes back as 120). A stream of
  even eighths in 6/8 is indistinguishable from 3/4 and is read as 3/4.
- **On the bank:** Rewrite the Stars comes back as 125.00 BPM, 4/4, straight, confidence 1.0, in 17 ms.
  Divenire comes back as a guess with confidence 0.04 — which is the honest answer for free time, and is
  what `projectFromSong` will flag with `gridGuessed`.
