import type { Song, SongIndexEntry } from "./types";

export async function loadIndex(): Promise<SongIndexEntry[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}songs/index.json`);
  if (!res.ok) throw new Error(`Failed to load song index (${res.status})`);
  return res.json();
}

export async function loadSong(file: string): Promise<Song> {
  const res = await fetch(`${import.meta.env.BASE_URL}songs/${file}`);
  if (!res.ok) throw new Error(`Failed to load song ${file} (${res.status})`);
  return normalize(await res.json());
}

/** Validates and sorts a song so the rest of the app can rely on its shape. */
export function normalize(raw: Song): Song {
  if (raw.format !== "piano-song/v1") {
    throw new Error(`Unsupported song format: ${String(raw.format)}`);
  }
  const notes = raw.notes
    .filter((n) => n.duration > 0 && n.pitch >= 21 && n.pitch <= 108)
    .map((n) => ({ ...n, velocity: n.velocity ?? 0.7 }))
    .sort((a, b) => a.time - b.time || a.pitch - b.pitch);
  const lastEnd = notes.reduce((m, n) => Math.max(m, n.time + n.duration), 0);
  return { ...raw, notes, duration: raw.duration ?? lastEnd };
}
