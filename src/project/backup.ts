/**
 * "Export all my songs": every project in one file, with what is kept beside each (the editor's
 * state, the assistant's records, recorded takes), so a backup restored on another device is the
 * whole of the author's work. Pure: the reading validates, and says what it could not take.
 */
import type { ProjectMeta } from "./meta";
import { parseProject } from "./schema";
import type { Project } from "./types";

export const BACKUP_FORMAT = "piano-tutor-backup/v1";

export interface Backup {
  format: typeof BACKUP_FORMAT;
  exportedAt: string;
  projects: Project[];
  /** Small values kept beside projects, by their database key: `studio:<id>`, `assist:<id>`, `chat:<id>`. */
  kv: Record<string, unknown>;
  /** Recorded takes (Stages 4 and 7), as stored. */
  takes: { id: string }[];
}

/** The small-value keys that belong to a project and travel with it. */
export const projectKeys = (projectId: string) => [`studio:${projectId}`, `assist:${projectId}`, `chat:${projectId}`];

export function writeBackup(backup: Omit<Backup, "format">): string {
  return `${JSON.stringify({ format: BACKUP_FORMAT, ...backup })}\n`;
}

export const backupFileName = (now: Date) => `piano-tutor-backup-${now.toISOString().slice(0, 10)}.json`;

export type ReadBackup =
  | {
      ok: true;
      projects: Project[];
      kv: Record<string, unknown>;
      takes: { id: string }[];
      /** Projects in the file that are damaged and were left out, each with why. */
      skipped: { title: string; problem: string }[];
    }
  | { ok: false; message: string };

export const isBackup = (raw: unknown): boolean =>
  !!raw && typeof raw === "object" && (raw as { format?: unknown }).format === BACKUP_FORMAT;

/** Read a parsed backup file. Sound projects are taken; damaged ones are named and left out. */
export function readBackup(raw: unknown): ReadBackup {
  if (!isBackup(raw)) return { ok: false, message: "This is not a Piano Tutor backup file." };
  const file = raw as Partial<Backup>;
  if (!Array.isArray(file.projects))
    return { ok: false, message: "This backup file is damaged: it has no list of songs." };
  const projects: Project[] = [];
  const skipped: { title: string; problem: string }[] = [];
  for (const entry of file.projects as unknown[]) {
    const parsed = parseProject(entry);
    if (parsed.ok) projects.push(parsed.project);
    else {
      const title = (entry as { title?: unknown } | null)?.title;
      skipped.push({
        title: typeof title === "string" ? title : "A song with no title",
        problem: parsed.errors[0] ?? "it is damaged",
      });
    }
  }
  const kept = new Set(projects.flatMap((p) => projectKeys(p.id)));
  const kv: Record<string, unknown> = {};
  if (file.kv && typeof file.kv === "object") {
    // Only what belongs to a project that was taken; nothing else in the file is trusted.
    for (const [key, value] of Object.entries(file.kv)) if (kept.has(key)) kv[key] = value;
  }
  const takes = Array.isArray(file.takes)
    ? file.takes.filter(
        (t): t is { id: string } => !!t && typeof t === "object" && typeof (t as { id?: unknown }).id === "string",
      )
    : [];
  return { ok: true, projects, kv, takes, skipped };
}

const DAY = 86_400_000;
export const BACKUP_AFTER_DAYS = 14;

/**
 * Whether to remind the author to back up: there are songs changed since the last backup, and it
 * is more than two weeks since that backup — or, with none ever made, since the oldest such change.
 */
export function backupDue(
  projects: readonly Pick<ProjectMeta, "updatedAt">[],
  lastBackup: string | null,
  now: Date,
): boolean {
  const since = lastBackup ? Date.parse(lastBackup) : NaN;
  const changed = projects
    .map((p) => Date.parse(p.updatedAt))
    .filter((t) => Number.isFinite(t) && (Number.isNaN(since) || t > since));
  if (!changed.length) return false;
  const from = Number.isNaN(since) ? Math.min(...changed) : since;
  return now.getTime() - from > BACKUP_AFTER_DAYS * DAY;
}
