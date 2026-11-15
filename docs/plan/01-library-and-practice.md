# Stage 1 — Library home, hand volume, sustain

**Goal:** the three changes asked for first. A home page that lists the song bank; each hand's
On / Soft / Off switch becomes a volume slider with mute; a sustain pedal toggle.

**Depends on:** Stage 0 · **Unlocks:** Stage 2 (the mixer and master bus built here), Stage 3 (the
Library gains "My songs") · **Size:** medium · **Flag:** none — this stage ships visibly

## What the user gets

- Opening the app shows the **Library**: every song in the bank as a card, searchable, filterable by
  genre and difficulty, with a "Continue" row for what was played last.
- In Practice, each hand has a **volume slider and a mute button** instead of the three-way chip.
- A **Sustain** switch holds the pedal down, so notes ring on after they are released.

## Reading of the request

"L/R sound toggle" is taken to mean the Left / Right chips in the Hands panel that cycle
On → Soft → Off. The separate "Stereo split" chip (left hand in the left ear) is unchanged. If the
owner meant Stereo split, only S1.4's UI moves; the engine work is the same.

---

## A. Library

### Song metadata

The index grows the fields in contracts §2 (`SongIndexEntry`). Two kinds of field, kept apart on purpose:

- **Hand-authored** — `genre`, `tags`, `difficulty`, `addedAt`. A person decides these.
- **Derived** — `duration`, `bpm`, `key`, `noteCount`, `range`, `preview`. `npm run songs:index` reads each
  song file and rewrites these fields, leaving the hand-authored ones alone. CI runs it with `--check`
  and fails if the index is stale, so the cards can never disagree with the songs.

`preview` is 48 numbers: the song cut into 48 equal slices, each the share of that slice with notes
sounding, scaled so the busiest slice is 1. It draws the thumbnail on a card without downloading a
100–170 KB song file per card. `key` is left out until Stage 2 provides key detection.

Starting values for the two existing songs, for the owner to confirm: Rewrite the Stars — `film-tv`,
difficulty 3; Divenire — `neoclassical`, difficulty 4.

`scripts/midi-to-song.mjs` gains `--genre`, `--difficulty` and `--tags`, appends the new entry to the
index, and runs the indexer, so adding a song is one command.

### Screen

```
♪ Piano Tutor                               [ Search songs…        ]

Continue          ← only when something has been played; scrolls sideways on a phone
┌────────────────────┐ ┌────────────────────┐
│ ▂▅▇▅▃▂▅▇▆▃▂▅▇▅▃    │ │ ▃▃▅▇▇▅▃▂▂▃▅▇▅▃▂    │
│ Divenire           │ │ Rewrite the Stars  │
│ ━━━━━━━─────  2:41 │ │ ━━──────────  0:38 │
└────────────────────┘ └────────────────────┘

Song bank                               [ Difficulty ▾ ]  [ Sort ▾ ]
( All ) ( Film & TV ) ( Neoclassical )          ← only genres that have songs
┌────────────────────┐ ┌────────────────────┐ ┌────────────────────┐
│ ▂▅▇▅▃▂▅▇▆▃▂▅▇▅▃    │ │                    │ │                    │
│ Title              │ │                    │ │                    │
│ Artist             │ │                    │ │                    │
│ 3:29 · 125 BPM     │ │                    │ │                    │
│ ●●●○○   Film & TV  │ │                    │ │                    │
└────────────────────┘ └────────────────────┘ └────────────────────┘
```

- **Card:** thumbnail from `preview`, title, artist, one meta line (length, tempo when the song has one,
  key when known), difficulty as filled dots, genre chip. The whole card is an `<a href="#/play/<id>">`,
  so middle-click, long-press and keyboard all behave natively.
- **Search:** filters as you type over title, artist, genre and tags; case- and accent-insensitive.
- **Filters and sort:** genre chips (single select, "All" first); difficulty (any, or a level);
  sort by Recently added (default), Title, Artist, Length, Difficulty. Search, genre, difficulty and sort
  live in the URL (`#/?q=…&genre=…&sort=…`) so back, forward, reload and sharing work.
- **Continue:** up to four cards from `piano-tutor:recent`, newest first, each with a progress bar and
  the position to resume at. Practice writes the entry whenever it saves its session.
- **States:** loading shows card skeletons at the final card size (no layout shift); an index that fails
  to load shows the error and a Retry button; a search with no matches says so and offers to clear it.
- **Layout:** one column under 480 px, then as many 260 px columns as fit, up to a 1280 px page.
  Styling reuses the existing tokens in `src/styles.css` (`--surface`, `--border`, `--accent`).
- **Scale:** built for a bank of a few hundred songs — one index request, no per-card song requests,
  plain rendering. Past roughly 300 entries the grid should be windowed; note it and move on.

### Practice shell

- The song `<select>` in the top bar goes away. The brand becomes a link to `#/`, and a "← Library"
  link sits before the song title.
- An unknown song id shows "That song isn't in the library" with a link home, instead of loading the
  first song.
- Everything else in Practice is untouched: session restore, shortcuts, wake lock.

---

## B. Hand volume and mute

### Behaviour

Each hand has a `HandMix` (contracts §6): `volume` from 0 to 1 and `muted`. Muting remembers the
volume. The gain applied is `muted ? 0 : volume²`, so the slider feels even from quiet to loud.

- Notes of a muted hand **are still scheduled**; only the hand's gain is zero. Unmuting in the middle of
  a long note brings it back at once. Gain changes ramp over 30–50 ms so nothing clicks.
- Moving the slider while muted unmutes. A slider at 0 is silent but not "muted" (the button stays
  unpressed); both show the crossed-out speaker.

### Controls (Hands panel)

```
● Left    [🔈]  ━━━━━━━━━━●━━━━  70%
● Right   [🔇]  ━━━━━━━━━━━━━━●  100%   (muted: slider dimmed)
```

- A row per hand: the hand's colour dot and name, a mute button (`aria-pressed`, label "Mute left
  hand"), a range input 0–100 with `aria-valuetext` such as "70 percent", and a numeric readout.
- Double-click or double-tap on a slider resets it to 100%.
- Shortcuts: `1` mutes or unmutes the left hand, `2` the right. Add them to the hint line.
- The collapsed panel summary reads like `Left 70% · Right muted`.

### What else changes with it

| Place | Today | After |
| --- | --- | --- |
| `PlayerState` | `levels: Record<Hand, "on" \| "soft" \| "off">` | `mix: Record<Hand, HandMix>` with `setVolume`, `setMuted`, `toggleMute`, `setMix` |
| Session restore (`src/session.ts`) | saves `levels` | saves `mix`; reading an old session maps `on → {1, false}`, `soft → {0.47, false}`, `off → {1, true}` (0.47² ≈ the old soft gain of 0.22) |
| Falling-note opacity (`Stage.tsx`) | 1 / 0.55 / 0.2 by level | muted 0.2; otherwise `0.45 + 0.55 × volume` |
| Rhythm map dots | `lvl-on/soft/off` classes | muted → off; volume < 0.6 → soft; else on |
| Coach routine | sets levels on/off per step | mutes and unmutes per step, never touches volume, and restores the mix it started with when the routine stops or finishes |

### Master bus

Sustained notes and two hands at full volume add up, and nothing limits the output today. This stage
adds a master chain — hand buses → master gain → limiter (ceiling −1 dBFS) → output — and it is where
Stage 2's tracks, drums and metronome will plug in. At normal levels the limiter does nothing audible.

---

## C. Sustain

### Behaviour

A **Sustain** chip next to Stereo split and Metronome, with a pedal icon, `aria-pressed`, shortcut `P`.
It is a sound preference, saved with the others in `piano-tutor:prefs`.

With Sustain on, the dampers are up. A note keeps ringing after its written end and fades the way a
piano string does, until one of these happens:

- it has faded out (about four seconds of real time to silence, regardless of playback speed);
- the same key is struck again;
- Sustain is switched off, which silences everything still ringing within about 150 ms;
- playback pauses, seeks, or wraps round a loop (the existing release-everything behaviour).

This is a pedal held down for the whole piece, so harmonies blur into each other. That is what was asked
for; pedalling that follows the music is Stage 9, and the `pedal` field in the song format is already
reserved for it.

### How to build it (recommended)

- While the pedal is down, voices get a long release (about 4 s) in place of their normal one, so the
  written note-off starts a slow fade instead of a quick stop. `PolySynth.set({ envelope: { release } })`
  and `Sampler.release` both allow this without re-creating instruments.
- Voices already fading keep the release they started with, so switching the pedal off needs an explicit
  damp: fade the pedal-down voices' output to zero over ~120 ms, release them, restore the gain. Cutting a
  note whose key is still down at that instant is acceptable for this toggle.
- The synth sounds hold at a sustain level while a key is down, which is fine; only the part after the
  written end has to decay.

Two traps:

- **Polyphony.** `PolySynth` drops notes past its voice limit (32 by default) rather than stealing old
  ones. With four-second tails, Divenire's fast passages will exceed that. Raise the limit (96 is
  plenty), and when the count gets close, cut the oldest ringing voices first.
- **Level.** Many ringing notes sum. The master limiter from part B is what keeps this from clipping;
  build B before C.

---

## Work packages

| Id | Deliverable | Owns | Needs |
| --- | --- | --- | --- |
| S1.1 | Index fields, `songs:index` script with `--check`, CI step, converter flags, metadata for the two songs | `scripts/`, `public/songs/index.json`, `docs/song-format.md` | S0 |
| S1.2 | Library screen: cards, search, filters, sort, Continue row, states | `src/library/` | S1.1 |
| S1.3 | Practice shell: top bar, unknown-song page, writing `recent` | `src/App.tsx`, `src/app/`, `src/session.ts` | S0.3 |
| S1.4 | Master bus and limiter; `HandMix` in the player; volume and mute UI; migration; Stage, RhythmMap and Coach updates; shortcuts | `src/audio/player.ts`, `src/components/Practice.tsx`, `Stage.tsx`, `RhythmMap.tsx`, `Coach.tsx`, `src/session.ts` | S0.2 |
| S1.5 | Sustain toggle and engine behaviour | `src/audio/player.ts`, `Practice.tsx` | S1.4 |

S1.1–S1.3 (Library) and S1.4–S1.5 (audio) share almost no files and can run as two parallel tracks.
S1.3 and S1.4 both touch `src/session.ts`: S1.3 adds a call, S1.4 changes the saved shape; land S1.4 first
or coordinate.

## Acceptance criteria

**Library**

1. `#/` shows a card for every entry in the index, with no request for any individual song file.
2. Typing "einaudi" leaves only Divenire; clearing the search restores all cards; the URL reflects the
   search and reloading restores it.
3. Genre chips show only genres present in the index; choosing one filters the grid.
4. After playing a song to 1:00 and returning to the Library, it appears first under Continue with its
   progress; activating the card resumes at that position.
5. `npm run songs:index -- --check` fails when a song file changes without the index being regenerated.
6. Cards are reachable and activatable by keyboard, each announced with title and artist; the page has no
   horizontal scroll at 320 px wide.
7. `#/play/nope` shows the not-found message, not another song.

**Volume and mute**

8. Rendered offline with a fixture song, the left hand at 50% measures 12 dB (±1) below the left hand at
   100%; muted measures silence.
9. Muting and unmuting during a held four-second note silences it and brings it back without a click
   (no sample-to-sample jump above 0.1 full scale).
10. A session saved by the previous version with `levels: { L: "soft", R: "off" }` restores as left at
    47%, right muted.
11. The Coach routine run from left 60% / right 100% ends with left 60% / right 100%, both unmuted.
12. Sliders and mute buttons work by keyboard and by touch at 390 px wide; `1` and `2` toggle mute.

**Sustain**

13. With Sustain on, a 0.2 s note is still audible (above −40 dBFS) 1.5 s after its written end and
    silent (below −60 dBFS) by 6 s; with Sustain off it is silent within 1.2 s.
14. Switching Sustain off during ringing reaches silence within 200 ms.
15. Playing Divenire's densest 20 seconds with Sustain on, on each of the five sounds: no "max polyphony"
    warning, no dropped note, and the output peak stays under 0 dBFS.
16. Pausing, seeking and loop wrap leave no ringing notes, as today.
17. The Stage 0 scheduling test still passes: note start times are unchanged by this stage.

## Test plan

- Unit: index derivation (duration, note count, range, preview) against a small fixture; search and sort
  functions; session migration.
- Playwright: criteria 1–7 and 11–12 as user flows; criteria 8, 9 and 13–15 as offline renders asserted on
  samples.
- By hand on an iPhone: sliders under a thumb, mute during playback, Sustain with the sampled grand piano.

## Risks

- **The grand piano sound and long releases.** The sampled piano already decays on its own; a long
  release mostly matters for the synth sounds. Check each of the five sounds by ear — the criteria above
  are the floor, not the goal.
- **Difficulty values** are opinions. Ship cards without the dots when a song has none.

## Build notes

_Empty._
