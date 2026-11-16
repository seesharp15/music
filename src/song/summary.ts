import type { Song, SongIndexEntry } from "./types";

export const PREVIEW_SLICES = 48;

const round = (x: number, places: number) => Math.round(x * 10 ** places) / 10 ** places;

/**
 * How busy some notes are over time, as numbers from 0 to 1 for a card thumbnail. Each slice holds
 * the total time notes sound within it — a chord counts once per note — scaled so the busiest slice
 * is 1. The same sums as `preview` in scripts/lib/song-index.mjs, which writes the bank's index; a
 * test keeps the two in step. `time` and `duration` may be in any one unit.
 */
export function density(
  notes: readonly { time: number; duration: number }[],
  duration: number,
  slices = PREVIEW_SLICES,
): number[] {
  const out = new Array<number>(slices).fill(0);
  if (!(duration > 0)) return out;
  const width = duration / slices;
  for (const n of notes) {
    const end = Math.min(n.time + n.duration, duration);
    const first = Math.max(0, Math.floor(n.time / width));
    const last = Math.min(slices - 1, Math.floor((end - 1e-9) / width));
    for (let i = first; i <= last; i++) {
      out[i] += Math.max(0, Math.min(end, (i + 1) * width) - Math.max(n.time, i * width));
    }
  }
  const max = Math.max(...out);
  return out.map((v) => (max > 0 ? round(v / max, 2) : 0));
}

/** What the Library needs to draw a song's card without opening the song. */
export type SongSummary = Pick<SongIndexEntry, "duration" | "bpm" | "key" | "noteCount" | "range" | "preview">;

/** Everything an index entry says about a song that can be read off the song itself. */
export function summarize(song: Song): SongSummary {
  const notes = song.notes.filter((n) => n.duration > 0 && n.pitch >= 21 && n.pitch <= 108);
  const lastEnd = notes.reduce((m, n) => Math.max(m, n.time + n.duration), 0);
  const duration = round(song.duration ?? lastEnd, 2);
  const pitches = notes.map((n) => n.pitch);
  return {
    duration,
    ...(song.bpm ? { bpm: song.bpm } : {}),
    ...(song.key ? { key: song.key } : {}),
    noteCount: notes.length,
    ...(notes.length
      ? {
          range: [pitches.reduce((a, b) => Math.min(a, b)), pitches.reduce((a, b) => Math.max(a, b))] as [
            number,
            number,
          ],
        }
      : {}),
    preview: density(notes, duration),
  };
}
