# How to build from this plan

For whoever picks up a work package — one agent working through the stages in order, or several working
in parallel. Read this once; it applies to every stage.

## What to read before starting

1. [README.md](README.md) — what is being built and why, and how the stages fit together.
2. [contracts.md](contracts.md) — the shared types and interfaces. Skim all of it; read closely the
   sections your stage touches.
3. Your stage document, top to bottom.
4. The code your work package touches. The plan describes the repository as it was when the plan was
   written; the code is what is true now.

The existing app matters. Practice is in daily use on a phone propped on a music stand, and none of this
work may make it worse: same behaviour, same feel, no added load time. When a stage changes Practice, its
acceptance criteria say exactly how.

## Working on a package

- **One work package, one branch, one pull request.** Branch names: `s3-2-chord-track`. Keep the default
  branch deployable at every merge — the site redeploys on every push to it.
- **Unfinished features hide behind their flag** (contracts §11). Merge early and dark rather than
  holding a long branch.
- **Stay inside your package's files.** Each stage lists which files a package owns. If you need a change
  in a file another package owns, make the smallest change that works and call it out in the PR.
- **Contracts are shared property.** To change one: change the type, change `contracts.md`, add a line to
  `CHANGELOG.md`, and put "contract change" in the PR title. Adding an optional field is routine. Changing
  or removing something others already build on needs the owner's or lead agent's agreement first.
- **Musical logic goes in the pure zone** (contracts §12) with unit tests. If a function needs neither the
  DOM nor audio, it does not belong in a component.
- **No major-version upgrades inside a feature package.** React, Vite, TypeScript and Tone stay on their
  current majors unless a package exists specifically to upgrade them.

## When the plan is wrong

It will be, somewhere. The plan fixes *what must be true when you finish* (the acceptance criteria and
the contracts) and recommends *how*. Where a recommended library, model or algorithm turns out not to work:

1. Say what you found in the stage document's **Build notes** section, with the evidence (the error, the
   measurement, the link).
2. Take the nearest alternative that still meets the acceptance criteria.
3. Flag it in the PR.

Do not quietly weaken an acceptance criterion to make something pass. If a criterion cannot be met, stop
and say so; that is a decision for the owner.

Several packages are marked **spike**. A spike's deliverable is a short decision note with measurements,
committed to `docs/plan/spikes/`, not production code. The package after it builds on the decision.

## Done means

A package is done when all of these hold, and the PR description shows the evidence:

- [ ] Its acceptance criteria pass, each one checked and named in the PR.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass.
- [ ] New logic has unit tests; new user flows have a Playwright test.
- [ ] You ran the app and used the feature at a phone viewport (390 × 844) and a desktop viewport
      (1440 × 900), with screenshots or a short recording attached.
- [ ] Practice still works: the Practice smoke test passes and you played a song through a loop.
- [ ] Controls are reachable by keyboard and labelled for screen readers; motion respects
      `prefers-reduced-motion`; touch targets are at least 44 px.
- [ ] Nothing is fetched or loaded on the Library and Practice screens that those screens do not use.
- [ ] Documentation that describes what you changed is updated (`README.md`, `docs/song-format.md`,
      `contracts.md`).

Report plainly. If a test is failing, a criterion is unmet or a step was skipped, the PR says so.

## Verifying things that are hard to verify

| What | How |
| --- | --- |
| Pure music logic | Vitest, with small hand-written fixtures. Prefer many tiny cases to a few large ones. |
| Audio output | Playwright in Chromium: render with `Tone.Offline` / `OfflineAudioContext`, assert on the samples (level over a time window, silence, peak). |
| Timing and latency | Record timestamps in the page and assert on the differences; never assert on wall-clock sleeps. |
| Canvas editors | Drive real pointer events in Playwright, then assert on the project state the store exposes on `window.__studio` in test builds; screenshots only for a few visual baselines. |
| Microphone features | Chromium's `--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<wav>` with fixture recordings. |
| ML quality | A fixture set with known answers and a scored metric (note F-measure, chord accuracy). The threshold lives in the stage document. |
| Language-model features | Recorded request/response fixtures for unit tests; a separate eval script that calls the real API, run on request because it costs money. |

## Things only the owner decides

Ask before doing any of these; none is implied by a work package:

- Spending money: paid hosting, a GPU provider, running an eval that calls a paid API.
- Shipping model weights or samples whose licence is anything other than plainly permissive.
- Turning on the YouTube importer.
- Making imported or user-built songs public in the song bank.
- Removing or weakening an acceptance criterion.
