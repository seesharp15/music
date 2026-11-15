# Technology research

What the technology choices in this plan rest on. Gathered on 15 November 2026 by checking package
registries and project repositories directly; where only a search snippet or memory was available it
says so. Tools in this area move fast: **treat every row as a strong starting point to confirm when you
build, not as a guarantee**, and write what you find into the stage's Build notes.

How to read the **Checked** column: **yes** — read from the npm or PyPI registry, or the project's own
repository, on that date. **partly** — the code and package were checked but something that matters
(usually the licence of the model weights, hosted on a model hub that could not be reached) was not.
**no** — from search snippets or memory.

- [A. Audio to notes (server)](#a-audio-to-notes-server)
- [B. Audio and machine learning in the browser](#b-audio-and-machine-learning-in-the-browser)
- [C. Assistive composition](#c-assistive-composition)
- [D. Core libraries and versions](#d-core-libraries-and-versions)

---

## A. Audio to notes (server)

Used by Stage 8. The owner has since decided that licences are not to restrict the build while it is for
personal use (README §9), so Stage 8 uses non-commercial engines where they are better; the classes
recorded here are what a later commercial audit would read.

The headline: **few strong models have commercially clean weights.** Permissive code
often ships with weights that are non-commercial, unlicensed, or trained on the MAESTRO piano dataset,
which is itself CC BY-NC-SA. The clearly clean set is small: Beat This!, lv-chordia, SwiftF0, Basic
Pitch, midi2hands, MSAF, music21.

| Task | Pick | Licence, code / weights | Fallback | Checked |
| --- | --- | --- | --- | --- |
| Solo piano transcription | **Transkun v2** — `transkun` 2.0.1. README reports onset F1 98.3, with offsets and velocity 93.0, pedal 95.4 | MIT / shipped in the package with no separate terms; MAESTRO-trained (grey) | Kong et al. `piano-transcription-inference` 0.0.6 (MIT; weights on Zenodo, licence unconfirmed); Basic Pitch `basic-pitch` 0.4.0 (Apache-2.0, clean, no pedal, weaker) | partly |
| Source separation | **Demucs v4** `htdemucs_ft` via `audio-separator` 0.48.0. The maintained Demucs is `adefossez/demucs` (`demucs` 4.1.0); the original repository is archived | MIT / the author says the weights' licence "is not clear" (grey) | `demucs -n htdemucs` on CPU; Open-Unmix (weights non-commercial) | partly |
| Beats and downbeats | **Beat This!** — `beat-this` 1.1.0 | MIT for code and weights, stated explicitly | librosa `beat_track` (no downbeats) | yes |
| Chords from audio | **lv-chordia** 1.1.0 — about 170 chord types with sevenths and inversions | MIT including weights | BTC (MIT, unmaintained); chords named from the transcribed notes | yes |
| Vocal and bass line | **SwiftF0** — `swift-f0` 0.3.0, a 14,386-parameter ONNX model | MIT | Basic Pitch on the stem | yes |
| Drums | Onset and band-energy heuristic on the drum stem | — | ADT_STR (CC BY-SA 4.0); ADTOF (non-commercial) | yes |
| Section boundaries | **MSAF** — `msaf` 0.1.82: boundaries and A/B/C labels, no verse/chorus names | MIT | Author marks sections by hand | yes |
| Named sections (verse, chorus) | all-in-one; SongFormer | Weights non-commercial | — | partly |
| Key | Krumhansl-style profile on the notes (in TypeScript here; `music21` in Python) | — | — | yes |
| Left and right hands | Own dynamic-programming split | — | `midi2hands` 0.0.3 (MIT, ONNX, CPU) | yes |
| Whole mix in one model | MuScriptor 0.4.0 (July 2026): parts, beats, tempo map, drums | MIT / CC BY-NC 4.0, gated | — | partly |
| Song to "piano cover" in one step | Etude (2026); Pop2Piano | Weights non-commercial; Pop2Piano has no licence file and needs an AGPL library | — | partly |
| Fetching YouTube audio | `yt-dlp` 2026.10.26 | Unlicense; its token-provider plugin is GPL-3.0 | File upload | yes |

**Traps**

- **Dependency conflicts between engines.** Basic Pitch needs Python ≤ 3.11 and old TensorFlow; librosa
  1.0 needs ≥ 3.12; `midi2hands` pins NumPy 1.26 while `audio-separator` needs NumPy 2. One image or
  environment per engine group.
- **Package-name traps.** PyPI `yourmt3`, `mt3` and `skey` are not the official projects. ADTOF,
  Aria-AMT, hFT-Transformer, RMVPE, GAME, BTC and PM2S have no PyPI package.
- **madmom**, long the standard beat tracker, has had no release since 2018, breaks on current Python,
  and its models are non-commercial. Do not build on it.
- **Onsets and Frames / Magenta** is archived.
- **`yt-dlp` on a server** now needs an external JavaScript runtime (Deno) and solver scripts; most
  clients need a per-video token from a provider side-car; requests from cloud addresses are widely
  reported to be challenged ("sign in to confirm you're not a bot"); breakage is frequent — a wave of
  403 errors in August 2026 needed a new release to fix.
- **Hosting.** Scale-to-zero GPU by the second (Modal, RunPod Serverless) fits a job of one to three
  minutes; rough cost one to six US cents an import. Prices are from third-party summaries, not the
  vendors' pages.

## B. Audio and machine learning in the browser

Used by Stages 2, 3, 4, 7 and the quick import in Stage 8.

| Need | Pick | Why, and what to avoid | Checked |
| --- | --- | --- | --- |
| Live pitch display | **`pitchy`** 4.1.0 (McLeod; MIT; 33 KB) | Answers within one window. Avoid `pitchfinder` (GPL) and `aubiojs` (GPL upstream, stale). | yes |
| Pitch for transcription | **SwiftF0** ONNX (135 KB, MIT), self-hosted | Best of 19 trackers on a 2026 benchmark with noise and microphone conditions (written by its author, and not specific to humming). 176 ms look-ahead; range tops out near 2.1 kHz, so very high whistles need the McLeod tracker. | yes |
| Contour to notes | Own code, starting from the SwiftF0 demo's 76-line `notes.ts` (MIT) | No established JavaScript library exists for this. | yes |
| Polyphonic audio to notes | Basic Pitch's official **`nmp.onnx`** (230 KB, Apache-2.0) with post-processing ported from `basic-pitch-ts` | Do **not** use `@spotify/basic-pitch` 1.0.1: last published 2022, pinned to TensorFlow.js 3, fails on iPhone 14–16 under WebGL. | yes |
| ML runtime | **`onnxruntime-web`** 1.31.1 — WebAssembly-only build, one thread, in a Worker | TensorFlow.js has had no stable release since October 2024. ONNX Runtime's WebGPU path is not officially supported on Safari and has an open runaway-CPU report on Safari 26. Multi-threaded WebAssembly needs cross-origin-isolation headers that break cross-origin sample loading. | yes |
| WebGPU | Do not depend on it | Chrome and Edge 113+, Chrome Android 121+, Safari 26+ only, Firefox partial. | yes |
| Microphone | `getUserMedia` directly → `AudioWorklet` → Worker | Tone 15.1's `UserMedia` takes no constraints. Safari honours only `echoCancellation`. | yes |
| Instant triggering | Trigger at the context's current time (`Tone.immediate()`), on `pointerdown` | Tone's default look-ahead is 0.1 s: right for sequenced playback, wrong for pads and keys. Firefox ignores `latencyHint`. | yes |
| Recording latency | `baseLatency` + `outputLatency`, plus a tap-along calibration | `outputLatency` needs Safari 18.4+; reported values are unreliable, hence the calibration. | yes |
| MIDI keyboards | Raw Web MIDI API behind feature detection | Chrome, Edge, Android: yes. Firefox desktop: behind a permission add-on. **Safari and every iOS browser: no.** | yes |
| Drum and instrument samples | Self-hosted **CC0** one-shots: Sonic Pi's sample set, VCSL, Virtuosity Drums | Avoid sets with no licence (Tone's own `drum-samples`), share-alike sets (MusyngKite, FatBoy), and GPL engines (`webaudiofont`). `smplr` 1.2.0 (MIT) and `spessasynth_lib` 4.4.8 (Apache-2.0) are sound options if a sampler library is wanted. | yes |
| The existing piano samples | Salamander Grand Piano | **CC BY 3.0: attribution is required** and is not shown today. | yes |
| Piano-roll editor | Build it | No embeddable, maintained component exists; `signal` (MIT) is a good design reference, not a dependency. | yes |
| Local storage | `idb` 8.0.4 for projects; audio in the origin-private file system with IndexedDB blobs as fallback | — | yes |

**Traps on iPhone and iPad** (several come from WebKit bug reports seen only as snippets — test on a
device):

- No Web MIDI in any browser.
- The ring/silent switch mutes Web Audio unless the audio session type is set to `"playback"`
  (`navigator.audioSession`, Safari 16.4+).
- Opening the microphone changes output volume or route; microphone and context sample rates can differ.
- **Stored data can be evicted** after seven days without use unless the site is installed to the home
  screen. For an app whose users' songs live in local storage this is the single most important trap;
  it is why Stage 3 makes the app installable and nags about backups.

## C. Assistive composition

Used by Stages 5 and 6.

### How people keep ownership of suggestions

- **Hookpad's Aria** (the closest precedent): select a span, ask, audition alternatives, accept
  explicitly, then edit. Users accepted about 74,000 of 318,000 suggestions — roughly one in four — and
  reported feeling more in control than with text-to-music tools. *Design for cheap rejection.*
- **Cococo** (Louie et al., CHI 2020): giving people per-voice control and "sliders" for the model raised
  their sense of ownership and of their own ability.
- **AI Song Contest** teams (Huang et al., 2020) wanted tools that are decomposable and steerable rather
  than end-to-end.
- **Interactive evolution** (GenJam, DarwinTunes): works, and is limited by listener fatigue — show few
  candidates over few rounds.
- The contrasting pattern — a prompt in, finished audio out — is the one musicians most often describe
  as taking authorship away.

Guidelines drawn from these, all reflected in Stage 5's rules: short and local suggestions; insert only
on explicit accept; never overwrite; three to five audible alternatives labelled by what differs; steer
with parameters as well as words; separate, lockable lanes for melody, chords and bass; explain in the
theory the app teaches; mark what came from the assistant; hints on request, not flickering constantly;
evolve by small, controllable mutation.

*(All from snippets of the cited papers and product pages, not full texts.)*

### What makes a melody stick — basis for the Melody coach

| Feature | Finding | Source |
| --- | --- | --- |
| Common overall contour, unusual turning points | Earworm tunes tend to have a typical global shape and atypical slopes between its turning points, and to be faster | Jakubowski et al., 2017 |
| Note density and rate of contour change | Both predict how well a new melody is remembered | Müllensiefen & Halpern, 2014 |
| Surprise and uncertainty | Liking peaks at intermediate surprise, and depends on both | Gold et al., 2019; Cheung et al., 2019 |
| Small intervals; a turn after a leap | Core expectations listeners hold | Schellenberg, 1997, simplifying Narmour |
| Repetition | Repeating material makes it sound more musical | Margulis, 2014 |
| Syncopation | Moderate syncopation rated most pleasurable; a 2024 replication did not find the inverted U | Witek et al., 2014 |

Effects are modest and some are contested. That is the reason the coach describes and never grades.

### Language models and written music

- General models reason poorly over whole songs (Zhou et al., ISMIR 2024).
- A 2025 benchmark on ABC notation: above 90% on metadata and bar counting, 28–45% on next-bar and
  sequencing tasks; detecting a bar whose durations do not add up was among the hardest.
- No public benchmark was found for current Claude models generating or editing music, nor for
  bar-structured JSON against other encodings. Hence Stage 6's own evaluation, and the grid notation with
  explicit positions.

### Trained music models

| Model | Licence, code / weights | Size | Does | Runs in a browser? | Checked |
| --- | --- | --- | --- | --- | --- |
| **Anticipatory Music Transformer** | Apache-2.0 / Apache-2.0 | 128M, 360M, 780M | Continuation, infilling, accompaniment to a melody; the family behind Hookpad's Aria | Demonstrated with WebGPU; a large download | partly |
| **Magenta ImprovRNN** (`chord_pitches_improv`) | Apache-2.0 | 5.6 MB | Chord-conditioned melody continuation | Yes, but the library is frozen on TensorFlow.js 2 | yes |
| Aria (EleutherAI) | Apache-2.0 / Apache-2.0 | about 0.7B | Expressive solo-piano continuation; no chord control | No | yes |
| MIDI-GPT | MIT / non-commercial | about 20M | Bar infilling with controls | No | partly |
| MusicLang Predict | GPL-3.0 / contact for commercial | — | Chord-conditioned continuation | Treat as server-only | yes |
| Text2midi, NotaGen, MIDI-LLM | Permissive code | 110M–1B | Whole pieces from text; no editing in place | No | yes |

Neither of the two candidates is required by the plan; Stage 6 treats them as spikes.

### Data for fitted statistics

Stage 5 starts from hand-set tables. If they are later fitted to data, use only these:

| Source | Content | Licence | Ship derived statistics? |
| --- | --- | --- | --- |
| McGill Billboard | Chords for about 890 chart songs | CC0 | Yes |
| POP909 | 909 pop songs: melody, chords, key, beats | MIT | Yes, with attribution |
| OpenEWLD | Public-domain lead sheets | Public domain (some metadata fields non-commercial) | Yes |
| PDMX (`no_license_conflict` subset) | Public-domain scores | As labelled | Yes |

**Do not use** Hooktheory's TheoryTab data: it is proprietary, and its terms forbid scraping, bulk
download and data mining. Chordonomicon (666,000 progressions) carries a permissive label but is
scraped from user-contributed charts its publishers do not own; aggregates only, if at all. Lakh MIDI is
a grey area for the same reason.

### `tonal`

`tonal` 6.5.1 (MIT, active) covers notes, intervals, scales, chord detection with inversions, keys, Roman
numerals, progressions, voicings and voice leading. It does **not** find a key from a melody or
harmonize; those are written here (Stage 2 and Stage 5).

## D. Core libraries and versions

Registry versions on 15 November 2026. All permissively licensed.

| Package | Version | Used for |
| --- | --- | --- |
| `tonal` | 6.5.1 | Theory kernel |
| `zustand` / `immer` | 5.1.0 / 11.2.10 | Project store and undo |
| `idb` | 8.0.4 | IndexedDB |
| `wouter` | 3.13.0 | Routing |
| `zod` | 4.6.7 | Schemas, shared with the server |
| `vitest` | 5.1.0 | Unit tests (needs Vite ≥ 6.4; the repository is on 6.4.5) |
| `@playwright/test` | 1.65.1 | End-to-end and audio tests |
| `onnxruntime-web` | 1.31.1 | In-browser models |
| `pitchy` | 4.1.0 | Live pitch |
| `@tonejs/midi` | 2.0.28 | MIDI files (dormant since 2022 but sound; `midifile-ts` 1.5.2 is the fallback) |
| `abcjs` | 6.7.2 | Lead-sheet rendering |
| `hono` | 4.13.18 | Server |
| `@anthropic-ai/sdk` | 1.8.0 | Claude |

The app itself is on React 18.3, Vite 6.4, TypeScript 5.6 and Tone 15.1. Newer majors of the first
three exist; upgrading is a separate chore (Stage 9 backlog), not part of any feature.
