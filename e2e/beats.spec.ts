import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { bandSong } from "./fixtures/band";
import { mockBank, needsSound, open, playerReady } from "./helpers";

/**
 * Practice counts beats through a BeatMap (Stage 2, S2.7). For the songs it already had, nothing may
 * have moved: the rhythm map says what it said, the metronome clicks when it clicked, and a song
 * played freely still has no grid. `src/song/rhythm.unchanged.test.ts` proves the arithmetic is the
 * same to the last bit; this file checks the screen and the clicks themselves, on the real songs.
 */
needsSound();

const MS = 0.001;

interface BankNote {
  time: number;
  duration: number;
  pitch: number;
  hand: "L" | "R";
}
const bank = (id: string): { bpm?: number; duration: number; notes: BankNote[] } =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../public/songs/${id}.json`, import.meta.url)), "utf8"));

/**
 * What the rhythm map showed for a song before Stage 2, worked out here from the song file with the
 * arithmetic the app used then: for each of the two bars from `firstBar` (zero-based), each cell's
 * label as a screen reader hears it.
 */
function labelsBefore(id: string, firstBar: number): string[] {
  const song = bank(id);
  const notes = song.notes
    .filter((n) => n.duration > 0 && n.pitch >= 21 && n.pitch <= 108)
    .sort((a, b) => a.time - b.time || a.pitch - b.pitch);
  const beat = 60 / song.bpm!;
  const moments: { time: number; hands: Set<string> }[] = [];
  for (const n of notes) {
    let m = moments[moments.length - 1];
    if (!m || n.time - m.time > 0.03) moments.push((m = { time: n.time, hands: new Set() }));
    m.hands.add(n.hand);
  }
  const eighth = beat / 2;
  const off = moments.filter((m) => Math.abs(m.time / eighth - Math.round(m.time / eighth)) > 0.25).length;
  const sub = off > moments.length * 0.05 ? 4 : 2;
  const cell = beat / sub;
  const cellsPerBar = 4 * sub;
  const byCell = new Map<number, Set<string>>();
  for (const m of moments) {
    const idx = Math.round(m.time / cell);
    const hands = byCell.get(idx) ?? new Set<string>();
    m.hands.forEach((h) => hands.add(h));
    byCell.set(idx, hands);
  }
  const names = sub === 2 ? ["", "&"] : ["", "e", "&", "a"];
  const out: string[] = [];
  for (let i = 0; i < cellsPerBar * 2; i++) {
    const hands = byCell.get(firstBar * cellsPerBar + i) ?? new Set();
    const inBar = i % cellsPerBar;
    const count = inBar % sub === 0 ? String(Math.floor(inBar / sub) + 1) : names[inBar % sub];
    const what =
      hands.size === 2 ? "both hands together" : hands.has("R") ? "right hand" : hands.has("L") ? "left hand" : "rest";
    out.push(`Bar ${firstBar + Math.floor(i / cellsPerBar) + 1}, count ${count}: ${what}`);
  }
  return out;
}

const cellLabels = (page: Page) =>
  page.locator(".rhythm-cell").evaluateAll((cells) => cells.map((c) => c.getAttribute("aria-label")));

async function clicksWhilePlaying(page: Page, forMs: number, from = 0, countInBars = 0) {
  return page.evaluate(
    async ({ forMs, from, countInBars }) => {
      const { recordSink } = await window.__app!.testing();
      const player = window.__app!.player!;
      player.pause();
      player.setLoop({ enabled: false });
      player.setRate(1);
      player.setMetronome(countInBars === 0);
      player.seek(from);
      const rec = recordSink(player, { silent: true });
      await player.play({ countInBars });
      await new Promise((r) => setTimeout(r, forMs));
      player.pause();
      rec.stop();
      player.setMetronome(false);
      return {
        clicks: rec.calls.filter((c) => c.kind === "click").map((c) => ({ when: c.when, accent: c.accent! })),
        notes: rec.calls.filter((c) => c.kind === "note").map((c) => ({ when: c.when, pitch: c.pitch! })),
      };
    },
    { forMs, from, countInBars },
  );
}

// ── Acceptance criterion 2 ──
test.describe("Rewrite the Stars is counted exactly as it was", () => {
  test.beforeEach(async ({ page }) => {
    await open(page, "#/play/rewrite-the-stars");
    await playerReady(page);
  });

  test("the rhythm map shows the same bars, counts and hands, at the start and deep into the song", async ({
    page,
  }) => {
    await expect(page.locator(".rhythm-cell").first()).toBeVisible();
    expect(await cellLabels(page)).toEqual(labelsBefore("rewrite-the-stars", 0));
    await expect(page.locator(".rhythm-bar-num").first()).toHaveText("Bar 1");

    // 100 s in: bar 53 (a bar is 1.92 s at 125).
    await page.evaluate(() => window.__app!.player!.seek(100));
    await expect(page.locator(".rhythm-bar-num").first()).toHaveText("Bar 53");
    expect(await cellLabels(page)).toEqual(labelsBefore("rewrite-the-stars", 52));

    // And on a bar line exactly: the start of bar 9, where the first verse begins.
    await page.evaluate(() => window.__app!.player!.seek(15.36));
    await expect(page.locator(".rhythm-bar-num").first()).toHaveText("Bar 9");
    expect(await cellLabels(page)).toEqual(labelsBefore("rewrite-the-stars", 8));
  });

  test("the metronome clicks every 0.48 s, accent on the first of four, on the same clock as the notes", async ({
    page,
  }) => {
    const run = await clicksWhilePlaying(page, 4300);
    expect(run.clicks.length).toBeGreaterThanOrEqual(9);
    expect(run.clicks.slice(0, 9).map((c) => c.accent)).toEqual([
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
    ]);
    // The first click falls on the instant playback starts and so is asked for a moment late (as
    // it always was); from the second on, each is within a millisecond of its beat.
    const zero = run.clicks[1].when - 0.48;
    run.clicks
      .slice(1, 9)
      .forEach((c, i) => expect(Math.abs(c.when - zero - (i + 1) * 0.48), `click ${i + 1}`).toBeLessThan(1 * MS));
    // The song's first note is at 0 s, its next notes on the grid: the clicks line up with them.
    const song = bank("rewrite-the-stars");
    const first = [...song.notes].sort((a, b) => a.time - b.time).find((n) => n.time > 0.4)!;
    const heard = run.notes.find((n) => n.pitch === first.pitch && n.when - zero > 0.4)!;
    expect(Math.abs(heard.when - zero - first.time)).toBeLessThan(2 * MS);
  });

  test("the Loop button still takes the section under the playhead", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Rewrite the Stars" })).toBeVisible();
    await page.evaluate(() => window.__app!.player!.seek(20));
    expect((await page.evaluate(() => window.__app!.player!.state.loop)).enabled).toBe(false);
    // Verse 1 runs from bar 9 to bar 21: 15.36 s to 38.4 s.
    await expect(async () => {
      if (!(await page.evaluate(() => window.__app!.player!.state.loop.enabled))) await page.keyboard.press("l");
      expect(await page.evaluate(() => window.__app!.player!.state.loop)).toEqual({
        enabled: true,
        start: 15.36,
        end: 38.4,
      });
    }).toPass({ timeout: 5000 });
  });
});

test.describe("Divenire, played freely, still shows no grid", () => {
  test("no rhythm map, no metronome switch, and nothing clicks", async ({ page }) => {
    await open(page, "#/play/divenire");
    await playerReady(page);
    await expect(page.getByRole("heading", { name: "Divenire" })).toBeVisible();
    await expect(page.locator(".rhythm")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Metronome" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Sustain/ })).toBeVisible();
    const run = await clicksWhilePlaying(page, 1200);
    expect(run.clicks).toEqual([]);
    expect(run.notes.length).toBeGreaterThan(0);
    // A count-in has nothing to count either.
    const counted = await clicksWhilePlaying(page, 600, 0, 1);
    expect(counted.clicks).toEqual([]);
  });
});

test.describe("a song whose tempo changes is counted where its beats are", () => {
  const band = bandSong(); // 120 for a bar (2 s), then 90

  test.beforeEach(async ({ page }) => {
    await mockBank(page, [band as never]);
    await open(page, "#/play/u-band");
    await playerReady(page);
  });

  test("the metronome follows the change", async ({ page }) => {
    const run = await clicksWhilePlaying(page, 4500);
    expect(run.clicks.map((c) => c.accent).slice(0, 8)).toEqual([true, false, false, false, true, false, false, false]);
    const zero = run.clicks[1].when - 0.5;
    const expected = [0.5, 1, 1.5, 2, 2 + 2 / 3, 2 + 4 / 3, 4];
    expected.forEach((t, i) =>
      expect(Math.abs(run.clicks[i + 1].when - zero - t), `click at ${t}`).toBeLessThan(2 * MS),
    );
  });

  test("the rhythm map turns to bar 2 where bar 2 really starts, and its cells are the slower beats", async ({
    page,
  }) => {
    await expect(page.locator(".rhythm-bar-num").first()).toHaveText("Bar 1");
    await page.evaluate(() => window.__app!.player!.seek(1.99));
    await expect(page.locator(".rhythm-bar-num").first()).toHaveText("Bar 1");
    await page.evaluate(() => window.__app!.player!.seek(2.01));
    await expect(page.locator(".rhythm-bar-num").first()).toHaveText("Bar 2");
    const labels = await cellLabels(page);
    // Bar 2 at 90: the melody and the bass strike together on 1 and on 3.
    expect(labels[0]).toBe("Bar 2, count 1: both hands together");
    expect(labels.find((l) => l?.startsWith("Bar 2, count 3:"))).toBe("Bar 2, count 3: both hands together");
    // Tapping the cell on beat 2 of bar 2 goes to 2.667 s, not to where beat 2 would be at 120.
    await page.getByRole("button", { name: /^Bar 2, count 2:/ }).click();
    expect(await page.evaluate(() => window.__app!.player!.currentTime())).toBeCloseTo(2 + 2 / 3, 3);
  });

  test("a count-in takes the tempo of the place it starts from", async ({ page }) => {
    const run = await clicksWhilePlaying(page, 3200, 2.0, 1);
    expect(run.clicks).toHaveLength(4);
    const gaps = run.clicks.slice(2).map((c, i) => c.when - run.clicks[i + 1].when);
    gaps.forEach((g) => expect(Math.abs(g - 2 / 3)).toBeLessThan(2 * MS));
  });
});
