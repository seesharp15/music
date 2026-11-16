/** "Export all my songs" and its way back in: every project, with what is kept beside it. */
import { backupFileName, isBackup, projectKeys, readBackup, writeBackup } from "../project/backup";
import { newProjectId } from "../project/new";
import { parseProject } from "../project/schema";
import type { Project } from "../project/types";
import { openDb } from "./db";
import { download } from "./files";
import { saveProject } from "./projects";

const LAST_BACKUP = "piano-tutor:last-backup";

/** When "Export all my songs" last ran on this device, or null. */
export function lastBackup(): string | null {
  try {
    return localStorage.getItem(LAST_BACKUP);
  } catch {
    return null;
  }
}

/** Everything of the author's, as the text of one file. Damaged projects are left out and counted. */
export async function collectBackup(now = new Date()): Promise<{ text: string; projects: number; damaged: number }> {
  const db = await openDb();
  const projects: Project[] = [];
  let damaged = 0;
  for (const stored of await db.getAll("projects")) {
    const parsed = parseProject(stored);
    if (parsed.ok) projects.push(parsed.project);
    else damaged++;
  }
  const kv: Record<string, unknown> = {};
  for (const p of projects) {
    for (const key of projectKeys(p.id)) {
      const value = await db.get("kv", key);
      if (value !== undefined) kv[key] = value;
    }
  }
  const takes = await db.getAll("takes");
  return {
    text: writeBackup({ exportedAt: now.toISOString(), projects, kv, takes }),
    projects: projects.length,
    damaged,
  };
}

/** Download the backup file and remember when. */
export async function exportAll(now = new Date()): Promise<{ projects: number; damaged: number }> {
  const backup = await collectBackup(now);
  download(backupFileName(now), backup.text);
  try {
    localStorage.setItem(LAST_BACKUP, now.toISOString());
  } catch {
    /* the reminder will simply come round again */
  }
  return { projects: backup.projects, damaged: backup.damaged };
}

export type Restored =
  | { ok: true; added: number; same: number; besides: number; skipped: { title: string; problem: string }[] }
  | { ok: false; message: string };

export { isBackup };

/**
 * Put a backup's songs on this device. A song that is already here, unchanged, is left as it is;
 * one that is here but different is kept beside the one from the backup, never replaced.
 */
export async function restoreBackup(raw: unknown): Promise<Restored> {
  const read = readBackup(raw);
  if (!read.ok) return read;
  const db = await openDb();
  let added = 0;
  let same = 0;
  let besides = 0;
  for (const project of read.projects) {
    const existing = await db.get("projects", project.id);
    let target = project;
    if (existing !== undefined) {
      if (JSON.stringify(existing) === JSON.stringify(project)) {
        same++;
        continue;
      }
      target = { ...project, id: newProjectId(), title: `${project.title} (from backup)` };
      besides++;
    } else added++;
    await saveProject(target);
    // What was kept beside the song goes with it, under whatever id it now has.
    for (const key of projectKeys(project.id)) {
      if (key in read.kv) await db.put("kv", read.kv[key], key.replace(project.id, target.id));
    }
  }
  const tx = db.transaction("takes", "readwrite");
  for (const take of read.takes) if ((await tx.store.getKey(take.id)) === undefined) void tx.store.put(take);
  await tx.done;
  return { ok: true, added, same, besides, skipped: read.skipped };
}
