# Stage 9 — Finishing and growing

**Goal:** the things that make the whole product dependable and pleasant once the features exist, and a
backlog of worthwhile extensions. Unlike Stages 0–8 this is a set of independent packages, not a
sequence; each can be picked up on its own when its dependency is done.

**Depends on:** varies per package · **Size:** each small to medium

## Recommended packages

These close gaps the earlier stages leave open on purpose.

### 9.1 Works offline, fully

Stage 3 makes the app installable and protects the author's songs (see S3.9). This package finishes the
job: a service worker that caches the app shell, the song bank, the piano samples, drum kits and model
files after first use, with a visible "available offline" state per item and a way to clear the cache.
Self-host the piano samples (they are loaded from another site today) so they can be cached and so that
site's availability stops mattering.

*Done when:* with the network off, a previously opened bank song plays with the sampled piano, a saved
project opens and plays in Studio with drums, and Hum transcribes.

### 9.2 Pedalling as written

Stage 1's Sustain is a pedal held down throughout. The song format already carries `pedal` events
(contracts §2), and piano transcription in Stage 8 produces them.

- Practice: Sustain becomes three-way — **Off / On / As written** — the last one following the song's
  pedal events, re-pedalling at each change without cutting notes whose keys are still down.
- Studio: a pedal lane beside the waterfall to draw and edit pedal spans; live recording from a MIDI
  pedal (controller 64).
- The waterfall shows pedal spans as a band at its edge.

*Done when:* an imported piano piece with pedal plays cleanly as written, and the Stage 1 criteria still
hold for On and Off.

### 9.3 Ways out

- **MusicXML** export of a project (melody, chords, two-staff piano), for notation software.
- **Lead sheet** view and print: melody with chord symbols, rendered with `abcjs`.
- **Audio** export: render the song offline to a WAV file.
- **Publish to the song bank:** export the compiled song with its index entry filled in, ready to commit
  to `public/songs/`.

*Done when:* each export opens correctly in a second program (MuseScore for MusicXML, any audio player
for WAV) and round-trip tests pass where a round trip exists.

### 9.4 A bigger library

As the bank grows past a few dozen songs: collections (hand-made lists), a page per genre, favourites,
difficulty estimated from the notes when not set by hand (density, hand span, hand independence, tempo),
windowed rendering of the grid past 300 cards, and chord symbols shown above the waterfall in Practice
for songs that have them.

### 9.5 A sideways view for wide screens

A horizontal piano roll as an alternative editor layout on screens 1024 px and wider, sharing
`interaction.ts` and the stores with the waterfall editor, so it is a second drawing of the same editor,
not a second editor.

### 9.6 Finding your way

First-run walk-throughs for Studio, the Ideas tray and import; a glossary of the theory terms the
assistant uses, linked from wherever a term appears; an About page with credits and licences for
samples, models and libraries (the piano samples in use today require attribution).

### 9.7 Audit

A pass over the whole app for accessibility (screen reader, keyboard, contrast, reduced motion),
performance on a low-end phone (start-up, frame rate, memory with a long song), and bundle size per
route. Findings become fixes or documented limits.

### 9.8 Seeing what happens in production

Client error reporting that sends no song content; server metrics for request counts, latency, token and
GPU spend, validation survival rate; a budget alarm.

## Backlog — needs an owner decision before any work

| Idea | Why it waits |
| --- | --- |
| **Accounts and cloud sync** | Songs live on one device until this exists. It adds a database, authentication, privacy obligations and running cost. Until then: export, backup reminders, and installing the app. |
| **Sharing a song by link** | Depends on cloud storage; raises the publishing questions in Stage 8. |
| **A trained music model as a third idea source** | Depends on the Stage 6 spikes saying go. |
| **Live key hints while playing an acoustic piano** (microphone pitch detection in Practice) | A different product direction: following the player. Worth its own plan. |
| **Dependency upgrades** (React 19, Vite 8, TypeScript 7) | Worth doing as one deliberate chore with the test suite as the net, not inside a feature. |
| **Lyrics** on the melody | Natural next step for songwriting; touches the data model. |

## Build notes

_Empty._
