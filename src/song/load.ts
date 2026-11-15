import { normalize } from "./normalize";
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
