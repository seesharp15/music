import { expect, test, type Page } from "@playwright/test";
import { fixture, mockBank, open, playerReady } from "./helpers";

/**
 * What the player schedules, and when. A recording sink stands in for the instruments and notes
 * every call; nothing here depends on what comes out of the speakers. This is the test that
 * protects the scheduler while the audio path is rebuilt around it.
 *
 * The fixture has notes at 0.5, 1.0 and 1.5 s.
 */
const MS = 0.001;

interface Run {
  startedAt: number;
  notes: { pitch: number; when: number; duration: number; hand: string }[];
}

async function record(
  page: Page,
  opts: { rate: number; loop?: [number, number]; forMs: number; metronome?: boolean },
): Promise<Run & { clicks: { when: number; accent: boolean }[] }> {
  return page.evaluate(async ({ rate, loop, forMs, metronome }) => {
    const { recordSink, audioNow } = await window.__app!.testing();
    const player = window.__app!.player!;
    player.pause();
    player.setRate(rate);
    player.setMetronome(!!metronome);
    if (loop) player.setLoop({ enabled: true, start: loop[0], end: loop[1] });
    else player.setLoop({ enabled: false });
    player.seek(loop ? loop[0] : 0);
    const rec = recordSink(player, { silent: true });
    await player.play();
    const startedAt = audioNow();
    await new Promise((r) => setTimeout(r, forMs));
    player.pause();
    rec.stop();
    return {
      startedAt,
      notes: rec.calls
        .filter((c) => c.kind === "note")
        .map((c) => ({ pitch: c.pitch!, when: c.when, duration: c.duration!, hand: c.hand! })),
      clicks: rec.calls.filter((c) => c.kind === "click").map((c) => ({ when: c.when, accent: c.accent! })),
    };
  }, opts);
}

test.beforeEach(async ({ page }) => {
  await mockBank(page, [fixture("three-notes")]);
  await open(page, "#/play/three-notes");
  await playerReady(page);
});

test("at full speed each note is asked for at its written time", async ({ page }) => {
  const run = await record(page, { rate: 1, forMs: 2300 });
  expect(run.notes.map((n) => [n.pitch, n.hand])).toEqual([
    [60, "R"],
    [48, "L"],
    [64, "R"],
  ]);
  const at = run.notes.map((n) => n.when - run.startedAt);
  expect(Math.abs(at[0] - 0.5)).toBeLessThan(30 * MS); // start of playback is only known to a tick
  expect(Math.abs(at[1] - at[0] - 0.5)).toBeLessThan(5 * MS);
  expect(Math.abs(at[2] - at[1] - 0.5)).toBeLessThan(5 * MS);
  for (const n of run.notes) expect(n.duration).toBeCloseTo(0.4, 6);
});

test("at half speed everything takes twice as long, and lasts twice as long", async ({ page }) => {
  const run = await record(page, { rate: 0.5, forMs: 3600 });
  expect(run.notes.map((n) => n.pitch)).toEqual([60, 48, 64]);
  const at = run.notes.map((n) => n.when - run.startedAt);
  expect(Math.abs(at[0] - 1.0)).toBeLessThan(30 * MS);
  expect(Math.abs(at[1] - at[0] - 1.0)).toBeLessThan(5 * MS);
  expect(Math.abs(at[2] - at[1] - 1.0)).toBeLessThan(5 * MS);
  for (const n of run.notes) expect(n.duration).toBeCloseTo(0.8, 6);
});

test("a loop comes round without a gap or a stumble", async ({ page }) => {
  // The loop runs 0.4 → 1.8 s: 1.4 s long, so notes fall 0.1, 0.6 and 1.1 s into each pass.
  const run = await record(page, { rate: 1, loop: [0.4, 1.8], forMs: 3600 });
  expect(run.notes.length).toBeGreaterThanOrEqual(7);
  expect(run.notes.slice(0, 7).map((n) => n.pitch)).toEqual([60, 48, 64, 60, 48, 64, 60]);
  const gaps = run.notes.slice(1, 7).map((n, i) => n.when - run.notes[i].when);
  const expected = [0.5, 0.5, 0.4, 0.5, 0.5, 0.4];
  gaps.forEach((gap, i) => expect(Math.abs(gap - expected[i])).toBeLessThan(5 * MS));
  // The last note would run past the loop's end, so it is cut to fit: 1.8 − 1.5 = 0.3 s.
  expect(run.notes[2].duration).toBeCloseTo(0.3, 6);
  expect(run.notes[0].duration).toBeCloseTo(0.4, 6);
});

test("the metronome clicks on every beat and accents the first of the bar", async ({ page }) => {
  const run = await record(page, { rate: 1, forMs: 2800, metronome: true });
  // 120 BPM: a beat every 0.5 s from the start of the song.
  expect(run.clicks.length).toBeGreaterThanOrEqual(5);
  expect(run.clicks.slice(0, 5).map((c) => c.accent)).toEqual([true, false, false, false, true]);
  // The click on the very first beat cannot be asked for in the past, so it sounds as soon as playback
  // has started: a few milliseconds late, more on a busy machine. Every click after it is exact.
  expect(Math.abs(run.clicks[0].when - run.startedAt)).toBeLessThan(30 * MS);
  const gaps = run.clicks.slice(2, 5).map((c, i) => c.when - run.clicks[i + 1].when);
  gaps.forEach((gap) => expect(Math.abs(gap - 0.5)).toBeLessThan(5 * MS));
  // Clicks and notes share a clock: the second click and the first note are both at 0.5 s.
  expect(Math.abs(run.clicks[1].when - run.notes[0].when)).toBeLessThan(5 * MS);
});

test("the same three calls, every time", async ({ page }) => {
  for (let i = 0; i < 3; i++) {
    const run = await record(page, { rate: 1, forMs: 2100 });
    expect(run.notes.map((n) => [n.pitch, n.hand, Number(n.duration.toFixed(6))])).toEqual([
      [60, "R", 0.4],
      [48, "L", 0.4],
      [64, "R", 0.4],
    ]);
  }
});

test("a muted hand is still scheduled, so un-muting brings it straight back", async ({ page }) => {
  await page.evaluate(() => window.__app!.player!.setMuted("L", true));
  const run = await record(page, { rate: 1, forMs: 2100 });
  expect(run.notes.map((n) => [n.pitch, n.hand])).toEqual([
    [60, "R"],
    [48, "L"],
    [64, "R"],
  ]);
});
