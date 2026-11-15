import type { Song } from "./types";

const FORMATS = ["piano-song/v1", "piano-song/v2"];

/** Validates and sorts a song so the rest of the app can rely on its shape. Accepts v1 and v2 files. */
export function normalize(raw: Song): Song {
  if (!FORMATS.includes(raw.format)) {
    throw new Error(`Unsupported song format: ${String(raw.format)}`);
  }
  const notes = raw.notes
    .filter((n) => n.duration > 0 && n.pitch >= 21 && n.pitch <= 108)
    .map((n) => ({ ...n, velocity: n.velocity ?? 0.7 }))
    .sort((a, b) => a.time - b.time || a.pitch - b.pitch);
  const lastEnd = notes.reduce((m, n) => Math.max(m, n.time + n.duration), 0);
  return { ...raw, notes, duration: raw.duration ?? lastEnd };
}
