// The app derives a user song's card from the song (src/song/summary.ts); this script derives the
// bank's index (song-index.mjs). One card component draws both, so the two must agree.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSong } from "../../src/song/schema";
import { summarize } from "../../src/song/summary";
import { derive } from "./song-index.mjs";

const bank = (id) => JSON.parse(readFileSync(`public/songs/${id}.json`, "utf8"));

describe.each(["rewrite-the-stars", "divenire"])("%s", (id) => {
  it("is summarized by the app exactly as the index script derives it", () => {
    expect(summarize(bank(id))).toEqual(derive(bank(id)));
  });
  it("passes the song schema with every note kept", () => {
    const parsed = parseSong(bank(id));
    expect(parsed.ok).toBe(true);
    expect(parsed.song.notes).toHaveLength(bank(id).notes.length);
  });
});
