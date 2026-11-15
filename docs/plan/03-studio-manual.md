# Stage 3 — Studio: building a song by hand

**Goal:** a complete, unassisted song builder. Someone can start an empty song, enter a melody, chords
and a bass line by tapping keys, playing live or drawing notes, arrange it into sections, and open the
result in Practice.

**Depends on:** Stage 2 · **Unlocks:** Stages 4, 5, 7, 8 (they all add to this screen) · **Size:** large ·
**Flag:** `studio`

## Why manual comes before assisted

The request is for an assistant that helps an author, not one that replaces them. That only holds if the
tool is complete without the assistant: every note the assistant can suggest, the author can also write,
move and delete by hand. So the hand tools are built and finished first, and Stages 4–8 are additions to
a working editor rather than its foundation.

## What the user gets

- **My songs** in the Library: start a new song, or open a copy of a bank song to change it.
- An **editor that looks like Practice** — the same falling-note waterfall over the same keyboard — in
  which the keyboard is the instrument you write with.
- Three ways to enter notes: **step by step** (tap a key, it lands at the cursor, the cursor moves on),
  **played live** against a click, and **drawn** directly on the waterfall. From a computer keyboard or a
  MIDI keyboard too.
- A **chord track** written with a chord picker that knows the key.
- **Sections** (intro, verse, chorus) that can be named, copied, moved and deleted.
- **Tracks** — melody, chords, bass, drums, plus any more — each with its own sound, volume and hand.
- **Practice it**: one tap and the song opens in Practice with left and right hands.

## The editor

### Why a waterfall and not a sideways piano roll

Most music software lays time left-to-right. This editor keeps time vertical, like Practice, for four
reasons: what you write looks exactly like what you will practise; the keyboard at the bottom is both
the pitch axis and the thing you play, with every note directly above its key; the keyboard is where
Stage 5 lights up suggested keys; and a tall phone held upright gets a long stretch of time to look at.
A horizontal view for wide screens is a possible later addition (Stage 9), not part of this stage.

### Layout

Phone, upright:

```
┌──────────────────────────────────┐
│ ←  My song ▾        ↶  ↷    ⋯    │  back · title (opens song settings) · undo · redo · menu
├────┬─────┬───────────────────────┤
│ 12 │ Am  │        ▮              │
│    │     │        ▮   ▮          │  later music, above the line
│ 11 │ F   │      ▮                │
│━━━━┿━━━━━┿━━━━━━━━━━━━━━━━━━━━━━━│  the cursor line: "now"
│ 10 │ C   │   ▮▮                  │  what is already written, below it
│  9 │     │  ▮                    │
│    │     │ ▏▕▏▕▏ ▏▕▏▕▏▕▏ ▏▕▏▕▏   │  keyboard
├────┴─────┴───────────────────────┤
│ 1 1/2 1/4 1/8 1/16   .  3  ‒  ⌒  │  note length · dotted · triplet · rest · tie
│ ⬚ ✎ ⌫      ●  ▶  ⟲   ♩=100       │  tools · record · play · loop · tempo
├──────────────────────────────────┤
│ Melody │ Chords │ Bass │ Drums │+│  the track that input goes to
└──────────────────────────────────┘
```

- Two gutters run beside the waterfall on the same time axis: **bar numbers with section colours**, and
  the **chord track**.
- The **cursor line** sits about 40% of the way up from the keyboard in edit mode, so what was just
  written stays visible beneath it. (In Practice the line is at the keyboard, and the past disappears;
  that would be useless for writing.) During playback the music scrolls past the line, as in Practice.
- Everything else opens as a **sheet** from the bottom on phones and a side panel on wide screens:
  tracks and mixer, chord picker, sections, song settings, note inspector. Later stages add their panels
  (pads, ideas, hum) to the same frame.
- The Studio fills the viewport and owns its gestures (`touch-action: none` on the canvas); the page
  itself does not scroll.
- On screens 1024 px and wider: tracks and sections in a left column, the editor in the middle, the
  inspector on the right, transport along the bottom.

### Seeing

- Notes are coloured by track: melody green and chords blue (the existing right- and left-hand colours),
  bass a darker indigo, extra tracks from a fixed palette, drum hits amber dots in a narrow lane at the
  right edge. A "colour by hand" toggle shows what Practice will show.
- The active track is drawn solid; other tracks are drawn at reduced opacity and are not selectable
  unless "edit all tracks" is on.
- Notes carry small marks for where they came from once later stages exist (played, hummed, suggested);
  in this stage every note is the author's and unmarked.
- Time zoom from one bar to sixteen bars on screen (pinch, or Ctrl/⌘ + wheel). Grid lines at the current
  snap step, heavier on beats, heaviest on bars.
- The keyboard shows the active track's range plus an octave either side, with ◀ ▶ to shift by an octave
  and the existing All / Song choices. Every C is labelled, as in Practice.

### Entering notes

| Mode | What happens |
| --- | --- |
| **Step** (default) | Press a key: a note of the chosen length is written at the cursor and the cursor advances by that length. Keys pressed together (within 60 ms, or while others are still held) form a chord and advance once. Rest advances without writing. Tie lengthens the note just written. Backspace removes the last entry and steps back. When the track has **rhythm slots** waiting (`Project.pending`: a tapped or hummed rhythm with no pitches yet, drawn as outlines), each key press instead gives the next slot its pitch, keeping the slot's start and length. |
| **Record** | Press record: a count-in bar, then the transport runs with a click and whatever is played is captured with its timing and velocity. On stop the take becomes one undo step, quantized to the song's grid with the played feel kept in `offset`; timestamps are corrected by `inputLatencyMs()`. A "keep my timing" switch sets the track's `feel` to 1 or 0: whether that feel is applied on playback. With a loop set, each pass adds a layer. |
| **Draw** tool | Tap an empty spot above a key: a note of the chosen length appears there, snapped to the grid. |
| **Listen** | Keys only make sound. For trying things out without writing. |

Sources of key presses, all through one input path: the on-screen keyboard (multi-touch, velocity from
how far down the key is touched), a **computer keyboard** ("musical typing": `A S D F G H J K` are the
white keys from C, `W E T Y U` the black keys, `Z` / `X` shift the octave), and a **MIDI keyboard** via
the Web MIDI API where the browser has it (note on and off with velocity; controller 64 drives the
sustain pedal live). Web MIDI exists in Chrome, Edge and Android browsers, and in Firefox behind a
permission prompt; Safari and every browser on iPhone and iPad lack it. Where it is missing the option
is hidden, not broken.

Every note sounds as it is entered, moved to a new pitch, or selected.

### Editing

- **Select** tool: tap a note to select it; tap another with Shift (or with "add to selection" on) to
  extend; drag across empty space for a box (long-press then drag on touch); `⌘/Ctrl+A` selects the
  active track.
- **Move:** drag a selection — vertically through time (snapped), horizontally to other keys (sounding as
  it goes). **Resize:** drag a note's top edge. **Duplicate:** Alt-drag, or the Duplicate button.
- **Erase** tool: tap or sweep across notes.
- **Inspector** for the selection: pitch (−12, −1, +1, +12), start and length in bars·beats·ticks,
  velocity, hand override (Auto / Left / Right), and for several notes: quantize, legato (extend each to
  the next), transpose, set velocity.
- Clipboard: cut, copy, paste at the cursor, within and across projects.
- Undo and redo for everything, labelled ("Undo move 3 notes").

Keyboard commands when musical typing is off, or with a modifier when it is on:

| Keys | Action |
| --- | --- |
| `Space` | Play / stop from the cursor |
| `Enter` | Record |
| `↑` `↓` | Cursor later / earlier by one step (`Shift`: one bar). With a selection: move it. |
| `←` `→` | With a selection: down / up a semitone (`Shift`: an octave) |
| `1`–`6`, `.`, `T`, `0` | Length whole … thirty-second, dotted, triplet, rest |
| `Backspace` | Delete selection, or the last step |
| `⌘/Ctrl` + `Z`, `Shift+Z`, `C`, `X`, `V`, `D`, `A` | Undo, redo, copy, cut, paste, duplicate, select all |
| `Q` | Quantize selection |
| `Tab` | Next track |
| `Esc` | Clear selection |

The canvas is not the only way in: the cursor and selection are fully keyboard-driven, and a live
region announces where the cursor is and what is selected ("E4, bar 3, beat 2, quarter note").

### Chord track

- Tap the chord gutter at a bar or beat to open the **chord picker**:
  - first row, large: the seven chords of the key, each showing its symbol and its Roman numeral
    (`Am` · `vi`);
  - second row: the usual visitors — the borrowed and secondary chords `borrowedChords(key)` returns;
  - "More": a root × quality grid for anything else, a bass-note selector for slash chords;
  - length: a bar, half a bar, a beat; and Remove.
  Tapping a chord plays it and sets it.
- With no key set, the picker shows the root × quality grid and suggests "Detect key" once there are
  enough notes.
- **Write to track** turns chord symbols into notes on the Chords track: block chords in close position,
  choosing the inversion that moves least from the previous chord, held for the chord's length or
  re-struck each bar or beat. It is a mechanical tool, so the notes count as the author's
  (`origin: "manual"`). Patterns and smarter voicings are Stage 5.
- Changing a chord symbol offers to rewrite the notes beneath it when those notes are still exactly what
  Write to track would produce for the old chord; otherwise the notes are left alone.

### Sections and arrangement

A **Sections** sheet lists sections with name, colour and length in bars: add at the end or at the
cursor, rename, resize, **duplicate** (everything on every track in that range is copied in after it),
**move** up or down (the music moves with it), and **delete** (with or without closing the gap). These
are built on three range operations added to the edit-op set: `insertTime`, `deleteTime`, `copyRange`.
Tapping a section loops it.

### Tracks, mixer, song settings

- **Tracks sheet:** per track — name, role, sound, hand (Left / Right), volume and mute (the same control
  as Stage 1), solo, lock, visibility; add, reorder, delete.
- **Song settings:** title and author; tempo with a tap-tempo button; time signature (2/4, 3/4, 4/4, 5/4,
  6/8, 7/8, 12/8); key, with "Detect from my notes" and "None"; swing amount; default snap; song length
  in bars (it grows by itself as notes are written past the end).
- **Transport:** play from the cursor, stop, record, loop (selection, section or bars), metronome,
  count-in on or off.

Playback is the Stage 2 player playing `compileProject(project)`; after each edit the song is recompiled
and swapped in with `setSong(…, { keepPosition: true })`.

### In and out

- **Library:** a "My songs" section above the song bank, one card per project (Edit, Practice, Duplicate,
  Export, Delete), plus a "New song" card. A bank song's card menu gains "Open a copy in Studio"
  (`projectFromSong`).
- **Practice it:** compile, save the song as `u-<projectId>`, go to `#/play/u-<projectId>`. Practice shows
  an "Edit in Studio" link for user songs.
- **Export:** the project (`.json`), the compiled song in the bank's format (`.json`, ready to drop into
  `public/songs/`), and a standard MIDI file (one MIDI track per project track, tempo and time-signature
  events included).
- **Import:** a project file, or a MIDI file (the logic of `scripts/midi-to-song.mjs`, in the browser,
  producing a project).

### Keeping the author's work safe

From this stage on, the browser holds things that cannot be re-downloaded. Three protections, all cheap:

- **Installable.** A web app manifest and a minimal service worker that caches the app shell, so the app
  can be added to the home screen. This matters beyond convenience: Safari may clear a site's stored data
  after a week without use unless it is installed. When the author has a first saved project and the app
  is not installed, say so once, with how to install on their device.
- **Persistent storage** requested at the first save (Stage 2), with the outcome shown in Settings.
- **Backups.** "Export all my songs" (one file) in Settings; a quiet reminder on the Library when there
  are projects changed since the last export and more than two weeks have passed.

### First run

An empty project does not open on a blank canvas. It shows three large choices over the editor:
"Tap it in, one note at a time", "Play it live", "Start with chords". Later stages add "Hum it", "Tap a
beat" and "Bring in a recording" to the same place.

## Internals

- `src/studio/view.ts` — pure view maths: `{ centreTick, ticksPerPx, keyLo, keyHi }` ⇄ pixels;
  `tickAtY`, `yAtTick`, `pitchAtX`, hit-testing notes and handles.
- `src/studio/interaction.ts` — a pure state machine: pointer and key events in, *intents* out (select,
  move by Δ, resize, add, erase, scroll, zoom). No canvas, no store: unit-testable gesture logic.
- `src/studio/EditorCanvas.tsx` — draws. Shares key and note drawing with Practice through helpers
  extracted from `Stage.tsx` into `src/components/stage-draw.ts`; Practice's `Stage` keeps its behaviour.
- `src/studio/ui-store.ts` — cursor, selection, tool, mode, active track, zoom. Not undoable. Cursor,
  zoom, active track and tool are saved per project under `studio:<projectId>` (contracts §10).
- `src/studio/layers.ts` — the canvas draws through an ordered list of **layers**, each a small module
  with `draw(ctx, view, state)` and an optional `hitTest`. Notes, gutters and the cursor line are the
  first layers. Later stages add theirs — the drum lane, key hints, ghost notes for options, origin
  tints, review marks — as new files registered with `registerLayer`, without editing
  `EditorCanvas.tsx`. That is what lets those stages run in parallel.
- `src/studio/input.ts` — one `NoteInput` event stream fed by on-screen keys, musical typing and MIDI;
  step and record modes consume it.
- `src/studio/realize.ts` (pure zone candidate: put the logic in `src/music/voicing.ts`) — block-chord
  voicing with least-movement inversions.
- In test builds `window.__app.store` and `window.__app.ui` expose state for Playwright.

## Work packages

| Id | Deliverable | Owns | Needs |
| --- | --- | --- | --- |
| S3.1 | Studio route and frame (phone and wide layouts, sheets), project list, My songs in the Library, new / duplicate / delete / rename, first-run choices, the read-only screen for a project that fails to load | `src/studio/Studio.tsx`, `src/studio/sheets/`, `src/library/` | S2.3, S2.6 |
| S3.2 | Editor canvas: the layer list; notes, rhythm slots, gutters, cursor line, grid; zoom and scroll; playback follow; shared draw helpers; the UI store and its per-project persistence | `src/studio/EditorCanvas.tsx`, `layers.ts`, `view.ts`, `ui-store.ts`, `src/components/stage-draw.ts` | S2.4, S2.5 |
| S3.3 | Interaction state machine, tools, selection, move / resize / add / erase, inspector, clipboard, keyboard commands, live region | `src/studio/interaction.ts`, `Inspector.tsx` | S3.2 |
| S3.4 | Note input: on-screen keys, step mode (including filling rhythm slots), record mode with count-in and quantize, musical typing, MIDI in | `src/studio/input.ts`, `StepBar.tsx`, `src/audio/midi-in.ts` | S3.2, S2.5 |
| S3.5 | Chord gutter editing, chord picker, Write to track | `src/studio/chords/`, `src/music/voicing.ts` | S3.2, S2.2 |
| S3.6 | Sections sheet; `insertTime`, `deleteTime`, `copyRange` ops | `src/studio/sections/`, `src/project/ops.ts` | S3.2 |
| S3.7 | Tracks and mixer sheet, song settings, tap tempo, transport and loop | `src/studio/tracks/`, `Transport.tsx`, `SongSettings.tsx` | S3.1, S2.5 |
| S3.8 | Practice it — including Practice loading `u-…` songs from the device through the catalog instead of fetching them; exports (project, song, MIDI); imports (project, MIDI); "open a copy" | `src/studio/io.ts`, `src/project/midi.ts`, the song loading in `src/App.tsx` | S3.1, S2.4 |
| S3.9 | Installable app (manifest, shell-caching service worker), install prompt, export-all, backup reminder | `public/manifest.webmanifest`, `src/sw.ts`, `src/app/settings/` | S3.1, S2.6 |

S3.1 and S3.2 first, in parallel. Then S3.3–S3.9 can spread across agents: they meet only at the UI
store, the layer list and the sheet frame, all fixed by S3.1 and S3.2.

## Acceptance criteria

1. **The "Twinkle" run-through** passes as a Playwright test at phone and desktop sizes: new song in
   C major at 100 BPM → fourteen notes entered in step mode from the on-screen keys → chords C, F, C, G, C
   set from the picker → Write to track → play → Practice it. Practice then shows the melody in the right
   hand and chords in the left, the bar count is right, and the Library lists the song under My songs.
2. In step mode, three keys pressed together write one three-note chord and advance the cursor once.
3. Record mode against the click with a scripted performance (events injected with timestamps up to
   40 ms off the grid) produces notes on the right grid steps with the differences kept in `offset`.
4. Dragging a note two keys right and one beat later changes exactly `pitch` and `tick` of that note; one
   undo restores it; the store received one `apply` call.
5. Every editing action in this document is reachable by keyboard alone; the live region announces cursor
   moves and selections.
6. Duplicating a four-bar section of a song with three tracks and a drum clip yields eight bars whose
   second half equals the first on every track; moving a section moves its chords, notes and clips
   together; undo restores the original in one step.
7. Changing a chord under untouched Write-to-track notes rewrites them; changing a chord under notes the
   author has edited leaves them alone.
8. MIDI export then MIDI import reproduces every note's pitch, tick and length; project export then
   import is deep-equal.
9. With a 3,000-note project the editor holds 60 frames per second while playing and while dragging on a
   mid-range phone — checked by the agent in throttled Chromium and by the owner on a device, as
   `agent-protocol.md` describes — with the performance trace attached to the PR.
10. Key press to sound in the editor adds no more than one audio render quantum beyond the device's own
    output latency (the Stage 2 measurement, through the real UI).
11. Closing the tab mid-edit and reopening restores the project, the cursor position and the zoom. A
    stored project that fails validation opens read-only with the errors summarised and the newest good
    snapshot offered; it never crashes the Studio.
12. With the `studio` flag off, no Studio code is downloaded and the Library shows no My songs section.
13. Practice is unchanged: its smoke and scheduling tests pass, and its `Stage` draws pixel-identical
    frames for a fixture song before and after the draw-helper extraction.
14. The app passes the browser's installability checks; after installing and going offline, the app shell
    opens and a saved project loads. Export-all followed by import on a clean profile restores every
    project.

## Test plan

- Unit: view maths, the interaction state machine (table-driven: event sequence → intents), step-mode
  chord grouping, record quantization, voicing choice, range ops, MIDI round trip.
- Playwright: the run-through; drag, resize and box-select with real pointer events; keyboard-only
  editing; flag off.
- By hand: an iPhone and an Android phone, upright and sideways; a MIDI keyboard in Chrome.

## Risks

- **Editing on a phone is the hard part.** Small notes under a thumb, and gestures that fight each other.
  Mitigations already in the design: explicit tools instead of gesture guessing, a 44 px minimum hit area
  around notes regardless of drawn size, zoom, and step entry that needs no precision at all. Expect to
  iterate on this with the owner; budget for it.
- **Vertical time is unusual** for editing. If it proves awkward for long songs, the fix is the horizontal
  view in Stage 9, which is why `view.ts` keeps the maths separate from the drawing.
- **Shortcut collisions** between musical typing and commands. One switch decides which the letter keys
  do; it is visible in the transport bar.

## Build notes

_Empty._
