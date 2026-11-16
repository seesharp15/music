import { expect, test } from "@playwright/test";
import { open } from "../helpers";

/** Hand volume and mute, measured on rendered samples. */
const song = (notes: { pitch: number; time: number; duration: number; hand: "L" | "R"; velocity?: number }[]) => ({
  format: "piano-song/v1" as const,
  id: "mix",
  title: "Mix",
  notes,
});
const leftNote = song([{ pitch: 48, time: 0.2, duration: 1.5, hand: "L", velocity: 0.8 }]);
const bothHands = song([
  { pitch: 48, time: 0.2, duration: 1.5, hand: "L", velocity: 0.8 },
  { pitch: 72, time: 0.2, duration: 1.5, hand: "R", velocity: 0.8 },
]);
const full = { volume: 1, muted: false };

test.beforeEach(async ({ page }) => {
  await open(page);
});

test("half way down the slider is 12 dB quieter, and mute is silence", async ({ page }) => {
  const m = await page.evaluate(
    async ({ song, full }) => {
      const { renderOffline, levelDb } = await window.__app!.testing();
      const level = async (L: { volume: number; muted: boolean }) =>
        levelDb(await renderOffline(song, { seconds: 2.5, mix: { L, R: full } }), 0.4, 1.6);
      return {
        full: await level(full),
        half: await level({ volume: 0.5, muted: false }),
        quarter: await level({ volume: 0.25, muted: false }),
        zero: await level({ volume: 0, muted: false }),
        muted: await level({ volume: 1, muted: true }),
      };
    },
    { song: leftNote, full },
  );
  expect(m.full - m.half).toBeGreaterThan(11);
  expect(m.full - m.half).toBeLessThan(13);
  expect(m.full - m.quarter).toBeGreaterThan(23);
  expect(m.full - m.quarter).toBeLessThan(25);
  expect(m.zero).toBeLessThan(-120);
  expect(m.muted).toBeLessThan(-120);
});

test("one hand's volume leaves the other hand alone", async ({ page }) => {
  const m = await page.evaluate(
    async ({ both, left, full }) => {
      const { renderOffline, levelDb } = await window.__app!.testing();
      const right = { ...both, notes: both.notes.filter((n) => n.hand === "R") };
      const at = async (s: typeof both, mix: object) =>
        levelDb(await renderOffline(s, { seconds: 2.5, mix: mix as never }), 0.4, 1.6);
      return {
        rightAlone: await at(right, { L: full, R: full }),
        bothWithLeftMuted: await at(both, { L: { volume: 1, muted: true }, R: full }),
        leftAlone: await at(left, { L: full, R: full }),
        bothWithRightMuted: await at(both, { L: full, R: { volume: 0.3, muted: true } }),
      };
    },
    { both: bothHands, left: leftNote, full },
  );
  expect(Math.abs(m.bothWithLeftMuted - m.rightAlone)).toBeLessThan(0.1);
  expect(Math.abs(m.bothWithRightMuted - m.leftAlone)).toBeLessThan(0.1);
});

test("muting and un-muting during a long note is silent, then back, with no click", async ({ page }) => {
  const held = song([{ pitch: 48, time: 0.2, duration: 4, hand: "L", velocity: 0.9 }]);
  const m = await page.evaluate(
    async ({ song, full }) => {
      const { renderOffline, levelDb, maxJump } = await window.__app!.testing();
      const changes = [
        { time: 1.5, hand: "L" as const, mix: { volume: 1, muted: true } },
        { time: 2.5, hand: "L" as const, mix: full },
      ];
      const plain = await renderOffline(song, { seconds: 5 });
      const r = await renderOffline(song, { seconds: 5, changes });
      return {
        before: levelDb(r, 1.0, 1.45),
        during: levelDb(r, 1.7, 2.45),
        after: levelDb(r, 2.7, 3.5),
        afterPlain: levelDb(plain, 2.7, 3.5),
        jumpAtMute: maxJump(r, 1.45, 1.7),
        jumpAtUnmute: maxJump(r, 2.45, 2.7),
        jumpPlain: maxJump(plain, 1.0, 3.5),
      };
    },
    { song: held, full },
  );
  expect(m.before).toBeGreaterThan(-50);
  expect(m.during).toBeLessThan(-100);
  expect(Math.abs(m.after - m.afterPlain)).toBeLessThan(0.5); // it comes back exactly as loud as if never muted
  expect(m.jumpAtMute).toBeLessThan(0.1);
  expect(m.jumpAtUnmute).toBeLessThan(0.1);
  // No sharper than the note's own waveform.
  expect(m.jumpAtMute).toBeLessThanOrEqual(m.jumpPlain * 1.5 + 1e-6);
  expect(m.jumpAtUnmute).toBeLessThanOrEqual(m.jumpPlain * 1.5 + 1e-6);
});

test("a full two-handed chord at top volume does not clip", async ({ page }) => {
  const chord = song(
    [36, 43, 48, 52, 55, 60, 64, 67, 72, 76].map((pitch, i) => ({
      pitch,
      time: 0.3,
      duration: 1.2,
      hand: (i < 4 ? "L" : "R") as "L" | "R",
      velocity: 1,
    })),
  );
  const peaks = await page.evaluate(async (song) => {
    const { renderOffline, peakDb } = await window.__app!.testing();
    const out: Record<string, number> = {};
    for (const sound of ["clear", "soft", "epiano", "bright"] as const) {
      out[sound] = peakDb(await renderOffline(song, { sound, seconds: 3 }));
    }
    return out;
  }, chord);
  for (const [sound, peak] of Object.entries(peaks)) expect(peak, sound).toBeLessThan(0);
});
