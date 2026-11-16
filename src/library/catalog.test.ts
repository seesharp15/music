import { describe, expect, it, vi } from "vitest";
import type { Song } from "../song/types";
import { createCatalog, isUserSongId, type CatalogSources } from "./catalog";

const song = (id: string): Song => ({ format: "piano-song/v2", id, title: id, notes: [] });

function sources(over: Partial<CatalogSources> = {}): CatalogSources {
  return {
    bankIndex: vi.fn(async () => [
      { id: "divenire", title: "Divenire", file: "divenire.json" },
      { id: "rewrite", title: "Rewrite", file: "rewrite.json" },
    ]),
    bankSong: vi.fn(async (file: string) => song(file.replace(".json", ""))),
    userSongs: vi.fn(async () => [{ id: "u-abc", title: "Mine", file: "", updatedAt: "2026-11-16", projectId: "abc" }]),
    userSong: vi.fn(async (id: string) => (id === "u-abc" ? song(id) : null)),
    projects: vi.fn(async () => [{ id: "abc", title: "Mine", updatedAt: "2026-11-16", bars: 8, preview: [] }]),
    ...over,
  };
}

describe("the catalog", () => {
  it("lists the author's songs first, then the bank, each marked with where it lives", async () => {
    const list = await createCatalog(sources()).list();
    expect(list.map((e) => [e.id, e.source])).toEqual([
      ["u-abc", "user"],
      ["divenire", "bank"],
      ["rewrite", "bank"],
    ]);
    expect(list[0].projectId).toBe("abc");
  });

  it("resolves an id from either source the same way", async () => {
    const c = createCatalog(sources());
    expect(await c.find("divenire")).toMatchObject({ source: "bank", file: "divenire.json" });
    expect(await c.find("u-abc")).toMatchObject({ source: "user" });
    expect(await c.find("nope")).toBeNull();
    expect(await c.find("u-nope")).toBeNull();
    expect((await c.load("divenire"))?.id).toBe("divenire");
    expect((await c.load("u-abc"))?.id).toBe("u-abc");
    expect(await c.load("nope")).toBeNull();
    expect(await c.load("u-nope")).toBeNull();
  });

  it("looks only where the id says the song lives", async () => {
    const s = sources();
    const c = createCatalog(s);
    await c.load("u-abc");
    await c.find("u-abc");
    expect(s.bankIndex).not.toHaveBeenCalled();
    await c.load("divenire");
    await c.find("divenire");
    expect(s.userSong).toHaveBeenCalledTimes(1);
    expect(s.userSongs).toHaveBeenCalledTimes(1);
  });

  it("still lists the bank when the database will not open", async () => {
    const broken = sources({
      userSongs: async () => Promise.reject(new Error("no IndexedDB")),
      projects: async () => Promise.reject(new Error("no IndexedDB")),
    });
    const c = createCatalog(broken);
    expect((await c.list()).map((e) => e.id)).toEqual(["divenire", "rewrite"]);
    expect(await c.projects()).toEqual([]);
  });

  it("normalizes a user song as it loads it, as the bank's are", async () => {
    const raw: Song = {
      format: "piano-song/v2",
      id: "u-raw",
      title: "Raw",
      notes: [
        { pitch: 64, time: 1, duration: 0.5, hand: "R" },
        { pitch: 60, time: 0, duration: 0.5, hand: "R", velocity: 0.9 },
        { pitch: 5, time: 0, duration: 0.5, hand: "L" },
      ],
    };
    const loaded = await createCatalog(sources({ userSong: async () => raw })).load("u-raw");
    expect(loaded?.notes).toEqual([
      { pitch: 60, time: 0, duration: 0.5, hand: "R", velocity: 0.9 },
      { pitch: 64, time: 1, duration: 0.5, hand: "R", velocity: 0.7 },
    ]);
    expect(loaded?.duration).toBe(1.5);
  });

  it("lists projects", async () => {
    expect((await createCatalog(sources()).projects()).map((p) => p.id)).toEqual(["abc"]);
  });

  it("tells a user song by its id", () => {
    expect(isUserSongId("u-abc")).toBe(true);
    expect(isUserSongId("under-pressure")).toBe(false);
  });
});
