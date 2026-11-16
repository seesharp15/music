import { describe, expect, it } from "vitest";
import { derive, formatIndex, preview, PREVIEW_SLICES, refreshEntry } from "./song-index.mjs";

const note = (time, duration = 1, pitch = 60) => ({ pitch, time, duration, hand: "R" });
const song = (notes, over = {}) => ({ format: "piano-song/v1", id: "t", title: "T", notes, ...over });

describe("derive", () => {
  it("reads length, tempo, note count and range off the song", () => {
    const d = derive(song([note(0, 1, 48), note(2, 2, 72)], { bpm: 100 }));
    expect(d).toMatchObject({ duration: 4, bpm: 100, noteCount: 2, range: [48, 72] });
    expect(d.preview).toHaveLength(PREVIEW_SLICES);
  });

  it("prefers the length the file states, and leaves tempo out when the song has none", () => {
    const d = derive(song([note(0)], { duration: 10 }));
    expect(d.duration).toBe(10);
    expect(d).not.toHaveProperty("bpm");
    expect(d).not.toHaveProperty("key");
  });

  it("ignores notes the app would not play", () => {
    const d = derive(song([note(0, 1, 60), note(1, 0, 61), note(2, 1, 20), note(3, 1, 109)]));
    expect(d.noteCount).toBe(1);
    expect(d.range).toEqual([60, 60]);
  });

  it("copes with a song that has no notes", () => {
    const d = derive(song([]));
    expect(d).toMatchObject({ duration: 0, noteCount: 0 });
    expect(d).not.toHaveProperty("range");
    expect(d.preview.every((v) => v === 0)).toBe(true);
  });
});

describe("preview", () => {
  it("is 1 where the song is busiest and 0 where it is silent", () => {
    // 4 slices over 4 seconds: silence, one note, two notes at once, half a note.
    const p = preview([note(1, 1), note(2, 1), note(2, 1, 64), note(3, 0.5)], 4, 4);
    expect(p).toEqual([0, 0.5, 1, 0.25]);
  });

  it("spreads a long note across the slices it sounds in", () => {
    expect(preview([note(0.5, 2)], 4, 4)).toEqual([0.5, 1, 0.5, 0]);
  });

  it("does not count sound past the end of the song", () => {
    expect(preview([note(3, 5)], 4, 4)).toEqual([0, 0, 0, 1]);
  });
});

describe("refreshEntry", () => {
  const entry = { id: "t", title: "T", file: "t.json", difficulty: 2, genre: "pop", noteCount: 999, preview: [1] };

  it("replaces what is derived and keeps what a person set", () => {
    const out = refreshEntry(entry, song([note(0)]));
    expect(out).toMatchObject({ id: "t", title: "T", file: "t.json", difficulty: 2, genre: "pop", noteCount: 1 });
    expect(out.preview).toHaveLength(PREVIEW_SLICES);
  });

  it("drops a derived field the song no longer supports", () => {
    expect(refreshEntry({ ...entry, bpm: 120 }, song([note(0)]))).not.toHaveProperty("bpm");
  });

  it("writes fields in a fixed order, so diffs stay small", () => {
    const keys = Object.keys(
      refreshEntry({ preview: [], genre: "pop", file: "t.json", title: "T", id: "t" }, song([note(0)])),
    );
    expect(keys).toEqual(["id", "title", "file", "genre", "duration", "noteCount", "range", "preview"]);
  });

  it("is stable: refreshing twice changes nothing", () => {
    const once = refreshEntry(entry, song([note(0), note(3, 2, 70)]));
    expect(formatIndex([refreshEntry(once, song([note(0), note(3, 2, 70)]))])).toBe(formatIndex([once]));
  });
});

describe("the stale-index check", () => {
  it("notices when a song changes and the index was not refreshed", async () => {
    const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { rebuildIndex } = await import("./song-index.mjs");
    const dir = mkdtempSync(join(tmpdir(), "bank-"));
    const index = join(dir, "index.json");
    writeFileSync(join(dir, "t.json"), JSON.stringify(song([note(0)])));
    writeFileSync(index, JSON.stringify([{ id: "t", title: "T", file: "t.json", genre: "pop" }]));

    const first = rebuildIndex(index);
    expect(first.before).not.toBe(first.after); // never indexed: stale
    writeFileSync(index, first.after);
    expect(rebuildIndex(index).before).toBe(rebuildIndex(index).after); // fresh

    writeFileSync(join(dir, "t.json"), JSON.stringify(song([note(0), note(5)]))); // the song grows
    const stale = rebuildIndex(index);
    expect(stale.before).not.toBe(stale.after);
    expect(JSON.parse(stale.after)[0]).toMatchObject({ noteCount: 2, genre: "pop" });
    expect(JSON.parse(readFileSync(index, "utf8"))[0].noteCount).toBe(1); // checking writes nothing
  });

  it("refuses an index entry that points at a different song", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { rebuildIndex } = await import("./song-index.mjs");
    const dir = mkdtempSync(join(tmpdir(), "bank-"));
    writeFileSync(join(dir, "t.json"), JSON.stringify(song([note(0)], { id: "other" })));
    writeFileSync(join(dir, "index.json"), JSON.stringify([{ id: "t", title: "T", file: "t.json" }]));
    expect(() => rebuildIndex(join(dir, "index.json"))).toThrow(/its id is "other"/);
  });
});
