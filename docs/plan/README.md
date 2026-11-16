# Piano Tutor → Library, Practice and Studio: the build plan

**Status:** Stages 0 and 1 are built and live; milestone M1 was confirmed by the owner on a phone on
16 November 2026. Stage 2 is built and awaiting review ([its build notes](02-music-core.md#build-notes)
say what differed and what the owner should check — Practice in Safari first). Stage 3 is next.
Decisions are recorded in §9 · **Written:** 15 November 2026

This folder is the plan and specification for growing Piano Tutor from a practice player into a place to
find songs, practise them, and write new ones — by hand, with an assistant that keeps the author in
charge, by humming, by tapping a beat, or from a recording.

It is written to be handed to builders: one agent working through it in order, or several in parallel.

**To review it**, read this page — it has the whole shape, the decisions already made, and the ones that
are yours. Then open any stage whose detail you want to check.

**To build from it**, read this page, [agent-protocol.md](agent-protocol.md) and
[contracts.md](contracts.md), then your stage.

| File | What it is |
| --- | --- |
| [README.md](README.md) | This page: scope, architecture, stages, decisions, risks |
| [contracts.md](contracts.md) | Shared data formats, interfaces, server API, storage, routes |
| [agent-protocol.md](agent-protocol.md) | How to work on a package and what "done" means |
| [research.md](research.md) | The technology survey behind the choices, with what was and was not verified |
| [00-foundations.md](00-foundations.md) … [09-polish.md](09-polish.md) | One specification per stage |
| [CHANGELOG.md](CHANGELOG.md) | Changes to contracts after the build starts |
| `spikes/` | Decision notes produced by investigation packages |

---

## 1. What was asked for, and where it is

| Request | Stage |
| --- | --- |
| A landing home page listing the song bank; room to grow into genres and more | [1](01-library-and-practice.md), grown in [9](09-polish.md) |
| The left/right sound toggle becomes a volume control with mute | [1](01-library-and-practice.md) |
| A sustain-pedal option; a simple toggle for now | [1](01-library-and-practice.md); pedalling as written in [9](09-polish.md) |
| A builder to create a new song, by direct manual entry | [3](03-studio-manual.md), on the engine in [2](02-music-core.md) |
| Key-highlight hints for what might sound next | [5](05-assist-local.md) |
| Smart melody building with creative control; catchy hooks | [5](05-assist-local.md) and [6](06-assist-ai.md) |
| Bass and supporting chords for a melody — single notes or full chords — as options to choose from and evolve | [5](05-assist-local.md), [6](06-assist-ai.md) |
| The reverse: chords first, melody after | [3](03-studio-manual.md) (chord track), [5](05-assist-local.md) (melody over chords) |
| Draw out what is in the author's head; assist, never replace authorship | The rules in [5](05-assist-local.md); "Help me find it", the brief and the co-writer's questions in [5](05-assist-local.md) and [6](06-assist-ai.md) |
| "AI"-powered assistant | [6](06-assist-ai.md) |
| Hum a melody and have it transcribed into the builder | [7](07-hum-to-notes.md) |
| A drum-pad instrument, to add parts and to set the beat and timing | [4](04-drum-pads.md) |
| Feed in audio or a YouTube link and get an arrangement | [8](08-audio-import.md): files and "record this tab"; paste-a-link deferred by the owner |
| Full-featured, cutting-edge technology | Section 5 below; [research.md](research.md) |
| A staged plan for a team of agents or a single agent | Sections 6 and 7 below |

## 2. The idea that governs the rest

The assistant helps an author; it does not write the song. That sentence is easy to agree with and easy
to betray in a hundred small design choices, so the plan turns it into rules that can be tested
(Stage 5, "The rules this stage must keep"). In short:

- nothing enters a song without the author choosing it;
- every suggestion can be heard first and undone after;
- suggestions come as several real alternatives, each explained in plain words;
- the author's own notes are never changed unless they asked;
- the tool is complete with all assistance switched off;
- where each note came from is recorded and shown;
- analysis describes a melody, and never reduces it to a grade.

Two consequences shape the order of work. The hand tools are finished before any assistance is built
(Stage 3 before Stages 5 and 6). And the on-device assistant comes before the language model (Stage 5
before 6), so help is instant and works offline, with the model as a second voice in the same tray
rather than a spinner the author waits on.

## 3. Where the code is today

A Vite + React 18 + TypeScript + Tone.js single-page app, deployed as a static site on Render, about
2,600 lines of TypeScript.

- One screen, Practice: a falling-note waterfall over a keyboard (`components/Stage.tsx`), a loop trimmer
  with zoom and sections (`Trimmer.tsx`), a rhythm map, step-through, a hands-together coach, speed from
  5% to 200%.
- One audio class (`audio/player.ts`): a look-ahead scheduler over Tone instruments, two hand channels
  with On / Soft / Off, stereo split, metronome, five sounds.
- One data format, `piano-song/v1` (`docs/song-format.md`): notes in seconds with a hand each; two songs
  in `public/songs/`.
- State in `localStorage` and `sessionStorage`. No server, no router, no tests, no linter, no CI.

It is in real use on a phone on a music stand. Every stage has to leave that working at least as well as
it does now; the plan's first stage exists to make that checkable.

## 4. What gets built

Three areas in one app:

```
                 ┌─────────────────────────────────────────────────────────────┐
  Library  ──►   │ Song bank (built in)  ·  My songs (on this device)          │
   #/            │ search · genres · difficulty · continue where you left off  │
                 └───────┬───────────────────────────────┬─────────────────────┘
                         │ play                          │ edit / new / import
                         ▼                               ▼
  Practice  #/play/:id                      Studio  #/studio/:id
  waterfall · loop · speed · coach          the same waterfall, editable
  hand volume + mute · sustain              ┌───────────────────────────────────┐
           ▲                                │ ways in:  keys · MIDI · drawing   │
           │ "Practice it"                  │           drum pads · tap a beat  │
           └─────── compile ◄───────────────│           hum · a recording       │
                                            │ help:     key hints · Ideas tray  │
                                            │           coach · co-writer       │
                                            └───────────────────────────────────┘
```

And underneath:

```
  Browser                                                        Server (from Stage 6)
  ┌───────────────────────────────────────────────────┐          ┌────────────────────────────┐
  │ UI: library · practice · studio · assist          │          │ Node API                   │
  │ ───────────────────────────────────────────────── │   /api   │   assist → Claude          │
  │ Pure zone (no DOM, no audio; fully tested):       │ ───────► │   import jobs              │
  │   music/           time · theory · groove         │          │   (same pure-zone code)    │
  │   project/         model · edit ops · compile     │          └─────────────┬──────────────┘
  │   assist/core/     hints · generators · validate  │                        │ private
  │   capture/segment  contour → notes                │          ┌─────────────▼──────────────┐
  │ ───────────────────────────────────────────────── │          │ Python ML worker (Stage 8) │
  │ audio/    engine · player · drums · microphone    │          │   inference only: stems,   │
  │ storage/  IndexedDB: projects, songs, recordings  │          │   notes, beats, chords     │
  │ models    WebAssembly, in a Worker                │          └────────────────────────────┘
  └───────────────────────────────────────────────────┘
```

The decisions that hold this together:

| Decision | Why |
| --- | --- |
| **Two formats.** A *project* (bars and beats, several tracks, provenance) is what Studio edits; a *song* (seconds, two hands) is what Practice plays. A project compiles to a song. | Editing and suggesting need musical time; practising needs real time. Practice stays simple, and every built or imported song is practisable for free. |
| **The existing song format grows only by optional fields** (`piano-song/v2`). | Every current file stays valid; Practice keeps working throughout. |
| **Studio is the Practice waterfall, made editable** — time vertical, keyboard at the bottom. | What you write looks like what you will practise; the keyboard is both the instrument and where hints appear; it suits an upright phone. |
| **Every change to a project is an edit operation**, and every suggestion, hummed take and import is a list of them. | One mechanism gives preview, accept, partial accept and undo everywhere. |
| **A pure zone** of musical logic with no browser dependencies, type-checked separately. | The same code runs in the browser, on the server and in tests; it is where most of the difficulty is, so it is where the tests are. |
| **Local suggestions first, language model second, one tray.** | Instant and offline by default; the model adds range and takes direction in words. |
| **Language models place notes on an explicit grid and never do duration arithmetic**; everything they return is validated and repaired or dropped. | Their measured weakness is exactly bar arithmetic. |
| **Python does inference only; all musical post-processing is TypeScript, run in the browser.** | One implementation of quantizing, key finding, hand splitting and arranging, shared by import, humming and the editor; and an import can be re-arranged later without another server job. |
| **The best engine for each job, every one labelled with its licence class.** | The owner's decision: personal use now, so licences do not restrict the build. Most strong audio models have non-commercial or unclear weights; the labels, and a switch that excludes the non-commercial ones, keep a later commercial audit simple. |
| **In-browser models run as single-threaded WebAssembly in a Worker; nothing depends on WebGPU.** | It is what works on an iPhone today. |
| **Local-first storage; the app is installable.** | No accounts to build. Installing matters because Safari may evict a site's stored data after a week unused. |
| **Hash routes, feature flags, no major-version upgrades inside feature work.** | Static hosting keeps working; unfinished stages merge unseen; fewer moving parts. |

## 5. The technology, at a glance

| Area | What is used |
| --- | --- |
| Audio | Web Audio through Tone.js; `AudioWorklet` capture; offline rendering for tests and audio export; Web MIDI where the browser has it; a master limiter; per-device latency calibration |
| On-device intelligence | A music-theory kernel on `tonal`; key finding from pitch-class profiles; beam search with diversity selection for melodies; k-best Viterbi harmonization; rule-based bass and accompaniment with playability limits; motif detection and transformation; groove extraction from taps; preference learning from what the author takes and rejects |
| On-device models | `onnxruntime-web` running SwiftF0 (pitch from the voice, 135 KB) and Basic Pitch (notes from audio, 230 KB) |
| Language model | Claude through the official SDK: structured outputs against a schema, prompt caching, streaming chat, a validation-and-repair loop, and an evaluation set |
| Audio analysis on the server | Source separation (Demucs), piano transcription (Transkun), beat and downbeat tracking (Beat This!), chord recognition (lv-chordia), pitch tracking on stems (SwiftF0), section boundaries (MSAF), on a scale-to-zero GPU |
| App | React, TypeScript, Vite; Zustand and Immer for the undoable project store; IndexedDB; an installable, offline-capable app |
| Engineering | Vitest, Playwright with audio-sample assertions and a fake microphone, CI, a compiler-enforced pure zone |

Every pick, its licence, its fallback and how far it was verified is in [research.md](research.md).

## 6. The stages

| # | Stage | Delivers | Needs a server | Size | Packages |
| --- | --- | --- | --- | --- | --- |
| 0 | [Foundations](00-foundations.md) | Tests, CI, an audio test harness, router, flags, shared types as code | no | small | 6 |
| 1 | [Library, hand volume, sustain](01-library-and-practice.md) | The home page; volume and mute per hand; the sustain toggle | no | medium | 5 |
| 2 | [Music core](02-music-core.md) | Musical time, theory kernel, project model with undo, compile, multi-track audio engine, storage | no | large | 7 |
| 3 | [Studio by hand](03-studio-manual.md) | The builder: step, live and drawn entry; chord track; sections; tracks; "Practice it" | no | large | 9 |
| 4 | [Drum pads and groove](04-drum-pads.md) | Pads, loop recording, step grid, tap the beat, starter grooves, tap a rhythm | no | medium | 7 |
| 5 | [Assist I: on the device](05-assist-local.md) | Key hints; the Ideas tray; melody, chord, bass and accompaniment options; evolve; coach; authorship view | no | large | 9 |
| 6 | [Assist II: the co-writer](06-assist-ai.md) | Claude as a second idea source; direction in words; critique; conversation; the brief | **yes** | large | 7 |
| 7 | [Hum it](07-hum-to-notes.md) | Voice to notes with a review screen | no | medium | 6 |
| 8 | [From a recording](08-audio-import.md) | Audio to an editable arrangement, with review against the original | **yes, with GPU** | very large | 10 (one deferred) |
| 9 | [Finishing and growing](09-polish.md) | Full offline use, pedalling as written, exports, a bigger library, audits; backlog | — | per package | 8 |

Sizes are relative to each other, not estimates of time.

**What depends on what:**

```
0 ──► 1 ──────────────────────────────────────────────┐
 └──► 2 ──► 3 ──┬──► 4 ──┐                             │
                ├──► 5 ──┼──► 6                         ├──► 9
                ├──► 7 ──┤                              │
                └────────┴──► 8  (also needs 5, 7 and 6's server)
```

Stage 1 and Stage 2 can proceed together after Stage 0 (Stage 2's audio work waits for Stage 1's mixer).
Stages 4, 5 and 7 are independent of each other once Stage 3 exists: what they share — tempo estimation,
the latency reader, rhythm slots — is deliberately built in Stages 2 and 3. Where one uses another's
feature (Hum's "tidy versions" uses Stage 5's tray; drum suggestions use Stage 4's grooves), that part is
hidden until the other stage is there.

**Milestones** — each is something to sit down and try:

| | After | The run-through |
| --- | --- | --- |
| M1 | Stage 1 | Open the app, find a song in the Library, play it with the left hand at half volume and the pedal down. |
| M2 | Stage 3 | Write a short tune by tapping keys, add chords, and practise it. |
| M3 | Stages 4 and 5 | Tap a beat to set the tempo, tap a rhythm, choose its pitches with the keys lit, ask for chords and a bass line, evolve one option, keep another for later. |
| M4 | Stages 6 and 7 | Hum a line, pick a tidied version, tell the co-writer what the chorus should feel like and choose from what it offers. |
| M5 | Stage 8 | Drop in a recording, correct the draft against the original, practise it. |

## 7. Two ways to run the build

### One agent

Work the stages in number order, and the packages within a stage in the order of its table. Merge each
package before starting the next. Stop at each milestone for the owner to try it; Stage 3 in particular
(editing on a phone) is expected to need a round of adjustment before more is built on top.

### A team of agents

One **lead** owns `contracts.md`, reviews every pull request that touches a contract or the Practice
audio path, and runs each milestone's run-through. The rest work in lanes that mostly do not share files:

| Lane | Works on | Typical packages |
| --- | --- | --- |
| Shell and Library | `src/app`, `src/library`, exports and imports | S0.3, S1.1–S1.3, S3.1, S3.8, S3.9, Stage 9 |
| Audio | `src/audio`, live input, microphone | S0.6, S1.4–S1.5, S2.5, S2.7, S3.4, S4.1–S4.3, S7.1–S7.2 |
| Music logic (pure zone) | `src/music`, `src/project`, `src/assist/core`, `src/capture/segment.ts`, `src/import/build` | S2.1–S2.4, S5.1, S5.3–S5.5, S7.3, S8.5–S8.6 |
| Editor | `src/studio`, `src/assist/ui`, review mode | S3.2–S3.7, S4.4, S5.2, S5.6–S5.9, S8.8 |
| Server and ML | `server/`, `ml/` | S6.1–S6.3, S6.6, S8.1–S8.4 |

In waves:

1. **Stage 0** — one agent for S0.1, then four in parallel.
2. **Stage 1** (two parallel tracks) alongside the pure parts of **Stage 2** (S2.1, S2.2, S2.6). The server
   scaffold (S6.1) can also start here.
3. The rest of **Stage 2**, then **Stage 3** — S3.1 and S3.2 first, then seven packages in parallel.
4. **Stages 4, 5 and 7** in parallel, plus Stage 8's spike and worker.
5. **Stages 6 and 8**.
6. **Stage 9** packages as wanted.

The music-logic lane is the one to staff first and best: it is pure, testable, parallelisable, and
everything else waits on it.

## 8. Requirements that apply to every stage

- **Practice must not get worse.** Behaviour, feel, load time. Stage 0's tests are the check.
- **Phone first.** Every screen works at 390 px wide, by touch, with 44 px targets; then desktop.
- **Speed budgets.** 60 frames per second in the waterfall and editor with a 3,000-note song on a
  mid-range phone. Key or pad to sound with no added look-ahead. Hints within 8 ms; local options within
  300 ms. Library and Practice download nothing they do not use.
- **Accessible.** Keyboard operable, labelled for screen readers, reduced motion respected, including in
  the canvas editor.
- **Private by default.** Songs, recordings and preferences stay on the device. The only things that
  leave it are what the author explicitly sends: notes and words to the co-writer, a file to the importer.
- **Honest failure.** No server, no network, no microphone, no MIDI: the feature explains itself and the
  rest of the app carries on.

## 9. Decisions that are the owner's

### Decided (15–16 November 2026)

| # | Question | Decision | What follows |
| --- | --- | --- | --- |
| 1 | Is this project commercial, or might it become so? | **Personal use now, possibly commercial later — and licences are not to restrict the build.** | Stage 8 uses the best engine for each step whatever its licence class. Every engine is still labelled with its class, and one switch excludes the non-commercial ones, so going commercial later is an audit of a table and not a rebuild. |
| 2 | Is running a server and paying per use acceptable? | **Yes.** | Stages 6 and 8 are in. Their cost estimates (5–10 US cents a co-writer request, a few cents an import) are still to be measured; the daily budgets stay as the guard. |
| 3 | YouTube links | **Paste-a-link waits for a later change.** | S8.10 stays specified but is not part of this build. File upload and "record this tab" are. |
| 4 | "L/R sound toggle" | **The Left / Right hand chips**, now a volume slider and mute button each. Confirmed on the built version, 16 November. | Built in Stage 1. Stereo split is unchanged. |
| 5 | Editor orientation | **Vertical**, like Practice. | Stage 3 as written. A sideways view remains a later option (Stage 9). |

### Still open

Each has a default the plan assumes unless told otherwise.

| # | Question | Default assumed | What it changes |
| --- | --- | --- | --- |
| 6 | **Which Claude model.** | `claude-opus-5-5`, set in configuration | Cost, speed and quality of the co-writer; a smaller model is a trade you may choose. |
| 7 | **Who may use the paid features.** | A shared access code, no accounts | S6.1. |
| 8 | **Where songs live.** | On the device, with export and backup; cloud accounts in the backlog | Whether a database and sign-in get built. |
| 9 | **Your time as a tester.** The plan needs from you: about twelve hummed recordings, five piano and five full-song test recordings you may use, two listening sessions on the assistant's output, and a try on a real phone at each milestone. | You can provide these | Stages 5–8 cannot be called done without them. |
| 10 | Genre and difficulty for the two existing songs. | Rewrite the Stars: Film & TV, 3. Divenire: Neoclassical, 4 | The first Library cards. |

## 10. Things worth knowing before you say yes

- **It is a lot.** Seventy-four work packages, and several times the size of the current codebase.
  Each stage is useful on its own, so it can stop after any milestone and still have been worth doing.
- **Editing music on a phone is the hardest design problem here**, harder than any of the machine
  learning. Stage 3 budgets for iteration with you.
- **Audio import produces a draft.** Solo piano transcribes well. A full song yields melody, chords, bass
  and beat, from which an arrangement is written; expect to correct it. Stage 8's accuracy targets are
  stated plainly for that reason.
- **Songs on an iPhone can be lost** if the site is neither installed to the home screen nor opened for
  a week, because Safari clears stored data. Stage 3 makes the app installable and prompts for backups;
  real protection is cloud sync, which is in the backlog.
- **The piano samples in use today need a credit.** The Salamander Grand Piano set is licensed CC BY 3.0
  and the app does not currently attribute it. Stage 0 adds the credit.
- **Rule-based suggestions can be correct and dull.** The plan's defences are the author's own material as
  the source of rhythm and motif, a deliberate wildcard, evolve, the language model as a second source,
  and — because nothing else catches it — listening sessions with you as acceptance criteria.
- **The research has limits.** Package versions and repositories were checked directly; licences of
  model weights on model hubs, vendor prices, and some iOS behaviours could not all be. [research.md](research.md)
  marks which is which, and the stages that depend on them start with a spike.

## Glossary

| Term | Meaning here |
| --- | --- |
| Song | The playback format: notes in seconds, a hand each. What Practice plays. |
| Project | The editable format: bars and beats, tracks, chords, provenance. What Studio edits. |
| Compile | Turn a project into a song. |
| Tick | The smallest unit of musical time; 480 to a quarter note. |
| Track | A line in a project: melody, chords, bass, drums. Each belongs to a hand for practice. |
| Edit operation | One change to a project. All changes, suggestions included, are lists of these. |
| Option | A suggestion: a label, a reason, and the edit operations it would make. |
| Idea | An option, take or tapped rhythm the author has kept for later. |
| Take | A recording of humming or tapping, before it becomes notes. |
| Hint | A lit key: a note that might come next. |
| Pure zone | Source folders with no browser or audio dependencies, shared by browser, server and tests. |
| Work package | The unit of work: one branch, one pull request, named like `S3.4`. |
| Spike | A package whose result is a written decision with measurements, not production code. |
