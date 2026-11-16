import { describe, expect, it } from "vitest";
import type { SongIndexEntry } from "../song/types";
import { clock, fold, genresIn, matches, select, type Filters } from "./filter";

const bank: SongIndexEntry[] = [
  {
    id: "a",
    title: "Rewrite the Stars",
    artist: "The Greatest Showman",
    file: "a.json",
    genre: "film-tv",
    difficulty: 3,
    addedAt: "2026-11-04",
    duration: 209,
  },
  {
    id: "b",
    title: "Divenire",
    artist: "Ludovico Einaudi",
    file: "b.json",
    genre: "neoclassical",
    difficulty: 4,
    addedAt: "2026-11-04",
    duration: 406,
  },
  {
    id: "c",
    title: "Comptine d'un autre été",
    artist: "Yann Tiersen",
    file: "c.json",
    genre: "film-tv",
    tags: ["Amélie"],
    addedAt: "2026-10-01",
    duration: 140,
  },
  {
    id: "d",
    title: "Auld Lang Syne",
    file: "d.json",
    genre: "holiday",
    difficulty: 1,
    addedAt: "2026-12-01",
    duration: 90,
  },
];
const all: Filters = { q: "", genre: "", difficulty: "", sort: "recent" };
const ids = (f: Partial<Filters>) => select(bank, { ...all, ...f }).map((e) => e.id);

describe("search", () => {
  it("looks in title, artist, genre and tags, ignoring case and accents", () => {
    expect(ids({ q: "einaudi" })).toEqual(["b"]);
    expect(ids({ q: "STARS" })).toEqual(["a"]);
    expect(ids({ q: "amelie" })).toEqual(["c"]);
    expect(ids({ q: "ete" })).toEqual(["c"]);
    expect(ids({ q: "film" }).sort()).toEqual(["a", "c"]);
    expect(ids({ q: "holiday" })).toEqual(["d"]);
  });

  it("needs every word to match somewhere", () => {
    expect(ids({ q: "yann film" })).toEqual(["c"]);
    expect(ids({ q: "yann einaudi" })).toEqual([]);
  });

  it("shows everything for an empty or blank search", () => {
    expect(ids({ q: "   " })).toHaveLength(4);
    expect(matches(bank[0], "")).toBe(true);
  });

  it("folds accents", () => {
    expect(fold("Amélie Été")).toBe("amelie ete");
  });
});

describe("filters", () => {
  it("narrow by genre and by difficulty, together", () => {
    expect(ids({ genre: "film-tv" }).sort()).toEqual(["a", "c"]);
    expect(ids({ difficulty: "4" })).toEqual(["b"]);
    expect(ids({ genre: "film-tv", difficulty: "3" })).toEqual(["a"]);
    expect(ids({ genre: "jazz" })).toEqual([]);
  });

  it("offer only the genres that have songs, in a fixed order", () => {
    expect(genresIn(bank)).toEqual(["film-tv", "neoclassical", "holiday"]);
  });
});

describe("sort", () => {
  it("defaults to newest first, and among songs added the same day, the one listed later", () => {
    expect(ids({})).toEqual(["d", "b", "a", "c"]);
  });
  it("by title and by artist, with nameless artists first", () => {
    expect(ids({ sort: "title" })).toEqual(["d", "c", "b", "a"]);
    expect(ids({ sort: "artist" })).toEqual(["d", "b", "a", "c"]);
  });
  it("by length, shortest first", () => {
    expect(ids({ sort: "length" })).toEqual(["d", "c", "a", "b"]);
  });
  it("by difficulty, easiest first, ungraded last", () => {
    expect(ids({ sort: "difficulty" })).toEqual(["d", "a", "b", "c"]);
  });
});

describe("clock", () => {
  it("writes seconds as minutes and seconds", () => {
    expect(clock(209.4)).toBe("3:29");
    expect(clock(59.6)).toBe("1:00");
    expect(clock(0)).toBe("0:00");
    expect(clock(406.61)).toBe("6:47");
  });
});
