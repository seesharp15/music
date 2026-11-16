/**
 * Projects in the database: saving (with snapshots), loading (validated, never trusted), listing.
 */
import { projectMeta, type ProjectMeta } from "../project/meta";
import { parseProject } from "../project/schema";
import type { ProjectPersistence } from "../project/store";
import type { Project } from "../project/types";
import { openDb, requestPersistence } from "./db";

/** Autosaved versions kept per project. */
export const SNAPSHOTS_KEPT = 20;

/**
 * A project the page was closing on, written the only way that is certain to finish in time:
 * synchronously, to localStorage. The next load picks it up. See `saveNow`.
 */
const UNSAVED = "piano-tutor:unsaved:";

export type LoadedProject =
  | { ok: true; project: Project; recovered?: "unsaved" }
  | { ok: false; reason: "missing" }
  /** What is stored is damaged. `snapshot` is the newest autosaved version that is still sound, if any. */
  | { ok: false; reason: "invalid"; errors: string[]; snapshot: { project: Project; at: string } | null }
  /** The database itself could not be opened or read. */
  | { ok: false; reason: "unavailable"; message: string };

/** Write a project and its listing entry together; with `snapshot`, keep a restore point as well. */
export async function saveProject(project: Project, opts: { snapshot?: boolean } = {}): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(["projects", "projectMeta", "snapshots"], "readwrite");
  void tx.objectStore("projects").put(project);
  void tx.objectStore("projectMeta").put(projectMeta(project));
  if (opts.snapshot) {
    const snapshots = tx.objectStore("snapshots");
    void snapshots.add({ projectId: project.id, at: project.updatedAt, project });
    // Keys rise with time, so the oldest are the first: drop all but the newest.
    const keys = await snapshots.index("projectId").getAllKeys(project.id);
    for (const key of keys.slice(0, Math.max(0, keys.length - SNAPSHOTS_KEPT))) void snapshots.delete(key);
  }
  await tx.done;
  clearUnsaved(project.id);
  // The first time something of the author's is stored, ask the browser to keep it.
  void requestPersistence();
}

function readUnsaved(id: string): Project | null {
  try {
    const text = localStorage.getItem(UNSAVED + id);
    if (!text) return null;
    const parsed = parseProject(JSON.parse(text));
    return parsed.ok ? parsed.project : null;
  } catch {
    return null;
  }
}

function clearUnsaved(id: string) {
  try {
    localStorage.removeItem(UNSAVED + id);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Load a project. Never throws and never returns a half-valid project: what comes back is either a
 * project that passes `ProjectSchema`, or a typed failure.
 */
export async function loadProject(id: string): Promise<LoadedProject> {
  try {
    const db = await openDb();
    const stored = await db.get("projects", id);
    const parsed = stored === undefined ? null : parseProject(stored);

    // A copy written as the page closed is newer than anything the database holds, unless a later
    // save has landed since.
    const unsaved = readUnsaved(id);
    if (unsaved && (!parsed?.ok || unsaved.updatedAt >= parsed.project.updatedAt)) {
      await saveProject(unsaved);
      return { ok: true, project: unsaved, recovered: "unsaved" };
    }
    clearUnsaved(id);

    if (!parsed) return { ok: false, reason: "missing" };
    if (parsed.ok) return { ok: true, project: parsed.project };
    return { ok: false, reason: "invalid", errors: parsed.errors, snapshot: await newestValidSnapshot(id) };
  } catch (err) {
    return { ok: false, reason: "unavailable", message: err instanceof Error ? err.message : String(err) };
  }
}

/** Autosaved versions of a project, newest first, each validated. */
export async function listSnapshots(id: string): Promise<{ key: number; at: string; project: Project | null }[]> {
  const db = await openDb();
  const records = await db.getAllFromIndex("snapshots", "projectId", id);
  return records.reverse().map((r) => {
    const parsed = parseProject(r.project);
    return { key: r.key!, at: r.at, project: parsed.ok ? parsed.project : null };
  });
}

async function newestValidSnapshot(id: string): Promise<{ project: Project; at: string } | null> {
  for (const s of await listSnapshots(id)) if (s.project) return { project: s.project, at: s.at };
  return null;
}

/** Every project's listing entry, most recently changed first. */
export async function listProjects(): Promise<ProjectMeta[]> {
  const all = await (await openDb()).getAll("projectMeta");
  return all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

/** Remove a project, its listing entry and its snapshots. */
export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(["projects", "projectMeta", "snapshots"], "readwrite");
  void tx.objectStore("projects").delete(id);
  void tx.objectStore("projectMeta").delete(id);
  const snapshots = tx.objectStore("snapshots");
  for (const key of await snapshots.index("projectId").getAllKeys(id)) void snapshots.delete(key);
  await tx.done;
  clearUnsaved(id);
}

/** Where the project store saves: the database, and localStorage for the moment the page goes away. */
export const projectPersistence: ProjectPersistence = {
  save: (project, { snapshot }) => saveProject(project, { snapshot }),
  saveNow(project) {
    try {
      localStorage.setItem(UNSAVED + project.id, JSON.stringify(project));
    } catch {
      /* over quota, or no storage: the asynchronous save is still attempted */
    }
  },
};
