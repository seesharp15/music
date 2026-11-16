/**
 * In and out of the Studio: to Practice ("Practice it"), to files (project, song, MIDI), and in
 * from files and from the song bank ("open a copy").
 */
import { compileProject } from "../project/compile";
import { readFile, slug } from "../project/file";
import { projectFromSong } from "../project/fromSong";
import { MidiError, projectFromMidi, projectToMidi } from "../project/midi";
import { newProjectId } from "../project/new";
import type { Project } from "../project/types";
import { loadSong } from "../song/load";
import type { Song, SongIndexEntry } from "../song/types";
import { download, loadProject, openDb, pickFile, saveProject, saveSong } from "../storage";
import { practiceHref } from "./projects";

/** Compile a project and keep the song where Practice will find it. Returns the song. */
export async function storeForPractice(project: Project): Promise<Song> {
  const song = compileProject(project);
  await saveSong(song);
  return song;
}

/** Compile the stored project and go to Practice with it. False if the project cannot be read. */
export async function practiceStored(projectId: string): Promise<boolean> {
  const loaded = await loadProject(projectId);
  if (!loaded.ok) return false;
  await storeForPractice(loaded.project);
  window.location.hash = practiceHref(projectId);
  return true;
}

/**
 * The compiled song as a file in the song bank's own format: an id made from the title (not a
 * `u-…` id, which only means something on this device), ready to drop into `public/songs/`.
 */
export function bankSong(project: Project): Song {
  const song = compileProject(project);
  return { ...song, id: slug(project.title), origin: { kind: "studio", createdAt: project.createdAt } };
}
export const exportBankSong = (project: Project) =>
  download(`${slug(project.title)}.json`, `${JSON.stringify(bankSong(project), null, 1)}\n`);

export const exportMidi = (project: Project) =>
  download(`${slug(project.title)}.mid`, projectToMidi(project) as BlobPart, "audio/midi");

export type Imported =
  { ok: true; project: Project; from: "project" | "song" | "midi" } | { ok: false; message: string };

const isMidiName = (name: string) => /\.(mid|midi|smf)$/i.test(name);
const titleFrom = (name: string) =>
  name
    .replace(/\.[^.]+$/, "")
    .replace(/\.piano-(project|song)$/, "")
    .replace(/[-_]+/g, " ")
    .trim();

/**
 * Read a picked file and store what is in it as a project: a project file as it is (under a new
 * id if that one is taken — importing never overwrites), a song file or a MIDI file converted.
 * Refuses with a message that names the problem.
 */
export async function importFile(file: File): Promise<Imported> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (err) {
    return { ok: false, message: `The file could not be read (${(err as Error).message}).` };
  }
  const looksMidi =
    bytes.length >= 4 && bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64;
  let project: Project;
  let from: "project" | "song" | "midi";
  if (looksMidi || isMidiName(file.name)) {
    try {
      project = projectFromMidi(bytes, { fallbackTitle: titleFrom(file.name) });
      from = "midi";
    } catch (err) {
      if (err instanceof MidiError) return { ok: false, message: err.message };
      throw err;
    }
  } else {
    const read = readFile(new TextDecoder().decode(bytes));
    if (!read.ok) return { ok: false, message: read.message };
    if (read.kind === "project") {
      project = read.project;
      from = "project";
      const taken = (await (await openDb()).getKey("projects", project.id)) !== undefined;
      if (taken) project = { ...project, id: newProjectId(), title: `${project.title} (imported)` };
    } else {
      project = projectFromSong(read.song);
      from = "song";
    }
  }
  await saveProject(project);
  return { ok: true, project, from };
}

/** The flow behind "Import…": pick a file, read it, store it. Null if nothing was picked. */
export async function pickAndImport(): Promise<Imported | null> {
  const file = await pickFile(".json,.mid,.midi,application/json,audio/midi,audio/x-midi");
  return file ? importFile(file) : null;
}

/** A bank song as a project of the author's own, to change as they like. */
export async function openCopy(entry: Pick<SongIndexEntry, "file" | "title">): Promise<Project> {
  const song = await loadSong(entry.file);
  const project = { ...projectFromSong(song), title: `${entry.title} (my version)` };
  await saveProject(project);
  return project;
}
