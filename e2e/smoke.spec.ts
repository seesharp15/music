import { expect, test } from "@playwright/test";
import { open, playerReady } from "./helpers";

/**
 * The one test that walks through Practice the way a person does. If this breaks, Practice is
 * broken. It runs in Chromium and, where WebKit is installed, on an iPhone-sized WebKit too.
 */
test("practise a song: play, loop a section, step, change speed, and pick up after a reload", async ({ page }) => {
  // If the page never gets going, say what it said instead: this test also runs on browsers that
  // cannot be run at a desk, and "heading not found" alone explains nothing.
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`uncaught: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("requestfailed", (r) => problems.push(`request failed: ${r.url()} (${r.failure()?.errorText})`));

  await open(page, "#/play/rewrite-the-stars");
  try {
    await expect(page.getByRole("heading", { level: 1, name: "Rewrite the Stars" })).toBeVisible();
  } catch (e) {
    const said = await page
      .locator("body")
      .innerText()
      .catch(() => "(no body)");
    throw new Error(
      `${(e as Error).message}\n\nThe page shows:\n${said}\n\nProblems:\n${problems.join("\n") || "(none)"}`,
    );
  }
  await playerReady(page);

  // Play: the playhead moves.
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForFunction(() => window.__app!.player!.currentTime() > 0.3);
  expect(await page.evaluate(() => window.__app!.player!.state.playing)).toBe(true);

  // Loop the first section.
  await page.getByRole("group", { name: "Sections" }).getByRole("button").first().click();
  const loop = await page.evaluate(() => window.__app!.player!.state.loop);
  expect(loop.enabled).toBe(true);
  expect(loop.start).toBe(0);
  expect(loop.end).toBeCloseTo(15.36, 2);

  // It wraps: jump to just before the end and watch it come round to the start.
  const wrapped = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const player = window.__app!.player!;
        const off = player.onLoopWrap(() => {
          off();
          resolve(player.currentTime());
        });
        player.seek(player.state.loop.end - 0.4);
      }),
  );
  expect(wrapped).toBeLessThan(1);

  // Step forward twice: playback stops on a moment, and the second is later than the first.
  await page.getByRole("button", { name: "Next moment" }).click();
  const first = await page.evaluate(() => window.__app!.player!.currentTime());
  await page.getByRole("button", { name: "Next moment" }).click();
  const second = await page.evaluate(() => window.__app!.player!.currentTime());
  expect(second).toBeGreaterThan(first);
  expect(await page.evaluate(() => window.__app!.player!.state)).toMatchObject({ playing: false, stepping: true });

  // Slow down by one step.
  await page.keyboard.press("ArrowDown");
  expect(await page.evaluate(() => window.__app!.player!.state.rate)).toBe(0.95);

  // Reload: position, loop and speed come back.
  await page.reload();
  await playerReady(page);
  const after = await page.evaluate(() => {
    const p = window.__app!.player!;
    return { time: p.currentTime(), rate: p.state.rate, loop: p.state.loop };
  });
  expect(after.time).toBeCloseTo(second, 2);
  expect(after.rate).toBe(0.95);
  expect(after.loop).toMatchObject({ enabled: true, start: 0 });
  expect(after.loop.end).toBeCloseTo(15.36, 2);
});
