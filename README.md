# Piano Tutor

Synthesia-style piano tutorials for learning specific songs.

- **Falling notes** over a piano keyboard, colour-coded by hand (green = right, blue = left).
- **Speed control** from 5% to 200%. Tempo changes, pitch doesn't.
- **Loop any passage** with an iPhone-clipper-style trimmer: drag the yellow
  handles over the song overview, or tap a section to loop it.
- **Skip ±5 s of listening time**: at 50% speed a skip moves 2.5 s of song.
- **Sounds**: Clear, Soft, Electric piano, Bright, Grand piano (sampled), switchable mid-play.
- **Hands**: each hand On / Soft / Off, stereo split (left hand left ear), metronome.
- **Hands together coach**:
  - sync lines linking notes both hands strike together
  - a live rhythm map of who plays on each count
  - step through one moment at a time
  - a routine that loops a passage as right hand → left hand → together at 60/80/100%

Keyboard: `Space` play/pause · `←/→` skip · `↑/↓` speed · `,`/`.` step · `L` loop · `M` metronome · `R` restart.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build to dist/
npm run check      # typecheck, lint, unit tests, build and browser tests
```

`npm test` runs the unit tests (Vitest). `npm run test:e2e` runs the browser tests (Playwright) against
the built app; the first time, run `npx playwright install chromium`. Both run in GitHub Actions on
every push. Conventions for working in this repository are in [CLAUDE.md](CLAUDE.md).

Addresses are in the hash: `#/play/rewrite-the-stars` opens a song. Links from before that
(`#rewrite-the-stars`) still work.

## Songs

Songs live in `public/songs/*.json` in the `piano-song/v1` format and are
listed in `public/songs/index.json`. See [docs/song-format.md](docs/song-format.md)
for the spec and how to convert a MIDI file:

```bash
npm run midi-to-song -- in.mid public/songs/my-song.json --id my-song --title "My Song"
```

## Deploy (Render)

`render.yaml` defines a static site. In Render: **New → Blueprint**, pick this
repo, and apply. Every push to the default branch redeploys.

## Where this is going

[docs/plan/](docs/plan/README.md) is the staged plan and specification for growing this into a song
library, a practice player and a song-building studio (manual entry, assisted writing, drum pads,
humming, and import from audio). Start with its README.

## Project layout

```
src/
  app/                   # routes, feature flags, error boundary, test hooks
  audio/player.ts        # scheduler: play/pause/seek, speed, looping
  audio/voices.ts        # the instruments and hand channels
  audio/testing.ts       # test harness: record what is scheduled, render to samples
  components/Stage.tsx   # falling notes + keyboard (canvas)
  components/Trimmer.tsx # loop trimmer / timeline
  components/Practice.tsx# controls and layout
  song/                  # song format types, loader, rhythm analysis
  music/ project/ assist/# shared types for the studio (see docs/plan)
e2e/                     # browser tests
public/songs/            # song data
scripts/midi-to-song.mjs # MIDI → song JSON
```

## Credits

The "Grand piano" sound is the Salamander Grand Piano by Alexander Holm, used under the
[Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/) licence, in the edition
published with [Tone.js](https://github.com/Tonejs/audio). The other sounds are synthesized. The app
shows the same credit at `#/credits`.
