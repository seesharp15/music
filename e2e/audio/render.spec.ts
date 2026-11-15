import { expect, test } from "@playwright/test";
import { open } from "../helpers";

/**
 * The offline render: a song turned into samples without a sound card, and measured.
 * Later stages assert volume, mute, sustain and clipping this way; this file shows the pattern.
 */
const oneNote = {
  format: "piano-song/v1" as const,
  id: "one-note",
  title: "One Note",
  duration: 2,
  notes: [{ pitch: 60, time: 0.5, duration: 0.5, hand: "R" as const, velocity: 0.8 }],
};

test("a rendered note is silent before it starts, sounds while held, and dies away after", async ({ page }) => {
  await open(page);
  const m = await page.evaluate(async (song) => {
    const { renderOffline, levelDb, peakDb } = await window.__app!.testing();
    const r = await renderOffline(song, { seconds: 4 });
    return {
      before: levelDb(r, 0, 0.45),
      during: levelDb(r, 0.5, 1.0),
      tail: levelDb(r, 3.5, 4),
      peak: peakDb(r),
    };
  }, oneNote);
  expect(m.before).toBeLessThan(-100);
  expect(m.during).toBeGreaterThan(-40);
  expect(m.tail).toBeLessThan(-80);
  expect(m.peak).toBeLessThan(0);
});

test("rendering is repeatable: ten renders agree to within a decibel", async ({ page }) => {
  await open(page);
  const levels = await page.evaluate(async (song) => {
    const { renderOffline, levelDb } = await window.__app!.testing();
    const out: number[] = [];
    for (let i = 0; i < 10; i++) out.push(levelDb(await renderOffline(song, { seconds: 1.5 }), 0.5, 0.6));
    return out;
  }, oneNote);
  expect(Math.max(...levels) - Math.min(...levels)).toBeLessThan(1);
  expect(levels[0]).toBeGreaterThan(-60);
});

test("each synthesized sound renders", async ({ page }) => {
  await open(page);
  const levels = await page.evaluate(async (song) => {
    const { renderOffline, levelDb } = await window.__app!.testing();
    const out: Record<string, number> = {};
    for (const sound of ["clear", "soft", "epiano", "bright"] as const) {
      out[sound] = levelDb(await renderOffline(song, { sound, seconds: 1.5 }), 0.5, 1.0);
    }
    return out;
  }, oneNote);
  for (const [sound, level] of Object.entries(levels)) expect(level, sound).toBeGreaterThan(-50);
});
