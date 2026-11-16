# Piano Tutor

A browser app for learning songs on the piano: falling notes over a keyboard, with speed control,
looping and a hands-together coach. It is growing into a song library, a practice player and a
song-building studio. **The plan is in [docs/plan/](docs/plan/README.md)**; read its README,
`agent-protocol.md` and `contracts.md` before building anything.

Vite + React 18 + TypeScript (strict) + Tone.js. A static site; no server yet.

## Commands

```bash
npm install
npm run dev          # http://localhost:5173
npm run check        # everything below, in order — run before calling work done
npm run typecheck    # app, the pure zone (no DOM), and tooling
npm run lint         # ESLint, then Prettier --check
npm test             # Vitest: unit and component tests, src/**/*.test.ts(x)
npm run build        # type-check + production build to dist/
npm run test:e2e     # Playwright against the built app, e2e/
npm run format       # apply Prettier
```

## Rules that are easy to break

- **Practice must not get worse.** It is in daily use on a phone on a music stand. Behaviour, feel and
  load time stay at least as good. `e2e/smoke.spec.ts` and `e2e/scheduling.spec.ts` are the guard.
- **Musical logic lives in the pure zone**: `src/song` (except `load.ts`), `src/music`, `src/project`
  (except `store.ts`), `src/assist/core`. No React, no Tone, no `window`. `tsconfig.core.json` and
  ESLint enforce it. If a function needs neither the DOM nor audio, it belongs there, with a unit test.
- **Anything that needs an audio context is tested in Playwright, not Vitest.** Do not mock Tone. Use
  the harness in `src/audio/testing.ts`: `recordSink` for what was scheduled and when, `renderOffline`
  for what it sounds like.
- **Contracts are shared.** Changing a type in `docs/plan/contracts.md` means changing the code, the
  document and `docs/plan/CHANGELOG.md` together.
- **Unfinished features hide behind a flag** (`src/app/flags.ts`); the default branch deploys on every push.
- **No major-version upgrades** (React, Vite, TypeScript, Tone) inside feature work.

## Things worth knowing

- End-to-end tests open the app as `/?flags=test-hooks#/…` and reach it through `window.__app`
  (`src/app/testHooks.ts`).
- `@playwright/test` is pinned to 1.63.0 to match the browser preinstalled in cloud sessions.
- WebKit runs in CI only, and only tests that make no sound: Playwright's Linux WebKit hangs when
  Tone.js loads (it always did). Put `needsSound()` at the top of any `describe` that opens a song.
  Practice on Safari has to be checked on a real phone.
- The sampled grand piano loads from `tonejs.github.io`. Where that host is blocked the app falls back
  to the Clear sound, and tests of the piano sound skip themselves.
- Prettier formats TypeScript only. The stylesheet's one-rule-per-line layout is deliberate.
- Three `react-hooks/exhaustive-deps` warnings on existing components are known and intentional.

## Done means

Acceptance criteria pass and are named in the pull request; `npm run check` passes; new logic has unit
tests and new flows a Playwright test; the feature was used at 390 × 844 and 1440 × 900; Practice still
works; controls are keyboard-reachable and labelled; documentation that describes the change is updated.
Report plainly what failed or was skipped. Full version: `docs/plan/agent-protocol.md`.
