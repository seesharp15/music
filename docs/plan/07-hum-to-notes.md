# Stage 7 — Hum it

**Goal:** hum, sing or whistle a melody into the microphone and get editable notes in the builder.
Everything runs on the device; the recording never leaves it.

**Depends on:** Stage 3 (Studio, and step mode's rhythm slots), Stage 2 (time, quantize, key,
`estimateTempo`, the latency reader) ·
**Unlocks:** Stage 8 reuses the note-segmentation code for vocal lines in imported audio · **Size:**
medium · **Flag:** `hum`

Needs no server. Can be built in parallel with Stages 4, 5 and 6. Two things here get better when those
stages exist and are simply absent when they do not: recordings line up more exactly once a device has
been calibrated (Stage 4's screen), and Tidy versions needs the Ideas tray (Stage 5).

## What the user gets

1. Open **Hum** in Studio and press record. With a tempo set, there is a count-in and a click; without
   one, just sing.
2. While singing, a line traces the pitch and the matching key lights up on the keyboard.
3. On stop, the line becomes notes, shown over the contour that produced them.
4. A few sliders adjust how it was heard — more or fewer notes, snap to the key, tidy the timing, shift
   the octave — and any note can be nudged, split, merged or removed.
5. Then: **Add to song**, **Keep as an idea**, **Use only the rhythm**, or **Show me tidy versions**.

## Design

### Capture — `src/audio/mic.ts`, `src/audio/worklets/capture.js`

- `navigator.mediaDevices.getUserMedia` called directly (Tone's `UserMedia` in the installed version
  accepts no constraints), asking for `echoCancellation: false`, `noiseSuppression: false`,
  `autoGainControl: false`, `channelCount: 1` as plain booleans. Safari honours only the first; that is
  expected.
- An `AudioWorklet` posts mono Float32 blocks to a Worker. The Worker resamples from the context's rate
  to 16 kHz, keeps the whole take in memory, and runs the trackers. Read `context.sampleRate` rather than
  assuming it.
- The microphone stream is opened on the record press and **stopped the moment recording ends**, so the
  phone leaves its call-style audio mode quickly.
- Before the first browser permission prompt, one screen says why the microphone is wanted and that the
  recording stays on the device. A refusal leaves a clear way to try again.
- **iPhone and iPad:** where `navigator.audioSession` exists, set its type to `"play-and-record"` before
  capture and back to `"playback"` after; handle the context's `interrupted` state; expect playback
  volume or routing to change while the microphone is open. Recommend headphones for recording against
  the click — which also keeps the click out of the recording — and say that Bluetooth headsets drop to
  call quality while recording.

### Hearing pitch — two trackers behind one interface

Both implement `PitchTracker` (contracts §8), whose `process` is asynchronous because model inference is.

| Tracker | Used for | Why |
| --- | --- | --- |
| **McLeod pitch method** via [`pitchy`](https://github.com/ianprime0509/pitchy) (MIT, 33 KB) | The live trace and lit key while recording; and whistling above 2 kHz | Answers within one analysis window, so the display keeps up with the voice. |
| **SwiftF0** (MIT; 135 KB ONNX model, about 14,000 parameters) on `onnxruntime-web` | The transcription after stop | Top of a 2026 benchmark of nineteen trackers under noise and phone-microphone conditions, and far faster than real time on one CPU core. Its streaming look-ahead of about 176 ms makes it wrong for live display and fine for after-the-fact. |

Runtime rules, from [research.md](research.md) §B: the WebAssembly-only build of `onnxruntime-web`, one
thread, inside the Worker. No WebGPU and no multi-threading — the first is unreliable in Safari, the
second needs cross-origin-isolation headers that would break loading samples from other origins. The
model file is self-hosted under `public/models/` and fetched on first use of Hum.

If the model cannot load, transcription falls back to the McLeod frames and the review screen says the
result may be rougher.

### From contour to notes — `src/capture/segment.ts` (pure)

Two functions (contracts §8): `segmentTake` turns the contour into notes in seconds, knowing nothing about
the song (steps 1–6); `placeNotes` puts those notes into the song (steps 7–8). The starting point for the
first is the note segmenter in the SwiftF0 demo (MIT, short and readable); the steps below are what the
pair must do, however they are written.

1. **Voiced or not:** a frame counts when its confidence clears a threshold and its level clears a noise
   floor estimated from the quietest tenth of the take.
2. **Tuning:** convert f0 to fractional MIDI. People rarely sing at concert pitch; estimate the take's
   overall offset from the nearest semitones (a circular mean over steady frames) and subtract it, so a
   singer who is 30 cents flat throughout is read as in tune with themselves.
3. **Smooth** with a 50 ms median, leaving vibrato as a wobble around a centre.
4. **Split into notes:** a new note starts when pitch moves by more than about 0.7 of a semitone and
   stays there for 40 ms; or when the level dips and returns (the same note sung twice); or after
   silence. Slides are given to the note they arrive at. Segments shorter than `minNoteMs` merge into a
   neighbour. `sensitivity` scales these thresholds.
5. **Pitch of each note:** the median of its middle 60%, rounded to a semitone. **Confidence:** from how
   steady the pitch was and how confident the frames were; it becomes `PNote.conf`.
6. **Snap to key** (optional): an unsure note sitting between a scale tone and a neighbour goes to the
   scale tone. Never moved by more than a semitone; never applied to confident notes.
7. **Timing:**
   - recorded against the click — onsets are mapped through the project's `TimeMap` from the take's
     `startTick`, corrected by `inputLatencyMs()`, and quantized by `strength`, with the remainder kept in
     `offset`;
   - recorded freely — a tempo is estimated from the onsets with `estimateTempo` (Stage 2) and offered; or
     the take is fitted to the song's existing tempo.
8. **Register:** people hum an octave or two below where a melody sits on a piano. Place the take in the
   melody track's range by whole octaves; `octaveShift` overrides.

Output notes have `origin: "hummed"`.

### Review — `src/capture/HumReview.tsx`

```
┌ Hum · take 2 ──────────────────────────────────────────────────┐
│  ▬▬▬╱▔▔▔▔╲▁▁▁▂▂▂▔▔▔▔▔     contour (thin line)                  │
│  ███  ████ ███ ██ █████    notes (blocks; hollow = unsure)     │
│                                                                │
│  ▶ my voice    ▶ the notes    ▶ both                           │
│  More notes ○───●──○ Fewer        Shortest note ○──●───        │
│  Snap to A minor [on]       Timing  as sung ○────● on grid     │
│  Octave  [−] 0 [+]                                             │
├────────────────────────────────────────────────────────────────┤
│  Add to song · Keep as idea · Only the rhythm · Tidy versions  │
└────────────────────────────────────────────────────────────────┘
```

- Sliders re-run `segmentTake` and `placeNotes` on the stored frames; nothing is re-recorded. Changes are
  instant.
- Tap a note for: up or down a semitone, split here, merge with next, delete.
- Unsure notes are drawn hollow. They are kept, not hidden: the author decides.
- **Add to song** inserts at the cursor on the melody track as one undo step. **Keep as idea** parks the
  take, with its recording, in the project's ideas. **Only the rhythm** discards pitch and creates rhythm
  slots (`setPending`), which Stage 3's step mode fills one key press at a time — with hints, once Stage 5
  is there. **Tidy versions** opens the Ideas tray with
  options derived from the take — as sung; snapped to key; rhythm tidied to the song's groove; and, with
  the co-writer on, its reading of what was meant — so cleaning up a rough hum is a choice among versions
  rather than one automatic guess.
- The take (its contour) is stored in `takes` and its recording in `blobs` (contracts §10), so it can be
  replayed and re-read later. A take can be
  deleted, recording and all, from the ideas drawer.

Tips shown on first use, because they matter more than any algorithm: sing "da-da-da" rather than a
hummed "mmm" (the consonant marks each note), keep the phone close, use headphones with the click.

## Work packages

| Id | Deliverable | Owns | Needs |
| --- | --- | --- | --- |
| S7.1 | Microphone capture: permission flow, worklet, worker, resampling, iOS audio-session handling, stopping cleanly | `src/audio/mic.ts`, `src/audio/worklets/`, `src/capture/worker.ts` | S2.5 |
| S7.2 | `PitchTracker` implementations: McLeod, SwiftF0 on `onnxruntime-web`; model hosting; fallback | `src/capture/trackers/`, `public/models/` | S7.1 |
| S7.3 | `segmentTake`, `placeNotes` and the note-accuracy scorer; synthetic fixtures | `src/capture/segment.ts`, `place.ts`, `score.ts`, `fixtures/hum/` | S2.1, S2.2 |
| S7.4 | Hum panel: record with count-in and click, live trace and lit key, level meter | `src/capture/HumPanel.tsx` | S7.1, S7.2, S3.1 |
| S7.5 | Review screen and its exits; takes in the ideas drawer; take and recording storage | `src/capture/HumReview.tsx`, `src/storage/` (the `takes` store) | S7.3, S7.4, S3.4; S5.6 for Tidy versions, hidden without it |
| S7.6 | Real-voice fixture set and tuning pass | `fixtures/hum/` | S7.3 |

S7.3 is pure and can start as soon as Stage 2 is done, alongside S7.1.

## Fixtures and the accuracy measure

- **Synthetic:** generated in the tests — sine and sawtooth tones stepping through known melodies, with
  vibrato, slides between notes, repeated notes separated by short dips, added noise, and a constant
  detune. The truth is known exactly.
- **Real:** at least twelve short recordings in `fixtures/hum/` with hand-checked notes beside them: a
  hum, a "da-da" sing, a whistle; low and high voices; a phone microphone in a quiet room and in a noisy
  one. The owner records these, or they come from a source whose licence allows it. Without them the
  stage cannot be called done.
- **Measure:** note F-measure — a transcribed note is right when its onset is within 100 ms of a true
  note's and its pitch is the same semitone after tuning correction.

## Acceptance criteria

1. The microphone is requested only when the author presses record in Hum, never on page load; refusing
   leaves the rest of Studio working; the stream's tracks are stopped within 200 ms of recording ending.
2. Nothing recorded is sent anywhere: no network request carries audio or pitch data (asserted in
   Playwright by watching requests during a full take).
3. The live trace follows a played tone within 80 ms, and the lit key matches a steady sung pitch.
4. On the synthetic set, note F-measure is at least 0.95, including the takes detuned by 40 cents and the
   takes with vibrato of ±40 cents.
5. On the real set, note F-measure is at least 0.80 at default settings, and at least 0.90 after
   adjusting at most two sliders per take.
6. A melody hummed against a 100 BPM click, a constant 60 ms late with 60 ms stored as the device's
   latency, lands on the intended grid steps.
7. A take sung an octave and a fifth below the melody track's range is placed inside the range.
8. Re-segmenting with a slider takes under 100 ms for a twenty-second take; transcription after stop
   completes in under half the take's length on a mid-range phone (throttled Chromium, per
   `agent-protocol.md`).
9. Add to song is one undo step producing notes with `origin: "hummed"` and a `conf` each; Only the rhythm
   produces the same number of rhythm slots as notes.
10. A full take works in Chromium with the fake-microphone flags and a fixture recording, end to end.
    The owner confirms the same by hand on an iPhone in Safari — record, review, add, then play the song
    back at normal volume — before the flag comes off.
11. With the model file blocked, transcription still returns notes through the fallback and the review
    screen says so.
12. Loading the Library, Practice, or Studio without opening Hum downloads neither the model nor the
    ONNX runtime.

## Test plan

- Unit: every step of `segmentTake` on synthetic contours; tuning estimation; octave placement; the
  scorer itself.
- Playwright (Chromium, fake microphone): the full flow; the no-upload assertion; the fallback.
- By hand: iPhone Safari and Android Chrome, speaker and wired headphones and Bluetooth, quiet and noisy
  rooms; and using the drum pads straight after a take (the iOS audio route).

## Risks

- **Real voices are messier than fixtures.** Scoops into notes, breathy onsets, drifting pitch. The
  review screen exists because no setting is right for everyone; the criteria ask for "good by default,
  right within two adjustments".
- **iOS audio behaviour** around the microphone is the most likely source of surprises, and some of what
  is written above comes from bug reports rather than documentation. Test on a real device early.
- **Repeated notes** on one pitch are the classic failure of pitch-only segmentation; the level-dip rule
  and the "da-da" tip are the defence.
- **Storage.** Recordings are large next to project data. Store compressed where the browser can encode,
  cap takes at two minutes, and show what is using space.

## Build notes

_Empty._
