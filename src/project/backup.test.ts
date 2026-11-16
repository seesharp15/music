import { describe, expect, it } from "vitest";
import { BACKUP_FORMAT, backupDue, backupFileName, projectKeys, readBackup, writeBackup } from "./backup";
import { newProject } from "./new";
import { applyOps } from "./ops";

const song = (id: string, title: string) =>
  applyOps(newProject({ id, title }), [
    { op: "addNotes", trackId: "melody", notes: [{ pitch: 60, tick: 0, dur: 480, vel: 0.7, origin: "manual" }] },
  ]);

describe("a backup file", () => {
  const a = song("a", "First");
  const b = song("b", "Second");
  const text = writeBackup({
    exportedAt: "2026-11-16T10:00:00.000Z",
    projects: [a, b],
    kv: { "studio:a": { cursor: 480 }, "assist:b": { history: [] } },
    takes: [{ id: "take1" }],
  });

  it("holds every project and what is kept beside it, and reads back the same", () => {
    const read = readBackup(JSON.parse(text));
    if (!read.ok) throw new Error(read.message);
    expect(read.projects).toEqual([a, b]);
    expect(read.kv).toEqual({ "studio:a": { cursor: 480 }, "assist:b": { history: [] } });
    expect(read.takes).toEqual([{ id: "take1" }]);
    expect(read.skipped).toEqual([]);
    expect(JSON.parse(text).format).toBe(BACKUP_FORMAT);
    expect(backupFileName(new Date("2026-11-16T10:00:00Z"))).toBe("piano-tutor-backup-2026-11-16.json");
  });

  it("a damaged song in it is named and left out; the sound ones are still taken", () => {
    const raw = JSON.parse(text);
    raw.projects[0].tracks[0].notes[0].pitch = 400;
    const read = readBackup(raw);
    if (!read.ok) throw new Error(read.message);
    expect(read.projects.map((p) => p.title)).toEqual(["Second"]);
    expect(read.skipped).toHaveLength(1);
    expect(read.skipped[0].title).toBe("First");
    expect(read.skipped[0].problem).toMatch(/pitch/);
    // What was kept beside the damaged song does not come in without it.
    expect(Object.keys(read.kv)).toEqual(["assist:b"]);
  });

  it("takes in nothing that does not belong to one of its songs", () => {
    const raw = JSON.parse(text);
    raw.kv["songs:index"] = [{ id: "u-evil" }];
    raw.kv["studio:someone-else"] = {};
    const read = readBackup(raw);
    expect(read.ok && Object.keys(read.kv).sort()).toEqual(["assist:b", "studio:a"]);
  });

  it.each([null, 7, [], {}, { format: "piano-project/v1" }, { format: BACKUP_FORMAT }])(
    "refuses %j with a reason",
    (raw) => {
      const read = readBackup(raw);
      expect(read.ok).toBe(false);
      expect(!read.ok && read.message).toMatch(/not a Piano Tutor backup|damaged/);
    },
  );

  it("the keys that travel with a project", () => {
    expect(projectKeys("x")).toEqual(["studio:x", "assist:x", "chat:x"]);
  });
});

describe("the backup reminder", () => {
  const now = new Date("2026-11-16T12:00:00Z");
  const days = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

  it("is quiet when nothing has changed since the last backup", () => {
    expect(backupDue([{ updatedAt: days(30) }], days(20), now)).toBe(false);
    expect(backupDue([], null, now)).toBe(false);
  });

  it("is quiet for two weeks after a backup, whatever has changed", () => {
    expect(backupDue([{ updatedAt: days(1) }], days(13), now)).toBe(false);
  });

  it("speaks when songs have changed and the last backup is more than two weeks old", () => {
    expect(backupDue([{ updatedAt: days(1) }], days(15), now)).toBe(true);
  });

  it("with no backup ever made, counts from the oldest song", () => {
    expect(backupDue([{ updatedAt: days(3) }], null, now)).toBe(false);
    expect(backupDue([{ updatedAt: days(3) }, { updatedAt: days(15) }], null, now)).toBe(true);
  });

  it("ignores a date it cannot read", () => {
    expect(backupDue([{ updatedAt: "yesterday-ish" }], null, now)).toBe(false);
    expect(backupDue([{ updatedAt: days(20) }], "never", now)).toBe(true);
  });
});
