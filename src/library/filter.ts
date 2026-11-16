import type { Genre, SongIndexEntry } from "../song/types";

export const GENRE_LABEL: Record<Genre, string> = {
  pop: "Pop",
  "film-tv": "Film & TV",
  classical: "Classical",
  neoclassical: "Neoclassical",
  jazz: "Jazz",
  rock: "Rock",
  folk: "Folk",
  game: "Game",
  holiday: "Holiday",
  original: "Original",
};

export const SORTS = [
  { id: "recent", label: "Recently added" },
  { id: "title", label: "Title" },
  { id: "artist", label: "Artist" },
  { id: "length", label: "Length" },
  { id: "difficulty", label: "Difficulty" },
] as const;
export type SortId = (typeof SORTS)[number]["id"];
export const isSort = (s: string | null): s is SortId => SORTS.some((x) => x.id === s);

export interface Filters {
  q: string;
  genre: string;
  /** "" for any, or "1".."5". */
  difficulty: string;
  sort: SortId;
}

/** Lower case, accents removed: "Amélie" matches "amelie". */
export const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const haystack = (e: SongIndexEntry) =>
  fold([e.title, e.artist, e.genre && GENRE_LABEL[e.genre], e.genre, ...(e.tags ?? [])].filter(Boolean).join(" "));

/** Every word typed must appear somewhere in the title, artist, genre or tags. */
export function matches(e: SongIndexEntry, q: string): boolean {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = haystack(e);
  return words.every((w) => text.includes(w));
}

const byText = (a = "", b = "") => fold(a).localeCompare(fold(b));

/** The songs to show, in order. `entries` is the index as written: later entries are newer. */
export function select(entries: SongIndexEntry[], f: Filters): SongIndexEntry[] {
  const position = new Map(entries.map((e, i) => [e.id, i]));
  const shown = entries.filter(
    (e) =>
      matches(e, f.q) && (!f.genre || e.genre === f.genre) && (!f.difficulty || String(e.difficulty) === f.difficulty),
  );
  const newestFirst = (a: SongIndexEntry, b: SongIndexEntry) =>
    (b.addedAt ?? "").localeCompare(a.addedAt ?? "") || position.get(b.id)! - position.get(a.id)!;
  const order: Record<SortId, (a: SongIndexEntry, b: SongIndexEntry) => number> = {
    recent: newestFirst,
    title: (a, b) => byText(a.title, b.title),
    artist: (a, b) => byText(a.artist, b.artist) || byText(a.title, b.title),
    length: (a, b) => (a.duration ?? 0) - (b.duration ?? 0),
    // Songs nobody has graded go last.
    difficulty: (a, b) => (a.difficulty ?? 9) - (b.difficulty ?? 9) || byText(a.title, b.title),
  };
  return [...shown].sort(order[f.sort]);
}

/** The genres that actually have songs, in the order of the genre list. */
export function genresIn(entries: SongIndexEntry[]): Genre[] {
  const present = new Set(entries.map((e) => e.genre));
  return (Object.keys(GENRE_LABEL) as Genre[]).filter((g) => present.has(g));
}

/** 209.4 → "3:29". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
