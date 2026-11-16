import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, type Page } from "@playwright/test";

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

/** The same, with the Studio switched on: My songs in the Library, and the `#/studio` routes. */
export async function openStudio(page: Page, hash = "") {
  await page.goto(`/?flags=test-hooks,studio${hash}`);
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
  // The player exists a moment before the screen built on it does. Wait for that screen, and for
  // the frame after it, by which time its keyboard shortcuts are listening: a key pressed sooner
  // than that, on a busy machine, went nowhere.
  await page.getByRole("button", { name: /^(Play|Pause|Resume from this step)$/ }).waitFor();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))));
}

/**
 * Call at the top of a `describe` whose tests open a song. Playwright's WebKit build for Linux hangs
 * as soon as Tone.js loads, so those tests cannot run there; everything else can.
 */
export function needsSound() {
  test.skip(({ browserName }) => browserName === "webkit", "Playwright's Linux WebKit hangs when Tone.js loads");
}
