# Piano Tutor

Synthesia-style piano tutorials for learning specific songs.

- **Falling notes** over a piano keyboard, colour-coded by hand (green = right, blue = left).
- **Speed control** from 25% to 150%. Tempo changes, pitch doesn't.
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
