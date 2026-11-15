# Stage 4 — Drum pads and groove

**Goal:** a drum-pad instrument inside Studio that does two jobs: adds a drum part to a song, and sets
the song's beat — its tempo, meter and feel — by tapping it.

**Depends on:** Stage 3 (Studio frame, transport), Stage 2 (engine drums, quantize, groove) ·
**Unlocks:** rhythm-first melody writing in Stage 5; bass lines that lock to the kick · **Size:** medium ·
**Flag:** `drums`

## What the user gets

- A **Pads** panel: a grid of pads that sound the instant they are touched, playable with several
  fingers, from the computer keyboard, or from MIDI pads.
- **Record** a beat over a loop, layer by layer, and have it tidied to the grid without losing the feel.
- A **step grid** for building a pattern one square at a time.
- **Tap the beat**: tap a few bars and the song takes its tempo, time signature and swing from the taps.
- **Starter grooves** to drop in and change, and a variation button for each.
- **Tap a rhythm** for a melody: tap the rhythm you hear in your head, then choose the pitches.

## Design

### The pads

- **Grid:** 4 × 4 on wide screens, 4 × 3 on an upright phone (the twelve most-used pads; the rest one
  swipe away). Default layout bottom row to top, the way pad controllers are laid out: kick, snare, clap,
  rim / closed hat, open hat, pedal hat, shaker / low, mid, high tom, tambourine / crash, ride, cowbell,
  perc. Each pad shows its name and its key.
- **Triggering:** on `pointerdown`, never on `click`; `touch-action: none`; every pointer is its own hit,
  so two fingers are two hits. The sound is started through `engine.drum()` with no look-ahead.
- **Velocity:** from where the pad is touched — bottom edge soft, top edge hard — or from
  `PointerEvent.pressure` when the device reports real pressure, or the MIDI velocity. A "fixed velocity"
  switch for people who do not want this.
- **Keys:** the 4 × 4 block `1 2 3 4 / Q W E R / A S D F / Z X C V` mirrors the grid while the Pads panel
  has focus (and musical typing is paused).
- **Feedback:** the pad flashes on a hit and on playback of its hits; `navigator.vibrate(8)` where
  available.
- **Kits:** `synth` (the Stage 2 synthesized kit, always available, nothing to download) plus sampled
  kits listed in `src/audio/kits.ts`. A sampled kit is a folder of one-shots under `public/kits/<id>/`
  with a manifest mapping pads to files; it loads on first use and the synth kit plays until it is ready.
  Only samples whose licence allows redistribution in a public app are bundled, each kit's manifest
  records its source and licence, and every kit is listed on the app's Credits page. Choice of kits: see
  Technology below.

### Recording a beat

- With the transport looping (default: four bars at the cursor), record arms the drum track. Each pass
  **adds** to what is there; a per-pad "clear this pad" removes one voice from the loop without stopping.
- Hits are stamped from the event's own timestamp mapped onto the audio clock, minus the device's input
  latency (below), so the recording lines up with what was heard.
- On stop, hits are quantized to the song's grid; the distance each moved is kept in `offset`, and a
  **Tighten** slider (0–100%) scales how much of that feel plays back. Nothing is thrown away: sliding
  back to 0% returns the performance as played.
- Recorded hits land as free `hits` on the drum track. **Make a pattern** turns the looped bars into a
  reusable `DrumPattern` clip.

### Latency calibration

Touch-to-sound and sound-to-ear delays differ by device, and Bluetooth headphones add a great deal. A
one-time **calibrate** step (Settings, and offered the first time a recording looks consistently late):
tap along with eight clicks; the median offset between taps and clicks is stored per device in
`piano-tutor:latency` and subtracted from every recorded timestamp — pads, live notes in Stage 3, and
humming in Stage 7. The screen says plainly when Bluetooth audio is in use and recommends wired or the
built-in speaker for recording.

### The step grid

- One row per pad in use, sixteen or thirty-two columns per bar, one to four bars. Tap a square to cycle
  off → soft → medium → hard. Rows can be muted, cleared, shifted a step left or right.
- The playing column is highlighted. Pads and grid are two views of the same pattern: a recorded loop
  shows up in the grid, and squares toggled in the grid sound on the next pass.
- Patterns are named, duplicated and deleted in a pattern list; a pattern is placed on the timeline as a
  clip with a repeat count, and can be assigned per section ("verse: A, chorus: B, fill on bar 8").

### Tap the beat

The path from a rhythm in someone's head to the song's grid.

1. The author taps freely — on any pad, with no click — for at least two bars.
2. `analyzeTaps(taps)` (pure, `src/music/groove.ts`) estimates:
   - **tempo**, from the autocorrelation of onset times, preferring 70–140 BPM when two answers are an
     octave apart;
   - **meter**, from the period of the accent pattern (which pad, how hard): three, four or six pulses;
   - **swing**, from the ratio of long to short gaps between off-beat hits;
   - a **`Groove`** (contracts §3): the average signed timing offset and accent per step across the bar.
3. The result is shown as a sentence and a picture — "96 BPM, 4/4, light swing" over the taps laid on the
   detected grid — with **Use for this song**, **Halve / Double** the tempo, and **Try again**. Nothing
   changes in the song until the author accepts.
4. Accepting sets tempo, meter, swing and groove in one undo step and offers to keep the taps as the
   song's first drum pattern.

Once a song has a groove, quantize everywhere (Stage 3's record mode, humming, imports) can snap to the
groove instead of the bare grid, so a melody sits in the same pocket as the drums.

### Starter grooves and variations

- A small built-in library (about thirty one- and two-bar patterns) grouped by feel: straight pop and
  rock, four-on-the-floor, half-time, shuffle, 6/8 ballad, waltz, bossa, funk, trap-style hats, train
  beat, plus fills. Written for this project as plain `DrumPattern` data in `src/audio/grooves.ts`.
- Audition a groove in place against the song before dropping it in.
- **Vary** (deterministic, seeded, in `src/music/groove.ts`): a handful of named transformations — add
  ghost snares, open the hat on off-beats, drop the kick on a beat, double-time or half-time the hats,
  thin out, humanize — each producing a new pattern beside the original, never replacing it. The
  assistant's drum suggestions in Stages 5 and 6 arrive as ordinary options through the same door.

### Tap a rhythm for a melody

A melody tool that uses the pads: **Tap rhythm**. While the loop plays, the author taps the rhythm of the
line they hear on a single pad. The taps become a `Take` of kind `tap` and then a row of **empty notes** —
right start, right length, no pitch (`Project.pending`, contracts §3) — on the melody track, drawn as
outlines. Step
mode then walks through them: each key press gives the next empty note its pitch. Unfilled notes do not
sound and are not compiled. In Stage 5 the key hints light up for each one in turn.

## Technology

| Need | Choice | Why |
| --- | --- | --- |
| Drum sounds with no download | Tone.js `MembraneSynth`, `NoiseSynth`, `MetalSynth` | Already a dependency; instant. |
| Sampled kits | One-shot samples played from decoded `AudioBuffer`s, self-hosted. Start with one electronic kit from Sonic Pi's sample set and one acoustic kit from Virtuosity Drums or VCSL — all CC0 | [research.md](research.md) §B. Do not use sample sets with no stated licence (Tone's own `drum-samples` is one), nor share-alike or GPL sets. |
| Low latency | `latencyHint: "interactive"`, trigger at the context's current time (`Tone.immediate()`), pointer events | Tone's default look-ahead is 0.1 s: right for sequenced playback, wrong for pads. |
| Timestamps | `event.timeStamp` mapped to the audio clock with `AudioContext.getOutputTimestamp()` | The event time is when the finger landed, not when the handler ran. |
| MIDI pads | Same Web MIDI input path as Stage 3; note numbers mapped General MIDI style (36 kick, 38 snare, 42 hat …) | |

## Work packages

| Id | Deliverable | Owns | Needs |
| --- | --- | --- | --- |
| S4.1 | Pads panel: grid, triggering, velocity, keys, feedback, kit switcher; sampled-kit loader and manifest format | `src/studio/pads/`, `src/audio/kits.ts`, `public/kits/` | S3.1, S2.5 |
| S4.2 | Loop recording, overdub, per-pad clear, quantize with Tighten, Make a pattern | `src/studio/pads/record.ts` | S4.1, S3.4 |
| S4.3 | Latency calibration and its use in all recording paths | `src/audio/latency.ts`, `src/app/settings/` | S4.1 |
| S4.4 | Step grid, pattern list, clips on the timeline, per-section assignment; drum lane in the editor; a Drums volume and mute in Practice for songs that have drums | `src/studio/pads/StepGrid.tsx`, `src/studio/EditorCanvas.tsx` (drum lane only), `src/components/Practice.tsx` (drums row only) | S4.1 |
| S4.5 | `analyzeTaps`, Tap the beat flow, groove-aware quantize | `src/music/groove.ts`, `src/studio/pads/TapBeat.tsx` | S4.1, S2.1 |
| S4.6 | Starter grooves, audition, Vary | `src/audio/grooves.ts`, `src/music/groove.ts` | S4.4 |
| S4.7 | Tap rhythm → empty notes → pitch entry in step mode | `src/studio/pads/TapRhythm.tsx`, `src/studio/input.ts` | S4.2, S3.4 |

After S4.1: S4.2–S4.6 in parallel; S4.7 after S4.2.

## Acceptance criteria

1. A pad sounds on `pointerdown`; two pads touched together both sound; holding a pad does not retrigger.
   Measured in the page, the call to the engine follows the event by under 4 ms.
2. The synth kit sounds every pad with nothing downloaded; switching to a sampled kit keeps the pads
   playable while it loads and switches over when ready.
3. A scripted four-bar performance injected with timestamps (kick on 1 and 3, snare on 2 and 4, eighth
   hats, each up to 30 ms off) records onto the right steps; at Tighten 0% the compiled times equal the
   performed times within 2 ms, at 100% they sit exactly on the grid.
4. With a stored input latency of 60 ms, the same performance injected 60 ms late records identically.
5. `analyzeTaps` on synthetic taps recovers tempo within 2% across 60–180 BPM, tells 3/4, 4/4 and 6/8
   apart on accented fixtures, and recovers a swing ratio within 0.04 for straight, light and triplet
   swing. Halving and doubling ambiguity resolves to the 70–140 range.
6. Tap the beat changes nothing until accepted, and accepting is one undo step.
7. A pattern edited in the step grid is heard on the next loop pass without stopping; the same pattern
   placed twice with repeats compiles to the right hits; changing the pattern changes both placements.
8. Vary produces a different, valid pattern for each transformation and the same pattern again for the
   same seed.
9. Tap rhythm with eight taps creates eight empty notes with the tapped starts and lengths; eight key
   presses in step mode fill them in order; an unfilled note is absent from the compiled song.
10. Practice plays a user song's drums in time with its notes, with a Drums volume and mute beside the
    two hands; bank songs without drums show no such control.
11. Every pad, grid square and control is operable by keyboard and labelled; the grid announces "kick,
    step 5, medium".
12. Bundled kits each have a manifest naming a source and a licence that permits redistribution.

## Test plan

- Unit: `analyzeTaps` over generated tap sequences with jitter; groove extraction and groove quantize;
  pattern expansion; Vary transformations; tap-rhythm note lengths.
- Playwright: pointer-driven pad hits with injected timestamps; record, tighten, undo; step grid during
  playback; Tap the beat end to end; offline render of a pattern against a click.
- By hand: an iPhone and an Android phone, wired and Bluetooth, with and without calibration.

## Risks

- **Latency on phones**, especially Android and anything Bluetooth. Calibration corrects the recording,
  not the feel of playing; say so in the UI rather than pretend.
- **iOS audio session.** Sound may be silenced by the ring switch or routed oddly once the microphone has
  been used (Stage 7). Test pads after a hum session.
- **Meter detection from a few taps** is guesswork for ambiguous rhythms, which is why the result is
  shown and confirmed, with one-tap corrections, and never applied silently.

## Build notes

_Empty._
