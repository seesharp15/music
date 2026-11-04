# Piano Tutor

Synthesia-style piano tutorials for learning specific songs.

- **Falling notes** over a piano keyboard, colour-coded by hand (green = right, blue = left).
- **Speed control** from 25% to 150%. Tempo changes, pitch doesn't.
- **Loop any passage** with an iPhone-clipper-style trimmer: drag the yellow
  handles over the song overview, or tap a section to loop it.
- **Hand practice**: mute the left or right hand.

Keyboard: `Space` play/pause · `←/→` skip 2s · `↑/↓` speed · `L` loop · `R` restart.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build to dist/
```

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

## Project layout

```
src/
  audio/player.ts        # Web Audio scheduler: play/pause/seek, speed, looping
  components/Stage.tsx   # falling notes + keyboard (canvas)
  components/Trimmer.tsx # loop trimmer / timeline
  components/Practice.tsx# controls and layout
  song/                  # song format types and loader
public/songs/            # song data
scripts/midi-to-song.mjs # MIDI → song JSON
```

Piano sound: Salamander Grand Piano samples via Tone.js, with a synth fallback.
