/**
 * What can be done to a project from outside the editor: make one, copy one, rename one, remove
 * one. Each goes through the storage layer, so the list of My songs is always what is stored.
 */
import { newProject, newProjectId, type NewProjectOptions } from "../project/new";
import type { Project } from "../project/types";
import { deleteProject, deleteSong, exportProject, kvDelete, loadProject, saveProject } from "../storage";

/** The address of a project in the Studio, and of the song compiled from it in Practice. */
export const studioHref = (projectId: string) => `#/studio/${projectId}`;
export const userSongId = (projectId: string) => `u-${projectId}`;
export const practiceHref = (projectId: string) => `#/play/${userSongId(projectId)}`;

/** Key of a project's editor state (cursor, zoom …) in the database's small-values store. */
export const studioKey = (projectId: string) => `studio:${projectId}`;

/**
 * Saves still on their way to the database from an editor that has just closed. The list of songs
 * waits for them, so a song edited a moment ago is listed as it now is.
 */
const closing = new Set<Promise<unknown>>();
export function noteClosing(work: Promise<unknown>) {
  closing.add(work);
  void work.finally(() => closing.delete(work));
}
export async function settled(): Promise<void> {
  while (closing.size) await Promise.allSettled([...closing]);
}

export async function createProject(opts: NewProjectOptions = {}): Promise<Project> {
  const project = newProject(opts);
  await saveProject(project);
  return project;
}

/** A copy under a new id, saved beside the original. Null when the original cannot be read. */
export async function duplicateProject(id: string): Promise<Project | null> {
  const loaded = await loadProject(id);
  if (!loaded.ok) return null;
  const now = new Date().toISOString();
  const copy: Project = {
    ...loaded.project,
    id: newProjectId(),
    title: `${loaded.project.title} (copy)`,
    createdAt: now,
    updatedAt: now,
  };
  await saveProject(copy);
  return copy;
}

export async function renameProject(id: string, title: string): Promise<boolean> {
  const loaded = await loadProject(id);
  if (!loaded.ok) return false;
  await saveProject({ ...loaded.project, title, updatedAt: new Date().toISOString() });
  return true;
}

/** Remove a project and everything kept for it: its snapshots, its practice song, its editor state. */
export async function removeProject(id: string): Promise<void> {
  await deleteProject(id);
  await Promise.allSettled([deleteSong(userSongId(id)), kvDelete(studioKey(id))]);
  try {
    localStorage.removeItem(`piano-tutor:${studioKey(id)}`);
  } catch {
    /* nothing to remove */
  }
}

/** Download a project as a file. False when it cannot be read. */
export async function exportProjectById(id: string): Promise<boolean> {
  const loaded = await loadProject(id);
  if (!loaded.ok) return false;
  exportProject(loaded.project);
  return true;
}
