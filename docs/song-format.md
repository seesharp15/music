# Song format (`piano-song/v1`)

Every tutorial is a single JSON file in `public/songs/`, listed in
`public/songs/index.json`. TypeScript types live in `src/song/types.ts`.

```jsonc
{
  "format": "piano-song/v1",
  "id": "rewrite-the-stars",
  "title": "Rewrite the Stars",
  "artist": "The Greatest Showman",
  "arranger": "…",
  "source": "https://…",          // where the arrangement came from
  "bpm": 100,                       // optional, for display / beat grid
  "timeSignature": [4, 4],          // optional
  "duration": 38.4,                 // optional, seconds; defaults to last note end
  "sections": [                     // optional, become one-tap loop presets
    { "name": "Intro (bars 1–8)", "start": 0, "end": 15.373 }
  ],
  "notes": [
    { "pitch": 64, "time": 0.0, "duration": 0.55, "hand": "R", "velocity": 0.8 }
  ]
}
```

## Notes

| Field      | Type        | Meaning                                         |
| ---------- | ----------- | ----------------------------------------------- |
| `pitch`    | int 21–108  | MIDI note number (60 = middle C)                |
| `time`     | seconds     | Start time from the beginning of the song       |
| `duration` | seconds     | How long the key is held                        |
| `hand`     | `"L"`/`"R"` | Which hand plays it (drives colour and muting)  |
| `velocity` | 0–1         | Loudness, default 0.7                           |

Times are in **seconds at original speed**. The player handles slowing down
and speeding up, so files never change for tempo practice.

## Creating a song from MIDI

Most arrangements start as MIDI, either exported from notation software or
transcribed from audio (e.g. with Spotify's
[basic-pitch](https://github.com/spotify/basic-pitch)).

```bash
npm run midi-to-song -- input.mid public/songs/my-song.json \
  --id my-song --title "My Song" --artist "Someone" --source "https://…"
```

Hand assignment:

- If the MIDI has two or more tracks with notes, the first is the right hand
  and the second is the left hand.
- Otherwise notes are split at `--split` (default 60, middle C): below goes to
  the left hand.

Then add the song to `public/songs/index.json` and add `sections` by hand.
