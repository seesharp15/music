/** User songs in the database: songs compiled from projects, or imported. Their ids start `u-`. */
import { parseSong } from "../song/schema";
import { summarize } from "../song/summary";
import type { Song, SongIndexEntry } from "../song/types";
import { openDb, requestPersistence } from "./db";

/** A user song's listing entry: the same shape as the bank's, so one card draws both. */
export type UserSongEntry = SongIndexEntry & { updatedAt: string; projectId?: string };

const INDEX = "songs:index";
export const isUserSongId = (id: string) => id.startsWith("u-");

function entryOf(song: Song, now: Date): UserSongEntry {
  return {
    id: song.id,
    title: song.title,
    ...(song.artist ? { artist: song.artist } : {}),
    file: "",
    genre: "original",
    addedAt: (song.origin?.createdAt ?? now.toISOString()).slice(0, 10),
    ...summarize(song),
    updatedAt: now.toISOString(),
    ...(song.origin?.projectId ? { projectId: song.origin.projectId } : {}),
  };
}

/** Store a user song and its listing entry together. */
export async function saveSong(song: Song, now = new Date()): Promise<UserSongEntry> {
  if (!isUserSongId(song.id)) throw new Error(`A user song's id starts with "u-"; this one is "${song.id}".`);
  const entry = entryOf(song, now);
  const db = await openDb();
  const tx = db.transaction(["songs", "kv"], "readwrite");
  void tx.objectStore("songs").put(song);
  const kv = tx.objectStore("kv");
  const index = ((await kv.get(INDEX)) as UserSongEntry[] | undefined) ?? [];
  void kv.put([entry, ...index.filter((e) => e.id !== song.id)], INDEX);
  await tx.done;
  void requestPersistence();
  return entry;
}

/** A stored user song, validated; null when there is none, or it is damaged. The catalog normalizes it. */
export async function loadUserSong(id: string): Promise<Song | null> {
  const stored = await (await openDb()).get("songs", id);
  if (!stored) return null;
  const parsed = parseSong(stored);
  return parsed.ok ? parsed.song : null;
}

/** Listing entries for every user song, most recently saved first. */
export async function listUserSongs(): Promise<UserSongEntry[]> {
  return ((await (await openDb()).get("kv", INDEX)) as UserSongEntry[] | undefined) ?? [];
}

export async function deleteSong(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(["songs", "kv"], "readwrite");
  void tx.objectStore("songs").delete(id);
  const kv = tx.objectStore("kv");
  const index = ((await kv.get(INDEX)) as UserSongEntry[] | undefined) ?? [];
  void kv.put(
    index.filter((e) => e.id !== id),
    INDEX,
  );
  await tx.done;
}
