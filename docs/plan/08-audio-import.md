# Stage 8 — From a recording to an arrangement

**Goal:** give the app an audio file, or a YouTube link, and get back an editable piano arrangement —
notes for two hands, chords, sections, tempo — opened in Studio for checking and correcting, then saved
and practised like any other song.

**Depends on:** Stage 3 (Studio), Stage 2 (time, theory, compile), Stage 5 (accompaniment writers),
Stage 7 (note segmentation), Stage 6's server · **Size:** very large · **Flags:** `import`,
`import-youtube`

## Read this first: three facts that shape the stage

1. **Transcription is good for solo piano and rough for full songs.** The best open piano models score
   about 98% on note onsets on the standard benchmark. A band with a singer is a different problem:
   the voice, the bass and the chords have to be separated and read one at a time, and what comes out is
   a lead sheet's worth of information — melody, harmony, bass, beat — that an *arranger* then turns
   into piano writing. So this stage has two paths, and its result is always a draft to correct, never a
   finished score. The review screen is half the feature.
2. **Licences are the constraint, more than accuracy.** Most strong models here have permissive code
   and weights that are non-commercial, unclear, or trained on non-commercial data. The clearly clean
   set is small. This plan uses clean components wherever one exists, labels every engine with its
   licence class, and keeps the non-commercial ones switched off unless the owner turns them on. See
   "Engines" below and [research.md](research.md) §A. **The owner must say whether this project is, or
   may become, commercial**; the defaults assume a personal, non-commercial project.
3. **YouTube is the least dependable part.** Fetching audio from a server now needs a JavaScript runtime,
   a token-provider side-car and, from cloud addresses, often a residential proxy; it breaks several
   times a year; and YouTube's terms do not permit downloading. File upload is the primary path. The
   YouTube adapter is last, separate, off by default, and the owner's decision.

## What the user gets

- **Import** on the Library and in Studio's first-run choices: drop in an audio file (or paste a link),
  say what it is — *a piano on its own* or *a full song* — and pick how full the arrangement should be.
- A progress view that names each step as it happens.
- The result opened in Studio in **review mode**: the original recording playing in step with the
  transcription, unsure notes marked, tools to fix hands, thin the texture or change the level.
- **Save to My songs**, then practise it.
- A **quick, on-device** import for short, simple recordings, with no server at all.

## The two paths

```
                      ┌ solo piano ────────────────────────────────────┐
audio ─► normalise ─► │ piano transcription ─► notes, velocity, pedal  │ ─┐
      (ffmpeg, 44.1k) └────────────────────────────────────────────────┘  │
                      ┌ full song ─────────────────────────────────────┐  │
                      │ separate ─► vocals ─► pitch frames             │  ├─► AnalyzeResult ─► TypeScript:
                      │          ─► bass   ─► pitch frames             │  │     grid · key · chords · hands ·
                      │          ─► other  ─► polyphonic notes         │ ─┤     arrange · sections ─► Project
                      │          ─► drums  ─► hits                     │  │
                      └────────────────────────────────────────────────┘  │
both paths:            beats and downbeats · chords · section edges     ──┘
```

The Python worker does inference and answers in seconds (`AnalyzeResult`, contracts §9). Everything
musical after that — the grid, the key, quantizing, splitting hands, arranging — is TypeScript in the
pure zone, unit-tested with recorded worker output, and **runs in the browser**: the server hands back
the `AnalyzeResult`, the browser builds the project from it and keeps the result, so the arrangement
level can be changed later without another job and the quick on-device import shares the same code.

## Engines

Each engine sits behind a small adapter and is listed in a registry with its version and **licence
class**: *clean* (permissive code and weights), *grey* (permissive distribution, but weights unlicensed
or trained on non-commercial data), *nc* (non-commercial). Engines of class *nc* load only when
`ALLOW_NONCOMMERCIAL_MODELS=1`. The registry's contents are returned in `AnalyzeResult.engines` and
stored in the project, so any import can be traced to what produced it.

| Step | Default | Class | Fallback | Optional, off by default |
| --- | --- | --- | --- | --- |
| Piano notes, velocity, pedal | Transkun v2 | grey | Kong et al. `piano-transcription-inference` (grey); Basic Pitch (clean, weaker, no pedal) | — |
| Separation | Demucs `htdemucs_ft` through `audio-separator` | grey | plain `demucs` on CPU | RoFormer checkpoints (unclear) |
| Beats, downbeats | Beat This! | clean | librosa beat tracker (no downbeats) | — |
| Chords | lv-chordia | clean | `detectChord` per bar on the transcribed notes | — |
| Vocal and bass lines | SwiftF0 pitch frames on the stem, then Stage 7's `segmentTake` | clean | Basic Pitch on the stem | — |
| Inner parts | Basic Pitch on the "other" stem | clean | none: voice the chord symbols | — |
| Drums | Onsets on the drum stem, classed kick / snare / hat by frequency band | clean | none | ADT_STR (share-alike); ADTOF (nc) |
| Section edges | MSAF (edges and A/B/C labels) | clean | none: the author marks sections | all-in-one, SongFormer (nc; name verse and chorus) |
| Key | `detectKey` on the notes, in TypeScript | — | — | — |
| Hands | Dynamic-programming split, in TypeScript | — | — | midi2hands (clean) |
| One-shot alternatives | — | — | — | MuScriptor (nc; whole mix to parts); Etude or Pop2Piano (nc or unclear; "AI piano cover") |

Notes for whoever builds the worker:

- **These tools do not share an environment.** Their Python and library pins conflict (one needs
  Python ≤ 3.11, another ≥ 3.12; two pin different major versions of NumPy). Give each engine group its
  own image or virtual environment and have a thin gateway fan out and merge. Do not try to make one
  environment hold them all.
- **Check names before installing.** Several PyPI names (`yourmt3`, `mt3`, `skey`) are not the projects
  they sound like, and several of the right projects are not on PyPI at all.
- Every row above was checked against its repository in November 2026, but weights licences hosted on
  model hubs could not all be confirmed. Confirm each before shipping it, and record what you find in the
  registry.

## TypeScript post-processing — `src/import/build/` (pure zone)

`buildProject(analysis, { kind, level })` — `kind` is `piano` or `song`, `level` is one of the four below.
Vocal and bass contours become notes through Stage 7's `segmentTake` and `placeNotes`.

1. **Grid.** Build a `TimeMap` from beats and downbeats: meter from beats per bar; a tempo event per bar,
   smoothed so that ordinary human wobble does not become a hundred tempo changes; `gridOffset` at the
   first downbeat.
2. **Quantize** onsets to sixteenths, or to triplets where a beat's onsets fit them better; keep the
   remainder in `offset` so the performance's feel survives.
3. **Key** from the notes.
4. **Chords.** Snap the worker's chord spans to beats and write them as `ChordEvent`s with their
   confidence; where the worker gave none, name chords from the notes bar by bar.
5. **Solo piano → hands.** A dynamic-programming split that minimises, over the piece, hand-span
   violations, hand crossings and jumps, with pitch as a prior (low notes left). The melody and
   accompaniment go to two tracks by hand.
6. **Full song → arrange.** Vocal line to the Melody track in the right hand, placed in a comfortable
   register. Left hand written from the chord track and the bass line by Stage 5's writers at the chosen
   **level**:

   | Level | Right hand | Left hand |
   | --- | --- | --- |
   | Lead sheet | Melody | Chord symbols only, no notes |
   | Easy | Melody | Roots, or root and fifth, changing with the chords |
   | Intermediate | Melody with a harmony note at phrase ends | Broken chords or a pattern that follows the song's rhythm |
   | Full | Melody with fills from the inner parts | The transcribed bass line plus chord tones within reach |

   Drum hits become a drum track, with repeated bars folded into patterns.
7. **Sections** from the edges, snapped to downbeats, labelled A, B, C … unless an engine named them.
8. **Assemble** the `Project`: every note `origin: "imported"` with its `conf`; `source` filled in with the
   engines, the level, the warnings (placed at their ticks) and the id of the stored `AnalyzeResult`.

For a solo-piano import, the same level control **simplifies** rather than arranges: as played → thinned
(doubled notes and inner voices removed, hand spans limited, ornaments shorter than 60 ms dropped) →
easy (melody with bass notes or shell chords).

## Server side

- **Routes** per contracts §9 on the Stage 6 server: create a job from an upload or a link with its `kind`,
  read its status (polled every two seconds; the finished job carries the `AnalyzeResult`), cancel it.
- **Limits:** 50 MB and twelve minutes per file; one running job per access code; the same daily budget
  mechanism as Stage 6, counted in GPU-seconds.
- **Files:** uploads go to temporary storage, are deleted when the job's result has been fetched or
  after 24 hours, and are never used for anything else.
- **Worker hosting:** a container service that scales to zero and bills by the second (Modal and RunPod
  Serverless both fit a bursty job of a minute or three; an always-on GPU does not). Cost per import is
  estimated at a few US cents; the choice of provider and the first measured cost are a spike
  (`docs/plan/spikes/ml-hosting.md`) that the owner signs off, since it is their money. Locally the
  worker runs under Docker Compose on CPU, slowly, which is enough to develop against.
- **Progress** stages reported by the server: uploading, separating, transcribing, finding the beat,
  finding chords. Arranging then happens in the browser and takes a second or two.

## Quick import on the device — `src/import/quick/`

For a short, simple recording — a piano phrase, a single instrument — with no server and nothing
uploaded:

- Basic Pitch's official ONNX model (230 KB, Apache-2.0) on the same `onnxruntime-web` set-up as Stage 7,
  with its note post-processing ported from the TypeScript reference implementation (Apache-2.0). Do not
  use the published `@spotify/basic-pitch` package: it is pinned to an old TensorFlow.js and fails on
  recent iPhones.
- Tempo from the note onsets (the Tap the beat analysis), then the same TypeScript post-processing as the
  server path, without chords-from-audio or separation.
- Limited to two minutes. Labelled honestly: "Quick — on this device. Best for one instrument."

## Review mode in Studio — `src/import/review/`

- **Listen against the original.** The uploaded file is kept on the device and played in step with the
  transport, with a balance control between the recording and the piano. It follows speed changes with
  pitch preserved. For a YouTube import the reference is the embedded YouTube player kept in step by
  seeking; no audio is stored.
- **Unsure notes** are drawn hollow. A confidence slider hides everything below a threshold as a preview;
  **Remove hidden** makes it real, as one undo step.
- **Hands:** lasso a group of notes and send them to the left or the right.
- **Level** can be changed after import, by running `buildProject` again on the stored `AnalyzeResult`.
  Parts the author has edited are left alone; only untouched generated material is rewritten, and the
  change can be undone.
- **Section by section:** each section has a "checked" tick (`PSection.checked`), so a long song can be
  worked through in sittings.
- **Warnings** from the analysis are shown where they apply: "tempo wanders in this section", "no clear
  vocal line found here", "these chords are a guess".
- Leaving review mode is just saving: the project is an ordinary project.

## YouTube

Links were asked for, so they are specified here, in two forms.

**Record this tab** — part of the import screen (S8.7), needing nothing from YouTube's servers beyond
ordinary playback: in desktop Chrome and Edge, `getDisplayMedia` with audio lets the author play any tab
and capture what they hear, which then goes through the upload path like any file. Offered wherever the
browser supports it; absent, with a one-line reason, where it does not (Safari, phones).

**Paste a link** — `server/youtube.ts`, `ml/fetch/` (S8.10). Built last, after the owner has read the
points below and confirmed they still want it. Kept in one adapter so it can be removed without touching
the rest.

- `yt-dlp` on the server, with the JavaScript runtime and token-provider plugin it currently requires
  (the plugin is GPL-licensed and runs as a separate process). Expect requests from cloud addresses to
  be challenged; a residential proxy may be the only fix, and that is a recurring cost.
- Audio only, held only for the job, same deletion rules as uploads.
- Enabled by `ENABLE_YOUTUBE=1` on the server and the `import-youtube` flag in the app. When it fails —
  and it will, periodically — the message says so and offers file upload.
- For a link import the review screen's reference is the embedded YouTube player, kept in step by
  seeking; the audio itself is not kept.

Not legal advice, but the plan would be incomplete without saying it: YouTube's terms of service do not
allow downloading, and a transcription of someone else's song is that person's work arranged. Imported
songs therefore stay private to the device by default and are not added to the public song bank by the
app; publishing one is the owner's act and responsibility.

## Work packages

| Id | Deliverable | Owns | Needs |
| --- | --- | --- | --- |
| S8.1 | **Spike:** worker hosting and cost; confirm weights licences for the default engines; one end-to-end run of each path on three test songs, with timings | `docs/plan/spikes/` | — |
| S8.2 | Worker gateway, engine registry with licence classes, engine images: beats, chords, piano transcription | `ml/` | S8.1 |
| S8.3 | Worker engines for full songs: separation, stem pitch frames, inner parts, drums, section edges | `ml/engines/` | S8.2 |
| S8.4 | Server job routes, upload storage and deletion, progress stream, limits | `server/import.ts` | S6.1, S8.2 |
| S8.5 | Post-processing for solo piano: grid, quantize, key, chords, hand split, simplify levels, assemble | `src/import/build/` | S2, S7.3 |
| S8.6 | Post-processing for full songs: stems to melody and bass, arrange at four levels, drums, sections | `src/import/build/arrange.ts` | S8.5, S5.5 |
| S8.7 | Import screen: file drop, record-this-tab where supported, type and level choice, progress, errors, running `buildProject` on the result and storing the `AnalyzeResult`; entry points in Library and Studio | `src/import/ImportScreen.tsx`, `TabCapture.tsx` | S8.4, S8.5 |
| S8.8 | Review mode: reference playback in step, confidence filter, hand lasso, level switch, section ticks, warnings | `src/import/review/`, `src/studio/layers/review.ts` | S8.5, S3 |
| S8.9 | Quick on-device import | `src/import/quick/` | S7.2, S8.5 |
| S8.10 | Paste-a-link import through `yt-dlp` — after the owner confirms | `server/youtube.ts`, `ml/fetch/` | S8.4 |

S8.5 and S8.6 are pure TypeScript and can be built against recorded `AnalyzeResult` fixtures before the
worker exists, in parallel with S8.2–S8.4. S8.9 needs no server and can be built any time after Stage 7.

## Fixtures and measures

- **Solo piano:** five recordings with a known score — include the two bank songs' source performances
  if the owner has the audio, since their transcriptions already exist as ground truth — plus public
  benchmark excerpts for the worker alone.
- **Full songs:** five songs with a known lead sheet (melody, chords, key, tempo) that the owner has the
  right to use for testing.
- **Measures:** note F-measure for piano (onset within 50 ms); beat F-measure (within 70 ms); chord
  accuracy as the share of time with the right root and major/minor quality; melody note F-measure for
  full songs (onset within 100 ms); key right or relative; share of notes given to the right hand that
  the reference also gives to the right hand.

## Acceptance criteria

**Pipeline**

1. Each path runs end to end on its five fixtures and returns an `AnalyzeResult` that validates against
   the contract; the engines used and their licence classes are in the result.
2. With `ALLOW_NONCOMMERCIAL_MODELS` unset, no engine of class *nc* is loaded, downloaded or present in
   the default images.
3. Solo piano, through the default engine, on the fixtures: note F-measure at least 0.90; beat F-measure
   at least 0.85; hands agree with the reference for at least 90% of notes; key right for at least four
   of five.
4. Full songs on the fixtures: beat F-measure at least 0.85; chord accuracy at least 0.70; melody note
   F-measure at least 0.60; key right or relative for at least four of five. (These are honest numbers
   for this problem, not a typo: the result is a draft.)
5. The post-processing is deterministic: the same `AnalyzeResult` gives a byte-identical `Project`.
6. Every arranged left-hand part passes Stage 5's playability checks at every level; changing level
   re-runs `buildProject` on the stored result with no server request and leaves author-edited notes
   untouched.
7. A four-minute song completes in under four minutes on the chosen GPU host, cold start included; the
   measured cost per import is recorded.

**Product**

8. An upload over the size or length limit is refused before uploading with the limit stated; a failed
   job says which step failed and leaves nothing behind on the server.
9. Uploaded audio is gone from the server once the result is fetched, and in any case within 24 hours
   (a test inspects storage).
10. In review mode the recording and the transcription stay within 50 ms of each other over a
    four-minute song, at 100% and at 50% speed, and after seeking.
11. Hiding notes below a confidence threshold changes nothing in the project until Remove hidden is
    pressed; that is one undo step.
12. An imported project saves, reopens, compiles and plays in Practice with two hands; its notes carry
    `origin: "imported"`, and the authorship view counts notes the author corrected as changed by them.
13. Quick import transcribes a thirty-second single-instrument fixture in under thirty seconds on a
    mid-range phone (throttled Chromium, per `agent-protocol.md`) with no network requests carrying audio.
14. With `import` off, no import code is downloaded. With `import-youtube` off or `ENABLE_YOUTUBE` unset,
    the link field is absent and the server refuses link jobs.
15. Imported songs appear only under My songs; nothing in the app writes them to `public/songs/`.
16. Record this tab, by hand in desktop Chrome: thirty seconds captured from a tab playing music arrives
    in the import flow as a file and completes a job. In a browser without tab-audio capture the option
    is absent and says why.
17. With the link adapter enabled: a link to a short test video the owner may use completes a job and
    yields a valid `AnalyzeResult`; a link that cannot be fetched fails within sixty seconds with a message
    that names the fetch step and offers file upload.

## Test plan

- Worker: per-engine smoke tests on a ten-second clip; the fixture measures above, run on request (they
  need the GPU host).
- Post-processing: unit tests on recorded `AnalyzeResult` files — grid building with a wandering tempo,
  triplet detection, hand split on textbook cases (crossing hands, wide left-hand arpeggios), each
  arrangement level, determinism.
- Server: job life cycle with a stub worker; deletion; limits.
- Playwright: import with a mocked job API from file drop to review; reference playback in step; the
  confidence filter; flags off.
- By hand: a real phone on a slow connection uploading a 30 MB file.

## Risks

- **Expectations.** "Turn this YouTube video into sheet music" sounds like one button. Say what kind of
  result to expect before the import starts, show confidence honestly after, and make correcting fast.
- **Model drift and breakage.** Engines are pinned by version in their images; the registry and the
  fixture measures are how an upgrade is judged.
- **Cost surprises** from a GPU left running. Scale-to-zero only, a budget alarm on the provider, and the
  daily cap.
- **Licence audit.** If the project's status changes, the registry's licence classes are the list to go
  through. Until the owner has answered the commercial question, treat *grey* as acceptable for personal
  use only.
- **Separation artefacts** leak the voice into other stems and the other way round, which shows up as
  ghost notes. The confidence filter and the level control (which leans on chords rather than raw notes)
  are the mitigation.

## Build notes

_Empty._
