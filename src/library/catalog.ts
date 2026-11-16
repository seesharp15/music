/**
 * One catalog over two sources: the song bank (files the app ships with) and the author's own songs
 * (in the database on this device). The Library lists both; the router resolves an id from either
 * the same way. Which source an id belongs to is in the id: user songs start `u-`.
 */
import { songIndex } from "../app/useSongIndex";
import type { ProjectMeta } from "../project/meta";
import { loadSong } from "../song/load";
import { normalize } from "../song/normalize";
import type { Song, SongIndexEntry } from "../song/types";

export type CatalogEntry = SongIndexEntry & {
  source: "bank" | "user";
  /** User songs: when it was last saved, and the project it was compiled from, if it was. */
  updatedAt?: string;
  projectId?: string;
};

export interface Catalog {
  /** Every song: the author's own first, most recently saved first, then the bank in its own order. */
  list(): Promise<CatalogEntry[]>;
  /** One song's entry, or null. Looks only where the id says it lives. */
  find(id: string): Promise<CatalogEntry | null>;
  /** The song itself, ready to play, or null when there is no such song. */
  load(id: string): Promise<Song | null>;
  /** The author's projects, most recently changed first. */
  projects(): Promise<ProjectMeta[]>;
}

/** Where the catalog reads from. The real ones are loaded on demand; tests pass their own. */
export interface CatalogSources {
  bankIndex(): Promise<SongIndexEntry[]>;
  bankSong(file: string): Promise<Song>;
  userSongs(): Promise<(SongIndexEntry & { updatedAt?: string; projectId?: string })[]>;
  userSong(id: string): Promise<Song | null>;
  projects(): Promise<ProjectMeta[]>;
}

export const isUserSongId = (id: string) => id.startsWith("u-");

/**
 * The real sources. The database code is imported when first used, so a screen that only ever shows
 * bank songs never downloads it; and a user song is found without fetching the bank's index.
 */
// (The storage layer, for its part, imports nothing that the Library and Practice load up front —
// not even `normalize`, which is why user songs are normalized here. That keeps those few small
// shared modules in one file, as they were before there was a database.)
const defaultSources: CatalogSources = {
  bankIndex: songIndex,
  bankSong: loadSong,
  userSongs: async () => (await import("../storage")).listUserSongs(),
  userSong: async (id) => (await import("../storage")).loadUserSong(id),
  projects: async () => (await import("../storage")).listProjects(),
};

export function createCatalog(sources: CatalogSources = defaultSources): Catalog {
  const bank = async (): Promise<CatalogEntry[]> => (await sources.bankIndex()).map((e) => ({ ...e, source: "bank" }));
  // The author's songs matter more than a database that will not open: without it, the bank still lists.
  const user = async (): Promise<CatalogEntry[]> => {
    try {
      return (await sources.userSongs()).map((e) => ({ ...e, source: "user" }));
    } catch {
      return [];
    }
  };
  return {
    async list() {
      const [mine, theirs] = await Promise.all([user(), bank()]);
      return [...mine, ...theirs];
    },
    async find(id) {
      const from = isUserSongId(id) ? await user() : await bank();
      return from.find((e) => e.id === id) ?? null;
    },
    async load(id) {
      if (isUserSongId(id)) {
        const song = await sources.userSong(id);
        return song && normalize(song);
      }
      const entry = (await bank()).find((e) => e.id === id);
      return entry ? sources.bankSong(entry.file) : null;
    },
    async projects() {
      try {
        return await sources.projects();
      } catch {
        return [];
      }
    },
  };
}

let shared: Catalog | null = null;
/** The app's one catalog. */
export const catalog = (): Catalog => (shared ??= createCatalog());
