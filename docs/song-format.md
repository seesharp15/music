# Song format (`piano-song/v1` and `v2`)

Every song in the bank is a single JSON file in `public/songs/`, listed in
`public/songs/index.json`. TypeScript types live in `src/song/types.ts`.

`piano-song/v2` is v1 with more optional fields. Every v1 file is still valid, the app reads both, and
nothing needs converting.

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
| `hand`     | `"L"`/`"R"` | Which hand plays it (drives colour and volume)  |
| `velocity` | 0–1         | Loudness, default 0.7                           |

Times are in **seconds at original speed**. The player handles slowing down
and speeding up, so files never change for tempo practice.

## What v2 adds

All optional, and mostly written by the Studio rather than by hand: `key`, `gridOffset`, `tempoMap`,
`tracks` (with a `track` id on each note, and a `volume` each), `chords`, `drums`, `pedal`, `origin`.
They are defined in `src/song/types.ts` and described in [plan/contracts.md](plan/contracts.md) §2.

`bpm` counts the beat the time signature names: `"bpm": 160, "timeSignature": [6, 8]` is 160 eighth
notes a minute, six to the bar. `tempoMap` entries count the same way.

A song compiled from a project (`compileProject` in `src/project/compile.ts`) is written in this
format with the id `u-<projectId>`, and any song can be turned back into a project to edit
(`projectFromSong`).

## The index

`public/songs/index.json` is what the Library shows, so that it never has to download a song to draw
its card. One entry per song, one entry per line:

```jsonc
{
  "id": "rewrite-the-stars", "title": "Rewrite the Stars", "artist": "The Greatest Showman",
  "file": "rewrite-the-stars.json",

  // decided by a person
  "genre": "film-tv",        // pop, film-tv, classical, neoclassical, jazz, rock, folk, game, holiday, original
  "tags": ["duet"],          // free text
  "difficulty": 3,           // 1 (easiest) to 5
  "addedAt": "2026-11-04",

  // worked out from the song file — never edit these
  "duration": 209.4, "bpm": 125, "noteCount": 1400, "range": [26, 82],
  "preview": [0.26, 0.24, …]   // 48 numbers: how busy the song is over time, for the thumbnail
}
```

After changing a song file or the index, run:

```bash
npm run songs:index            # refresh the worked-out fields
npm run songs:index -- --check # what CI runs: fails if the index is out of date
```

## Creating a song from MIDI

Most arrangements start as MIDI, either exported from notation software or
transcribed from audio (e.g. with Spotify's
[basic-pitch](https://github.com/spotify/basic-pitch)).

```bash
npm run midi-to-song -- input.mid public/songs/my-song.json \
  --id my-song --title "My Song" --artist "Someone" --source "https://…" \
  --genre pop --difficulty 2 --tags "ballad, easy"
```

This writes the song file and lists it in the index beside it, with today's date. Pass `--no-index` to
write the song file only.

Hand assignment:

- If the MIDI has two or more tracks with notes, the first is the right hand
  and the second is the left hand.
- Otherwise notes are split at `--split` (default 60, middle C): below goes to
  the left hand.

Then add `sections` to the song file by hand.
