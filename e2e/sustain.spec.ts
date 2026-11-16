import { expect, test } from "@playwright/test";
import { fixture, mockBank, open, playerReady } from "./helpers";

test.beforeEach(async ({ page }) => {
  await mockBank(page, [fixture("three-notes")]);
  await open(page, "#/play/three-notes");
  await playerReady(page);
});

const sustain = (page: import("@playwright/test").Page) => page.evaluate(() => window.__app!.player!.state.sustain);

test("the Sustain switch holds the pedal down, from the button and from P", async ({ page }) => {
  const chip = page.getByRole("button", { name: "Sustain" });
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  expect(await sustain(page)).toBe(false);

  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  expect(await sustain(page)).toBe(true);

  await page.keyboard.press("p");
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  expect(await sustain(page)).toBe(false);
});

test("the pedal is remembered, like the other sound settings", async ({ page }) => {
  await page.getByRole("button", { name: "Sustain" }).click();
  await page.reload();
  await playerReady(page);
  expect(await sustain(page)).toBe(true);
  await expect(page.getByRole("button", { name: "Sustain" })).toHaveAttribute("aria-pressed", "true");
});

test("the pedal changes nothing about when notes are played", async ({ page }) => {
  const starts = async () =>
    page.evaluate(async () => {
      const { recordSink } = await window.__app!.testing();
      const player = window.__app!.player!;
      player.pause();
      player.seek(0);
      const rec = recordSink(player, { silent: true });
      await player.play();
      await new Promise((r) => setTimeout(r, 2100));
      player.pause();
      rec.stop();
      const notes = rec.calls.filter((c) => c.kind === "note");
      return notes.map((n) => [n.pitch, Number((n.when - notes[0].when).toFixed(3)), n.duration]);
    });
  const without = await starts();
  await page.getByRole("button", { name: "Sustain" }).click();
  expect(await starts()).toEqual(without);
});

test("each time a loop comes round, what was ringing is damped before the first note of the next pass", async ({
  page,
}) => {
  const calls = await page.evaluate(async () => {
    const { recordSink } = await window.__app!.testing();
    const player = window.__app!.player!;
    player.setSustain(true);
    player.setLoop({ enabled: true, start: 0.4, end: 1.8 });
    player.seek(0.4);
    const rec = recordSink(player, { silent: true });
    await player.play();
    await new Promise((r) => setTimeout(r, 3400));
    player.pause();
    rec.stop();
    return rec.calls.filter((c) => c.kind !== "click").map((c) => ({ kind: c.kind, pitch: c.pitch, when: c.when }));
  });
  const kinds = calls.map((c) => (c.kind === "note" ? c.pitch : c.kind));
  // Three notes, a damp as the loop comes round, three notes, a damp… and a release when paused.
  expect(kinds.slice(0, 8)).toEqual([60, 48, 64, "damp", 60, 48, 64, "damp"]);
  const firstDamp = calls[3];
  expect(firstDamp.when).toBeGreaterThan(calls[2].when); // after the last note of the pass began
  expect(firstDamp.when).toBeLessThanOrEqual(calls[4].when + 0.005); // not after the next pass's first note
});

test("pausing and seeking leave nothing ringing", async ({ page }) => {
  const kinds = await page.evaluate(async () => {
    const { recordSink } = await window.__app!.testing();
    const player = window.__app!.player!;
    player.setSustain(true);
    player.seek(0);
    const rec = recordSink(player, { silent: true });
    await player.play();
    await new Promise((r) => setTimeout(r, 700));
    player.seek(1.2);
    await new Promise((r) => setTimeout(r, 200));
    player.pause();
    rec.stop();
    return rec.calls.map((c) => c.kind);
  });
  // A release (which damps as well) at the seek, and again at the pause.
  expect(kinds.filter((k) => k === "release").length).toBe(2);
});
