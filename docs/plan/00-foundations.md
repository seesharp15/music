# Stage 0 — Foundations

**Goal:** make the repository safe to build on in parallel: tests, CI, a router shell, the shared types
as code, and written-down conventions. Nothing the user can see changes except the URL shape.

**Depends on:** nothing · **Unlocks:** every other stage · **Size:** small · **Flag:** none

## Why this comes first

Today the repository has no tests, no linter and no CI, one screen, and the site redeploys on every push
to the default branch. That is fine for one person changing one screen. It is not fine for several agents
changing the audio engine, the song format and the app shell at once. This stage is the guard rail: after
it, a change that breaks Practice fails a check instead of reaching the music stand.

## Scope

**In:** test tooling and CI; an audio test harness; tests that pin down how the app behaves today; hash
router and lazy route chunks; feature flags; an error boundary; contract types as code; the pure-zone
compiler check; a `CLAUDE.md` for future build sessions.

**Out:** any new feature, any visual change to Practice, any dependency major upgrade.

## Design

### Tooling

| Need | Choice | Notes |
| --- | --- | --- |
| Unit and component tests | Vitest + `@testing-library/react` + `jsdom` | Colocated `*.test.ts(x)` files. Current Vitest needs Vite 6.4 or later; the lockfile is on 6.4.5, so no upgrade is needed. |
| End-to-end and audio tests | `@playwright/test`, Chromium project plus a WebKit project for the smoke test only | WebKit because the main device is an iPhone. |
| Lint and format | ESLint flat config with `typescript-eslint`, `eslint-plugin-react-hooks`; Prettier | Match the existing style: 2 spaces, double quotes, semicolons, 120 columns. Formatting the existing files is its own commit, with nothing else in it. |
| CI | GitHub Actions: `typecheck`, `lint`, `test`, `build`, `test:e2e` on pull requests and the default branch | Cache npm and Playwright browsers. |
| Scripts | `npm run lint`, `npm test`, `npm run test:e2e`, `npm run check` (all of the above) | |

### Pinning down today's behaviour

Before anything is refactored, tests record what the app does now. These are the cases worth having:

- `playRange` — loop only, window only, both overlapping, loop outside the window, tiny overlaps under
  the minimum loop length.
- `normalize` — rejects unknown formats, drops zero-length and out-of-range notes, defaults velocity,
  sorts, derives duration.
- `analyzeRhythm`, `momentIndexAt`, `positionOf`, `countLabel` — eighths versus sixteenths detection,
  moments merging within 30 ms, bar and count labels.
- `keyRangeFor`, `keySpan`, `layoutKeyboard`, `noteName`.
- The speed slider's `speedToPos` / `posToSpeed` / `snapRate` (export them from `Practice.tsx` or move
  them to a small module).
- **Practice smoke test (Playwright):** open a song, press play, confirm the playhead advances, set a
  loop from a section, confirm it wraps, step forward two moments, change speed, reload and confirm the
  position, loop and speed come back.
- **Scheduling test (Playwright):** with a three-note fixture song and a recording sink (below), collect
  the time the player asks for each note at 100% and 50% speed and across a loop wrap; assert they are
  right to within 5 ms. This is the test that protects the scheduler through Stage 1 and Stage 2.

Test builds expose `window.__app = { player }` (later also `store`) so Playwright can read state without
scraping the canvas. The hook exists only when `import.meta.env.MODE !== "production"` or the
`test-hooks` flag is on.

### Audio test harness

Later stages have acceptance criteria about timing and about sound, and today neither can be asserted:
`Player` calls Tone instruments directly on Tone's global context and schedules from a `setInterval`.
Two small pieces fix that.

- **The sink seam.** Introduce the `Sink` interface (contracts §6) and have `Player` call a sink for
  every note and click rather than an instrument. The default sink is today's instruments and channels,
  moved behind the interface with no change in behaviour. A test installs a recording sink through
  `window.__app` and reads back pitch, time, duration and hand for every call. This is the only change
  to `player.ts` in Stage 0, and the seam is what Stage 2 grows into the `AudioEngine`.
- **Offline render.** `renderOffline(song, { sound, seconds })` in `src/audio/testing.ts` (Stage 1 adds
  `mix` and `sustain` to its options) builds the same instruments and buses inside `Tone.Offline`, schedules every note of the song straight
  through the sink — the real-time loop cannot run offline — and returns the samples. Helpers beside it
  measure level over a time window (RMS, in dBFS), peak, and the largest jump between neighbouring
  samples. Stage 1's volume, mute, sustain and limiter criteria are written against these.

The scheduling test covers *when*; the offline render covers *what it sounds like*.

### App shell

- **Router:** `wouter` with its hash location hook. Routes per contracts §11. Only `#/` and
  `#/play/:songId` render anything in this stage; the rest are registered in later stages.
- **Legacy links:** a hash that does not start with `#/` and matches a song id redirects to
  `#/play/<id>` with `history.replaceState`, so the two links already in the wild keep working.
- **Until Stage 1 lands a Library,** `#/` redirects to `#/play/<first song>`, which is exactly today's
  behaviour.
- **Lazy routes:** each top-level screen is a `React.lazy` chunk. Library and Practice must not pull in
  Studio code, ML runtimes or anything else they do not use.
- **Error boundary** around each route: a failed chunk load or a render error shows a message with a
  "back to library" link instead of a blank page.
- **Flags:** `src/app/flags.ts` exporting `flag(name): boolean` and `useFlag(name)`, reading
  `piano-tutor:flags` and `?flags=`.

### Contracts as code

- Extend `src/song/types.ts` to the v2 `Song` and `SongIndexEntry` (contracts §2). `normalize()` accepts
  `"piano-song/v1"` and `"piano-song/v2"`. No behaviour change: the new fields are optional and nothing
  reads them yet.
- Two moves so that `src/song/` can join the pure zone: `SoundId` goes from `src/audio/player.ts` to
  `src/song/types.ts` (the player re-exports it), and `normalize` goes from `src/song/load.ts`, which
  fetches, to its own `src/song/normalize.ts`.
- Add `src/project/types.ts` and `src/assist/core/types.ts` with the types from contracts §3, §5 and §7,
  and `src/music/time.ts` with `PPQ` and the `TimeMap` interface. Types only; implementations arrive in
  Stage 2. One exception: `AssistProvider` goes in `src/assist/providers/types.ts`, outside the pure zone,
  because its `AbortSignal` parameter is a platform type the pure zone's compiler settings do not have.
- Add `tsconfig.core.json` covering the pure zone (contracts §12) with `"lib": ["ES2022"]` and no DOM, and
  include it in `npm run typecheck`. Add an ESLint `no-restricted-imports` rule for the same directories
  forbidding `react`, `react-dom`, `tone` and anything under `src/audio`, `src/components`, `src/studio`.

### Written conventions

- `CLAUDE.md` at the repository root: what the app is, the commands, where the plan lives, the pure-zone
  rule, the "Practice must not regress" rule, and the done checklist from `agent-protocol.md`. Keep it
  under a page.
- `docs/plan/CHANGELOG.md` (contract changes) and `docs/plan/spikes/` (decision notes) already exist;
  keep them up to date from here on.
- Update `README.md`: the new scripts, and a pointer to `docs/plan/`.
- **Credit the piano samples.** The Salamander Grand Piano samples the app plays are licensed CC BY 3.0,
  which requires attribution, and the app shows none. Add a credit line to `README.md` and a small
  "Credits" link in the app's footer or top bar naming the samples, their author (Alexander Holm) and the
  licence. Later stages add their own samples and models to the same place.

## Work packages

| Id | Deliverable | Owns | Needs |
| --- | --- | --- | --- |
| S0.1 | Vitest, Playwright, ESLint, Prettier, CI workflow, scripts | `package.json`, config files, `.github/` | — |
| S0.2 | Tests pinning today's behaviour, including the smoke and scheduling tests; the `window.__app` hook | `*.test.ts`, `e2e/` | S0.1; S0.6 for the scheduling test |
| S0.3 | Router, legacy redirect, lazy routes, error boundary, flags | `src/app/`, `src/App.tsx`, `src/main.tsx` | S0.1 |
| S0.4 | Contract types as code; pure-zone `tsconfig` and lint rule | `src/song/types.ts`, `src/project/types.ts`, `src/assist/core/types.ts`, `src/music/time.ts` | S0.1 |
| S0.5 | `CLAUDE.md`, README update, sample credits | docs, a credits link in `src/app/` | S0.1–S0.4 |
| S0.6 | The `Sink` seam in the player; `renderOffline` and its measuring helpers; one example test of each kind | `src/audio/player.ts` (the seam only), `src/audio/testing.ts`, `e2e/audio/` | S0.1 |

S0.2, S0.3, S0.4 and S0.6 touch different files and can run in parallel once S0.1 has merged; S0.2's
scheduling test waits for S0.6. S0.4 and S0.6 both touch `player.ts` lightly (a moved type, the seam):
land S0.4 first.

## Acceptance criteria

1. `npm run check` passes locally and in CI on a clean clone.
2. CI runs on every pull request and blocks merging when any step fails.
3. Opening `#rewrite-the-stars` lands on `#/play/rewrite-the-stars` with the song loaded; `#/play/divenire`
   loads Divenire; the browser's back button works between two songs.
4. The Practice smoke test and the scheduling test pass in Chromium; the smoke test passes in WebKit.
5. A deliberate regression (for example, making `playRange` ignore the window) fails a test.
6. The production bundle for `#/play/:id` is no more than 5 KB gzipped larger than before this stage.
7. A file in `src/music/` that imports `react` or reads `window` fails `npm run typecheck` or `npm run lint`.
8. `CLAUDE.md` exists and its commands work as written.
9. The piano samples are credited in the README and reachable from the app.
10. An offline render of a one-note fixture returns samples whose level in the note's first 100 ms is
    within 1 dB across ten runs, and the recording sink reports the same three calls for the three-note
    fixture on every run.

## Risks

- **Formatting churn** makes later diffs noisy. Keep the Prettier pass to one commit and merge it before
  other work starts.
- **Tone.js under test.** Tone needs a real audio context, so anything that touches it is tested in
  Playwright, not Vitest. Do not mock Tone in unit tests; move the logic worth testing into functions
  that do not need it.

## Build notes

Built 15–16 November 2026. What differed from the plan, and why.

- **CI runs on every push to any branch**, not only on pull requests and the default branch. A branch
  is then checked before a pull request exists, which is how this stage was developed. Making a failed
  run *block* a merge (criterion 2) is a repository setting — branch protection on the default branch
  requiring the `check` job — and has not been turned on; that is the owner's to do.
- **`npm run test:e2e` builds first.** The browser tests run against the built app. Playwright reuses a
  preview server that is already running, and a reused server does not rebuild, so the first version
  quietly tested a stale build. The build is now part of the script, not of the server command.
- **The seam is a module, not just an interface.** The instruments moved out of the player into
  `src/audio/voices.ts`, and the player calls a `Sink`. `playRange` and the speed slider's arithmetic
  moved to `src/audio/range.ts` and `src/components/speed.ts` so they can be tested without Tone.
- **Query strings in the hash.** The plan's `#/?q=…` form does not come free with the router: wouter's
  hash location writes anything after `?` to the page's real query string, where the feature flags
  live. `src/app/hashRoute.ts` keeps a screen's state inside the hash and gives the router the path
  alone. Stage 1's Library uses it.
- **A `#/credits` route** was added for the sample credit (contracts §11 and the changelog updated).
- **Type files are generated from `contracts.md`**, block by block, so the two start identical.
  `EditError` is a real class in `src/project/errors.ts`; `AssistProvider` sits outside the pure zone
  as the plan says.
- **Prettier covers TypeScript only.** The stylesheet is written one rule per line on purpose and the
  plan's Markdown tables would be re-flowed; both are excluded.
- **Three `react-hooks/exhaustive-deps` warnings** remain on existing components. They describe
  deliberate patterns; changing them is behaviour change and outside this stage.
- **Playwright is pinned to 1.63.0**, the version whose browser is preinstalled in cloud sessions.
- **Bundle (criterion 6):** before this stage Practice downloaded 122.4 KB of JavaScript, gzipped, in
  one file. After it, 127.1 KB in three: +4.8 KB, of which the router is about 2.

### Acceptance

| # | Result |
| --- | --- |
| 1 | Pass, locally and in CI. |
| 2 | CI runs on every push. Blocking merges is not set up: it needs branch protection (owner). |
| 3 | Pass — `e2e/routes.spec.ts`. |
| 4 | Chromium: pass. WebKit: **not met as written — see below.** The Library and routing tests run there instead. |
| 5 | Pass — breaking `playRange` fails four unit tests; making the scheduler ignore speed fails the half-speed test. |
| 6 | Pass — +4.8 KB. |
| 7 | Pass — a probe file importing React and reading `window` fails both the type-check and the linter. |
| 8 | Pass. |
| 9 | Pass — README and `#/credits`, with a test. |
| 10 | Pass — `e2e/audio/render.spec.ts`, `e2e/scheduling.spec.ts`. |

**WebKit (criterion 4): cannot be met as written, and that is not new.** The criterion asks for the
Practice smoke test to pass in WebKit. In the WebKit build that Playwright ships for Linux, which is what
CI runs, the page hangs and then crashes. Three probes in CI (run 9 of the workflow) established why:

- the Library renders there, and a plain `AudioContext` works;
- loading the module that contains Tone.js never returns — no error, the page simply stops;
- **the app as it was before any of this work (commit `6e1b653`) crashes the same way** on load, on both
  the iPhone and the desktop Safari profiles.

So no screen that makes sound can be tested in that browser by anyone, and nothing in Stages 0 or 1
caused it. It says nothing about Safari on a real iPhone, where the app is in daily use; it is a limit of
that test build.

What was done instead: WebKit runs every browser test that does not open a song — all of the Library,
routing, and the credits page — which Stage 0's lazy routes make possible, because the Library no longer
loads any audio code. Tests that open a song skip themselves there (`needsSound()` in `e2e/helpers.ts`).

**For the owner:** criterion 4 should read "…the smoke test passes in Chromium; the Library and routing
tests pass in WebKit", with Practice on Safari checked by hand on a phone at each milestone. Until that is
agreed, treat the WebKit half of criterion 4 as not met.
