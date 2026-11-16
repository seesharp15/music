/**
 * Files in and out of the browser: a download, and a file picked by the user. The reading and
 * writing of what is inside them is `src/project/file.ts`, which needs no browser.
 */
import {
  projectFileName,
  readFile,
  songFileName,
  writeProjectFile,
  writeSongFile,
  type ReadFile,
} from "../project/file";
import { newProjectId } from "../project/new";
import type { Project } from "../project/types";
import type { Song } from "../song/types";
import { openDb } from "./db";
import { saveProject } from "./projects";
import { isUserSongId, saveSong } from "./songs";

/** Hand the user a file to keep. */
export function download(name: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  document.body.append(a);
  a.click();
  a.remove();
  // The download has its own reference by now; a moment's grace for browsers that read it late.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const exportProject = (p: Project) => download(projectFileName(p), writeProjectFile(p));
export const exportSong = (s: Song) => download(songFileName(s), writeSongFile(s));

/** Ask the user for a file. Resolves with null if they close the picker without choosing. */
export function pickFile(accept = ".json,application/json"): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    input.addEventListener("change", () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    });
    input.addEventListener("cancel", () => {
      resolve(null);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

export type Imported =
  | { ok: true; kind: "project"; project: Project; renamed: boolean }
  | { ok: true; kind: "song"; song: Song }
  | { ok: false; message: string; errors: string[] };

/**
 * Read a picked file and, if it is sound, store what is in it. A project whose id is already here
 * is stored beside the existing one under a new id, never over it: importing cannot lose work.
 */
export async function importFile(file: Blob & { name?: string }): Promise<Imported> {
  let read: ReadFile;
  try {
    read = readFile(await file.text());
  } catch (err) {
    return { ok: false, message: `The file could not be read (${(err as Error).message}).`, errors: [] };
  }
  if (!read.ok) return read;
  if (read.kind === "project") {
    let project = read.project;
    const taken = (await (await openDb()).getKey("projects", project.id)) !== undefined;
    if (taken) project = { ...project, id: newProjectId(), title: `${project.title} (imported)` };
    await saveProject(project);
    return { ok: true, kind: "project", project, renamed: taken };
  }
  // A song from outside becomes one of the user's own: its id says so.
  const song: Song = isUserSongId(read.song.id) ? read.song : { ...read.song, id: `u-${read.song.id}` };
  await saveSong({ ...song, origin: song.origin ?? { kind: "import", createdAt: new Date().toISOString() } });
  return { ok: true, kind: "song", song };
}

/** The whole flow behind an "Import…" button: pick, read, store. Null if nothing was picked. */
export async function pickAndImport(): Promise<Imported | null> {
  const file = await pickFile();
  return file ? importFile(file) : null;
}
