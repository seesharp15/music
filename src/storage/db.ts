/**
 * The app's database: everything an author makes lives here, in their browser, until they export it.
 * IndexedDB through `idb`. Stores are those of docs/plan/contracts.md §10.
 */
import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ProjectMeta } from "../project/meta";
import type { Song } from "../song/types";

export const DB_NAME = "piano-tutor";
export const DB_VERSION = 1;

export interface SnapshotRecord {
  /** Assigned by the database, increasing: the newest snapshot has the highest. */
  key?: number;
  projectId: string;
  at: string;
  /** Stored as it was saved; validated when read. */
  project: unknown;
}

export interface BlobRecord {
  id: string;
  /** What it is: "audio/webm", "application/x-analyze-result+json" … */
  type: string;
  createdAt: string;
  data: Blob | ArrayBuffer | string;
}

export interface Schema extends DBSchema {
  /** `Project` by id. Stored as written and validated on the way out, so damage is caught, not trusted. */
  projects: { key: string; value: { id: string } };
  projectMeta: { key: string; value: ProjectMeta };
  snapshots: { key: number; value: SnapshotRecord; indexes: { projectId: string } };
  /** User songs by id (`u-…`): compiled or imported. */
  songs: { key: string; value: Song };
  /** Hummed and tapped takes (Stages 4 and 7). */
  takes: { key: string; value: { id: string } };
  blobs: { key: string; value: BlobRecord };
  /** Small values by name: `assist:<projectId>`, `studio:<projectId>`, `songs:index` … */
  kv: { key: string; value: unknown };
}

export type Db = IDBPDatabase<Schema>;

/**
 * Bring a database of any earlier version up to this one. Each step runs once, in order, so a
 * database first made at version 1 and one made empty today end up the same.
 */
export function upgrade(db: Db, oldVersion: number): void {
  if (oldVersion < 1) {
    db.createObjectStore("projects", { keyPath: "id" });
    db.createObjectStore("projectMeta", { keyPath: "id" });
    db.createObjectStore("snapshots", { keyPath: "key", autoIncrement: true }).createIndex("projectId", "projectId");
    db.createObjectStore("songs", { keyPath: "id" });
    db.createObjectStore("takes", { keyPath: "id" });
    db.createObjectStore("blobs", { keyPath: "id" });
    db.createObjectStore("kv");
  }
  // Version 2 goes here: `if (oldVersion < 2) { … }`. Never edit a step that has shipped.
}

let opening: Promise<Db> | null = null;

/** The database, opened once and shared. Rejects where IndexedDB is unavailable (some private modes). */
export function openDb(): Promise<Db> {
  opening ??= openDB<Schema>(DB_NAME, DB_VERSION, {
    upgrade: (db, oldVersion) => upgrade(db, oldVersion),
    // Another tab wants to upgrade: let go, so it is not left waiting on this one.
    blocking: () => void closeDb(),
    terminated: () => void (opening = null),
  }).catch((err) => {
    opening = null;
    throw err;
  });
  return opening;
}

export async function closeDb(): Promise<void> {
  const was = opening;
  opening = null;
  if (was) (await was.catch(() => null))?.close();
}

/** Erase everything. For tests, and for a "delete all my data" button. */
export async function deleteDb(): Promise<void> {
  await closeDb();
  await deleteDB(DB_NAME);
}

// ── Small values ─────────────────────────────────────────────────────────────

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await (await openDb()).get("kv", key)) as T | undefined;
}
export async function kvSet(key: string, value: unknown): Promise<void> {
  await (await openDb()).put("kv", value, key);
}
export async function kvDelete(key: string): Promise<void> {
  await (await openDb()).delete("kv", key);
}

// ── Keeping what is stored ───────────────────────────────────────────────────

export type Persistence = "persisted" | "refused" | "unsupported";
const PERSIST_KEY = "piano-tutor:storage-persist";
let asked: Promise<Persistence> | null = null;

/**
 * Ask the browser not to evict this site's data when space runs short. Asked once, the first time
 * something of the author's is saved. A browser may refuse (Safari grants it to installed apps;
 * Chrome decides by how the site is used), and then the author's songs can be cleared: the answer is
 * remembered so Settings can say so.
 */
export function requestPersistence(): Promise<Persistence> {
  asked ??= (async (): Promise<Persistence> => {
    let result: Persistence = "unsupported";
    try {
      const storage = navigator.storage;
      if (storage?.persist)
        result = (await storage.persisted?.()) || (await storage.persist()) ? "persisted" : "refused";
    } catch {
      result = "unsupported";
    }
    try {
      localStorage.setItem(PERSIST_KEY, result);
    } catch {
      /* nowhere to remember it; it will be asked again next visit */
    }
    return result;
  })();
  return asked;
}

/** What the browser said last time it was asked, or null if it never was. */
export function persistenceAnswer(): Persistence | null {
  try {
    const v = localStorage.getItem(PERSIST_KEY);
    return v === "persisted" || v === "refused" || v === "unsupported" ? v : null;
  } catch {
    return null;
  }
}
