# Stage 5 — Assist I: suggestions that run on the device

**Goal:** the assistive layer that needs no server. Keys that light up for what might come next; sets of
melody ideas to choose from, vary and evolve; chord progressions and bass or accompaniment parts for a
melody; melodies for a chord progression. All instant, all offline, all the author's to take or leave.

**Depends on:** Stage 3 (Studio), Stage 2 (theory, analysis), Stage 4 for rhythm-first and kick-locked
bass (optional) · **Unlocks:** Stage 6 (the language-model co-writer plugs into the same tray), Stage 8
(arranging imported audio reuses the accompaniment writers) · **Size:** large · **Flag:** `assist`

## The rules this stage must keep

These are the product's promise about authorship. Each is testable, and the acceptance criteria test
them.

1. **Nothing enters the song without an explicit act.** Hints are light on keys. Options are ghosts until
   taken. No auto-complete, no auto-apply.
2. **Hear before choosing, undo after.** Every option can be auditioned in place, in context. Taking one
   is a single undo step.
3. **Options, not answers.** Requests return several alternatives that really differ, each labelled in
   plain words with what it does.
4. **The author's notes are not touched** unless they selected them and asked. Locked notes and locked
   tracks come back unchanged.
5. **Steerable.** The author can say more or less surprising, busier or sparser, keep my rhythm, follow
   this shape, and get options that obey.
6. **Explained.** Every option carries one sentence of why. Theory words come with plain-language
   glosses.
7. **Provenance is kept and shown.** Each note records where it came from; changing a suggested note
   marks it as changed by the author.
8. **Complete without it.** With `assist` off, Studio is the full Stage 3 tool.
9. **It adapts without boxing in.** What the author takes and rejects nudges later suggestions; one
   option in every set is deliberately from outside those habits; the learned preferences are visible and
   can be reset or switched off.
10. **No overall grade.** Analysis describes the melody along several dimensions. It never reduces the
    author's work to a score to be chased.

## What the user gets

- **Key hints** on the keyboard, with four settings: Off, Scale, Chord, Smart; and a Spice slider.
- An **Ideas** tray: ask for options, hear them, take one (or part of one), keep one for later, or
  **evolve** one into a new set.
- Requests for melody: **continue**, **vary**, **answer**, **fill a gap**, **pitches for my rhythm**,
  **follow a shape I draw**, **melody over my chords**.
- Requests for support: **chords for my melody** in several flavours, **swap this chord**, **bass line**,
  **accompaniment pattern**.
- **Help me find it**: a few quick "more like A or more like B?" listening choices that set the
  assistant's direction when the author cannot put it into words.
- A **Melody coach** panel: what makes the selected phrase stick, and what might make it stick more.
- An **authorship view**: which notes the author wrote, which they took, which they changed.

## Design

All logic is in the pure zone under `src/assist/core/`, deterministic given a seed, and runs in a Web
Worker except hints, which are fast enough for the main thread.

### 5.1 Reading the moment — `context.ts`

`contextAt(project, trackId, tick)` gathers what every suggester needs: the key there; the chord sounding
and the next chord; how strong the beat is (`metricWeight`); the last eight notes of the track; where the
cursor sits in its phrase; motifs already present in the song (from `analysis.ts`); the track's
comfortable range; the author's preference profile.

When there is no chord track, the chord is inferred from the other tracks' sounding notes
(`detectChord`); when there is no key, from `detectKey`; when there is nothing at all, hints fall back to
Scale mode on C major and say so.

### 5.2 Key hints — `hints.ts`

`hintsAt()` (contracts §7) scores every pitch within an octave and a half of the previous note and
returns the scores as strengths.

| Feature | What it rewards | Reason code |
| --- | --- | --- |
| Harmonic fit | Chord tones, most of all on strong beats; then colour tones (9th, 11th on minor, 13th); then other scale tones; a chromatic note only as a half-step approach into the next chord on a weak beat | `chordTone`, `tension`, `scaleTone` |
| Motion | Steps most, small leaps less, large leaps little; a repeated note moderately | `step` |
| After a leap | Turning back by step after a leap of a fourth or more | `resolvesLeap` |
| Pull | Leading tone to tonic, fourth to third, and at a phrase end the stable degrees | `tendency` |
| Range | Staying near the middle of the track's range | — |
| Pattern | The pitch that would continue a motif the author has already used: when the last few intervals match the opening of an earlier figure, the note that completes it — at the same pitch level or shifted along the scale | `motif` |
| Habit | A light pull toward intervals and degrees this author favours in this song | `yourHabit` |

Modes: **Scale** lights every scale tone equally. **Chord** lights chord tones. **Smart** uses all
features. **Spice** (0–1) shifts weight from chord tones and steps toward colour tones, approach notes and
leaps. Weights start as hand-set constants in one table (`weights.ts`); see Priors below.

On screen: the strongest three keys glow, the next few glow faintly, the rest not at all — a carpet of
light would say nothing. The same strengths appear as a soft glow on the cursor line above those keys.
While notes are being played quickly the lights hold still and update after a pause of about 400 ms, so
they inform rather than flicker. Hints start **Off** in a new project; the first-run screen asks "write
with hints, or without?", and the choice is remembered per project (`studio:<projectId>`, contracts §10).
Holding a lit key (or hovering) says why: "the 3rd of A minor", "finishes the pattern from bar 2",
"steps back after the leap". With Tap rhythm slots waiting (Stage 4), hints follow the slot being filled.

### 5.3 Melody ideas — `melody.ts`

A melody option is a rhythm and a pitch for each note of it.

**Rhythm** comes from, in order of preference: the notes the author locked or the rhythm slots they
tapped (`keep: "rhythm"`, `melody.fromRhythm`); the rhythm of an earlier phrase in the same song, which
is what makes a continuation sound like the same tune; otherwise a library of about forty one-bar rhythm
cells chosen by density and chained with a repetition scheme (AABA, ABAB, AABC).

**Pitches** come from a beam search (width 32) over the rhythm's notes, using the hint scorer as the
step-by-step likelihood and adding phrase-level terms: end on a stable degree for a closed phrase or an
open one for a phrase that wants an answer; one clear high point; stay in range; match the requested
contour. `surprise` sets how adventurous sampling within the beam is.

**Requests:**

| Kind | What it produces |
| --- | --- |
| `melody.continue` | The next 1, 2, 4 or 8 bars after the cursor |
| `melody.vary` | The selection, changed in one named way: shifted along the scale (sequence), mirrored, same rhythm with new pitches, same pitches with new rhythm, decorated with passing and neighbour notes, simplified to its skeleton, new ending only, moved an octave |
| `melody.answer` | A reply to the selected phrase: same rhythm, similar opening, a closing cadence |
| `melody.fill` | Notes joining what comes before a gap to what comes after it |
| `melody.fromRhythm` | Pitches for tapped or locked rhythms |
| `melody.fromContour` | Notes following a line the author draws across the bars with a finger (`controls.shape`) |
| `melody.fromChords` | A melody over existing chords, offered **skeleton first**: one or two structural notes per bar, forming a smooth line through the chords' thirds and sevenths. The author adjusts the skeleton; **Decorate** then adds the notes between at the chosen density. |

**Choosing which to show.** The search produces dozens of candidates; four are shown. They are picked for
quality *and* difference (maximal marginal relevance over a distance that compares interval and rhythm
sequences), so the set never contains four near-copies. One of the four is the **wildcard**: drawn with
the author's preference profile ignored and `surprise` raised.

**Labels and reasons** are written from measured traits, not templates pasted on: "Steps up, lands on the
5th", "Your rhythm, new ending", "Leap, then falls back". The rationale adds one sentence: "Repeats bar
1's rhythm so it sounds like the same tune, and ends on E, the 5th, which leaves it open."

### 5.4 Chords for a melody — `harmony.ts`

1. Cut the melody into slots: a bar, half a bar or a beat (`harmonicRhythm`).
2. For each slot, score every chord in the flavour's palette against the melody notes in it, weighted by
   length and beat strength: chord tones count for it, colour tones a little, clashes (a note a semitone
   above a chord tone, the fourth over a major chord on a strong beat) against.
3. Score each chord-to-chord move from a transition table for the flavour, plus root-motion preferences.
4. Add phrase terms: a cadence at the phrase end, a stable chord at the start, and for a section that
   repeats, a last chord that leads back to the first.
5. Find the best several paths (k-best Viterbi), then pick four that differ.
6. Also test the melody against a list of well-worn loops (I–V–vi–IV and its rotations, I–vi–IV–V,
   ii–V–I, i–♭VII–♭VI–V, twelve-bar blues …) and include any that fit well, labelled as the familiar
   thing they are.

| Flavour | Palette |
| --- | --- |
| `simple` | I, IV, V, vi |
| `pop` | All diatonic triads, sus and add9 colours |
| `soulful` | Diatonic sevenths, ii–V movement, secondary dominants |
| `moody` | Borrowed chords: iv, ♭VI, ♭VII, ♭III in major; Dorian and Phrygian colours in minor |
| `bright` | Lydian II, major sevenths, add-note chords |
| `classical` | Functional harmony with secondary dominants and inversions for a stepwise bass |

Each option shows its chord symbols, its Roman numerals, and a reason: "Under your long A in bar 3 this
puts F, making the A its bright 3rd."

`harmony.substitute` lists replacements for one selected chord, ranked by how well they carry the melody
and how smoothly they connect: the relative chord, a secondary dominant of what follows, the tritone
substitute, sus and added-note versions, the borrowed version. `harmony.reharmonize` redoes a whole
section in another flavour while keeping chords the author locked.

### 5.5 Bass and accompaniment — `accompany.ts`

Pure writers, each `(chords, meter, key, drums?, controls) → notes`, registered in a style table.

- **Bass** (`bass.line`) — the "single notes that support the tune" case: held roots; roots that strike
  with the kick drum (reads the drum track); root and fifth; octaves in eighths; walking quarters with
  approach notes into each new root; pedal note; rolling arpeggio.
- **Accompaniment** (`accompaniment.pattern`) — the "actual chords" case: held blocks; pulsed blocks in
  quarters or eighths; broken chord (1–5–8–5); arpeggio up, down, up-and-down; Alberti; waltz;
  stride; ballad roll (root–5th–10th); syncopated pop.
- **Voicing** for either: close with least-movement inversions, shell (root with 3rd or 7th), open (root
  and 10th), rootless.
- **Playable by a hand.** The left hand spans at most a ninth by default (`Project.handSpan`, adjustable
  in song settings), at most four notes at once, and no leap larger than an octave between consecutive eighths at
  the song's tempo. A writer that cannot satisfy this simplifies its own output and says so in the
  rationale.

Four styles are offered at a time, chosen to suit the meter and density; **Evolve** on one varies its
rhythm, register or voicing.

### 5.6 The Ideas tray — `src/assist/ui/`

```
┌ Ideas · continue melody · 2 bars ───────────────────────────────────────┐
│ Surprise ●────○   Density ○──●──   Shape [arch ▾]   Keep [—]            │
├────────────────┬────────────────┬────────────────┬──────────────────────┤
│ ▁▂▃▅▃▂         │ ▅▃▂▃▅▆         │ ▂▂▅▂▂▅         │ ▁▆▃▅▂▇   wildcard    │
│ Steps up,      │ Falls, then    │ Your rhythm,   │ Wide leaps,          │
│ lands on 5th   │ climbs home    │ new ending     │ ends open            │
│ ▶ ✓ ♲ ☆ ✕      │ ▶ ✓ ♲ ☆ ✕      │ ▶ ✓ ♲ ☆ ✕      │ ▶ ✓ ♲ ☆ ✕            │
└────────────────┴────────────────┴────────────────┴──────────────────────┘
  More like these · Something different                            Why? ▸
```

- **Asking.** An Ideas button offers what makes sense where the author is: at the end of a melody,
  Continue; with a phrase selected, Vary / Answer / Chords for this / Bass for this; with chords and no
  melody, Melody over chords; between two phrases, Fill. The request, its controls and its seed are shown,
  so the author can see what was asked.
- **▶ Audition.** The option is applied to a copy (`store.preview`), compiled, and looped with a bar of
  lead-in, in context with the other tracks. Its notes appear on the waterfall as dashed outlines. A/B
  toggles between the song as it is and the song with the option.
- **✓ Take.** Applies the ops as one undo step. Notes get `origin: "suggested"` and the suggestion's id.
  **Take part**: tap the ghost notes wanted, then take only those.
- **♲ Evolve.** Four children of that option, with the parent kept at the left for comparison and a trail
  back through the generations. A **how different** control (`controls.distance`) sets the size of the mutation, from
  "nearly the same" to "loosely related". Listening tires quickly, so a round is four options, not twelve.
- **☆ Keep.** Parks it in the project's ideas for later; an Ideas drawer lists parked ideas, takes and
  tapped rhythms, and any can be dragged onto the song.
- **✕ Dismiss.** Removes it and counts as a "not this".
- **Controls** change the request and re-run it. "More like these" keeps the controls and changes the
  seed; "Something different" raises surprise and excludes anything near what has been shown.
- **Why?** opens the rationale and the measured traits for each option.

Every request and its outcome is recorded as a `SuggestionRecord` — beside the project, not in it
(contracts §10). Asking, auditioning, dismissing and answering listening questions leave the project file
untouched; only Take and Keep change it.

### 5.7 Help me find it — `probes.ts`

When the author knows what they want only when they hear it. Over the song's own chords and beat (or a
neutral backing when there are none), the tool plays two short contrasting examples and asks "more like A
or more like B?" — with "neither" and "skip". Three to five rounds, each isolating one dimension: rising
or falling shape; sparse or busy; stepwise or leaping; on the beat or syncopated; and, when there are no
chords yet, bright or dark harmony. The answers set the tray's starting controls and are written into the
preference profile. Examples are made by the generators above with one control pushed to each extreme, so
this costs nothing and works offline.

### 5.8 Melody coach — `coach.ts`

For the selected phrase, a panel of observations. Each has a measured value shown as a short bar, one
sentence about this melody in particular, and where relevant a **Try** button that puts a request into
the Ideas tray (never straight into the song).

| Dimension | Measured as | Example of what it says |
| --- | --- | --- |
| Repetition | Share of the phrase covered by a motif that recurs, exactly or shifted | "Bar 3 repeats bar 1 a step higher — that sequence is the hook." |
| Rhythmic identity | Whether one rhythm cell recurs; share of off-beat onsets | "Every bar has a different rhythm; repeating one makes a line easier to remember." |
| Shape | Fit to an arch; where the highest note falls | "The high point comes in the first bar, then it only descends." |
| Motion | Share of steps; whether leaps turn back | "Mostly steps with one leap of a sixth — the leap is what stands out." |
| Singable range | Span and where it sits | "An octave and a fourth: wide for a chorus." |
| Landing | Share of strong beats on chord tones | "Three of four downbeats land on chord tones." |
| Ending | Final degree and its stability | "Ends on the 2nd — it asks for an answer." |
| Balance | Phrase lengths and their symmetry | "Two bars answered by three: the extra bar delays the ending." |
| Expectedness | Average of the hint scorer's surprise at each note | "Very predictable until the last bar." |

The research behind each dimension is listed in [research.md](research.md) §C. The measured effects are
modest and some are disputed, which is one more reason there is no total: the wording describes; it does
not grade.

### 5.9 Preferences and authorship — `profile.ts`, authorship view

- **Preference profile** (contracts §7), one per project and one across all songs, both stored outside
  the project (contracts §10) and passed to providers on the request: running averages, updated on take
  (full weight), keep (half) and dismiss (negative half), over: surprise, density, step-versus-leap, favoured flavours and accompaniment
  styles. Used to set the tray's default controls and as a small term (at most 15%) in ranking. The
  wildcard option ignores it. A panel states it in plain words — "You usually pick stepwise lines and
  sparse bass" — with Reset and an on/off switch. It never leaves the device in this stage.
- **Authorship view:** a toggle that tints notes by origin — written by the author, played, hummed,
  suggested and unchanged, suggested and changed by the author, imported — and a one-line summary: "64 of
  80 notes are yours or changed by you." A mirror, not a verdict.

### Priors

Two tables drive the suggestions: melodic step weights and chord transition weights per flavour. They
start as **hand-set constants from standard practice**, which needs no data and no licence. A later,
optional package may refit them on a corpus — only one whose licence plainly allows shipping derived
statistics (the short list is in [research.md](research.md) §C; Hooktheory's data is not on it) — and only
if a held-out comparison shows the fitted tables predict real melodies better than the hand-set ones.

## Work packages

| Id | Deliverable | Owns | Needs |
| --- | --- | --- | --- |
| S5.1 | `contextAt`, scorer features and weights table, `hintsAt` with modes and Spice | `src/assist/core/context.ts`, `hints.ts`, `weights.ts` | S2.2 |
| S5.2 | Hint display on keys and cursor line, mode switch, "why" popover | `src/studio/layers/hints.ts`, `src/assist/ui/HintControls.tsx` | S5.1, S3.2 |
| S5.3 | Melody generators: rhythm sources, beam search, all `melody.*` kinds, variation transforms, diversity pick, labels | `src/assist/core/melody.ts`, `rhythm-cells.ts`, `label.ts` | S5.1 |
| S5.4 | Harmonizer: scoring, k-best, flavours, known loops, substitute, reharmonize | `src/assist/core/harmony.ts` | S2.2 |
| S5.5 | Bass and accompaniment writers, voicings, playability check; and, when Stage 4 is present, drum options (`drums.pattern`, `drums.fill`) drawn from its starter grooves and Vary | `src/assist/core/accompany.ts`, `drums.ts`, `src/music/voicing.ts` | S2.2, S3.5; S4.6 for the drum options |
| S5.6 | `validateOption` (contracts §7); local provider in a worker; Ideas tray: asking, audition with ghosts, take, take part, evolve, keep, dismiss, controls, records; Ideas drawer | `src/assist/core/validate.ts`, `src/assist/providers/local.ts`, `src/assist/ui/`, `src/studio/layers/ghosts.ts` | S5.3 or S5.4 (one is enough to start), S3.3 |
| S5.7 | Contour drawing input; Help me find it | `src/assist/ui/Contour.tsx`, `src/assist/core/probes.ts` | S5.3, S5.6 |
| S5.8 | Melody coach | `src/assist/core/coach.ts`, `src/assist/ui/Coach.tsx` | S5.1, S5.6 |
| S5.9 | Preference profile and panel; authorship view | `src/assist/core/profile.ts`, `src/assist/ui/Profile.tsx`, `src/studio/layers/origin.ts` | S5.6 |

S5.1 first. Then S5.3, S5.4 and S5.5 are independent pure-logic packages well suited to parallel agents,
while S5.2 and S5.6 build the UI against the `AssistProvider` interface with a stub provider.

## Acceptance criteria

**Rules**

1. Through asking, auditioning, evolving, dismissing and answering Help-me-find-it questions, the stored
   project stays byte-identical to before the first request; it changes only on Take or Keep. Take is
   exactly one undo step, and undoing it restores the project byte-identically.
2. Notes listed in `locked`, and every note on a locked track, are unchanged in every option of every
   kind, over 500 seeded random requests.
3. A taken note has `origin: "suggested"` and its `sid`; moving it sets `edited: true`; the authorship
   summary counts it accordingly.
4. With `assist` off, no assist code is downloaded and Studio passes the Stage 3 run-through.

**Hints**

5. `hintsAt` returns within 8 ms for any cursor position in a 3,000-note project on a mid-range phone
   (in throttled Chromium, per `agent-protocol.md`).
6. In C major over a C chord on a downbeat with previous note D4, Smart mode's strongest hints are C4 and
   E4. After an upward leap C4 → A4, the strongest is G4. With the last three notes matching the start of
   an earlier four-note motif, the note completing it is among the top two with reason `motif`. (These
   and about twenty similar cases form the scorer's table test.)
7. No more than three keys show the strong glow at once; reasons are available by hover, long-press and
   keyboard focus.

**Options**

8. Every option of every kind passes `validateOption` over 1,000 seeded requests: notes in range and on
   the grid, no overlaps within a voice, exact requested length. In addition every melody and bass pitch
   is one of: a note of the key; a note of the chord sounding beneath it; or a half-step approach into the
   next note on a weak beat. Every chord comes from the palette of the requested flavour.
9. Same request and seed give identical options; a different seed gives a different set.
10. The four options in a set differ: every pair is at least 0.25 apart on the selection distance.
11. `keep: "rhythm"` options have exactly the selection's onsets and lengths; `melody.fromContour` options
    correlate with the drawn contour at 0.6 or better; `melody.fill` options begin and end on the anchor
    notes.
12. For the melody of "Twinkle, Twinkle" in C, `harmony.harmonize` with `simple` includes the textbook
    harmonization (C C F C | F C G C) among its four; in every flavour at least 90% of strong-beat melody
    notes are chord tones or named colour tones of the chord beneath them.
13. Every bass and accompaniment option respects `handSpan`, the four-note limit and the leap limit, at
    60 and at 160 BPM.
14. Four options for four bars arrive within 300 ms (95th percentile) on a mid-range phone, generated off
    the main thread; the editor does not drop a frame while they are computed.
15. Each option has a non-empty label and rationale that mention at least one trait measured from that
    option, and no two options in a set share a label.

**Listening**

16. The owner reviews a fixed set of ten seed songs (melody only, chords only, both), asking for each kind
    once. Pass: at least one of the four options is something they would keep in at least eight of ten
    cases for chords, bass and accompaniment, and in at least six of ten for melody kinds. (For scale: the
    closest commercial tool reports about one suggestion in four accepted.) The session is recorded in
    `docs/plan/spikes/assist-listening.md` with what failed and why; failures become weight changes or
    bugs.

**Coach and profile**

17. The coach's measurements match hand-computed values on five fixture phrases; no number labelled as an
    overall score appears anywhere.
18. After ten takes of low-surprise options the tray's default surprise has moved down; the wildcard is
    still present; Reset returns defaults.

## Test plan

This stage is mostly pure functions and should have the densest unit-test coverage in the project: table
tests for the scorer and harmonizer, property tests over seeded random requests for validity, determinism,
locks and diversity, golden tests for a handful of well-known tunes. Tray behaviour in Playwright against
a stub provider with fixed options. Criterion 16 is a person listening, on purpose: nothing else catches
"valid but dull".

## Risks

- **Valid but dull.** Rule-based generators produce correct, forgettable lines. Defences: rhythm taken
  from the author's own material, motif continuation, the wildcard, evolve, and above all criterion 16.
  Stage 6 adds a second source of ideas through the same tray.
- **Weight tuning is endless.** All weights live in one table with the scorer's table test beside it;
  changes that fix one case must keep the table green.
- **Too many controls.** Start the tray with Surprise and Density only; the rest sit behind "More".
- **Hints becoming a crutch or a nag.** Off is one tap away and is remembered per project.

## Build notes

_Empty._
