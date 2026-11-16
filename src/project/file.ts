/**
 * Projects and songs as files: the backup story until there is cloud sync. Writing is plain JSON;
 * reading validates, and when it refuses it says what is wrong in words a person can act on.
 */
import { parseSong } from "../song/schema";
import type { Song } from "../song/types";
import { parseProject, PROJECT_FORMAT } from "./schema";
import type { Project } from "./types";

export type ReadFile =
  | { ok: true; kind: "project"; project: Project }
  | { ok: true; kind: "song"; song: Song }
  | { ok: false; message: string; errors: string[] };

/** "Für Elise (my version)" → "fur-elise-my-version". */
export function slug(title: string): string {
  const s = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "untitled";
}

export const projectFileName = (p: Pick<Project, "title">) => `${slug(p.title)}.piano-project.json`;
export const songFileName = (s: Pick<Song, "title">) => `${slug(s.title)}.piano-song.json`;

/** The text of a project file. Exporting one project writes the project alone. */
export const writeProjectFile = (p: Project) => `${JSON.stringify(p, null, 2)}\n`;
export const writeSongFile = (s: Song) => `${JSON.stringify(s)}\n`;

const refuse = (message: string, errors: string[] = []): ReadFile => ({ ok: false, message, errors });

function summary(what: string, errors: string[]): string {
  const more =
    errors.length > 1 ? ` (and ${errors.length - 1} more ${errors.length === 2 ? "problem" : "problems"})` : "";
  return `This ${what} file is damaged — ${errors[0]}${more}`;
}

/** Read the text of a file someone picked: a project or a song. Never throws. */
export function readFile(text: string): ReadFile {
  if (!text.trim()) return refuse("This file is empty.");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return refuse(`This is not a song or project file: it is not valid JSON (${(err as Error).message}).`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return refuse("This is not a song or project file: it does not hold a single song or project.");
  }
  const format = (raw as { format?: unknown }).format;
  if (format === PROJECT_FORMAT) {
    const parsed = parseProject(raw);
    return parsed.ok
      ? { ok: true, kind: "project", project: parsed.project }
      : refuse(summary("project", parsed.errors), parsed.errors);
  }
  if (format === "piano-song/v1" || format === "piano-song/v2") {
    const parsed = parseSong(raw);
    return parsed.ok
      ? { ok: true, kind: "song", song: parsed.song }
      : refuse(summary("song", parsed.errors), parsed.errors);
  }
  return refuse(
    typeof format === "string"
      ? `This file's format is "${format}", which this version of the app cannot open.`
      : 'This is not a song or project file: it has no "format" field.',
  );
}
