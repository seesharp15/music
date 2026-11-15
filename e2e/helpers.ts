import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

export interface FixtureSong {
  id: string;
  title: string;
  artist?: string;
  duration?: number;
  notes: { pitch: number; time: number; duration: number; hand: "L" | "R"; velocity?: number }[];
  [key: string]: unknown;
}

export function fixture(name: string): FixtureSong {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)), "utf8"));
}

/** Open the built app with the test hooks on. `hash` is the route, e.g. "#/play/divenire". */
export async function open(page: Page, hash = "") {
  await page.goto(`/?flags=test-hooks${hash}`);
}

/** Serve these songs as the whole song bank, in place of the real one. */
export async function mockBank(page: Page, songs: FixtureSong[]) {
  await page.route("**/songs/index.json", (route) =>
    route.fulfill({
      json: songs.map((s) => ({ id: s.id, title: s.title, artist: s.artist, file: `${s.id}.json` })),
    }),
  );
  for (const s of songs) {
    await page.route(`**/songs/${s.id}.json`, (route) => route.fulfill({ json: s }));
  }
}

/** Wait for Practice to have built its player for the song now on screen. */
export async function playerReady(page: Page) {
  await page.waitForFunction(() => !!window.__app?.player);
}
