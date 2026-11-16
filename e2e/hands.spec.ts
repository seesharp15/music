import { expect, test, type Page } from "@playwright/test";
import { fixture, mockBank, open, playerReady } from "./helpers";

const mix = (page: Page) => page.evaluate(() => window.__app!.player!.state.mix);

test.beforeEach(async ({ page }) => {
  await mockBank(page, [fixture("three-notes")]);
  await open(page, "#/play/three-notes");
  await playerReady(page);
});

test("each hand has a volume slider and a mute button, by mouse and by keyboard", async ({ page }) => {
  const left = page.getByRole("slider", { name: "Left hand volume" });
  const muteLeft = page.getByRole("button", { name: "Mute left hand" });
  await expect(left).toHaveValue("100");
  await expect(muteLeft).toHaveAttribute("aria-pressed", "false");

  await left.focus();
  for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowLeft");
  expect(await mix(page)).toEqual({ L: { volume: 0.7, muted: false }, R: { volume: 1, muted: false } });
  await expect(left).toHaveAttribute("aria-valuetext", "70 percent");

  await muteLeft.click();
  expect((await mix(page)).L).toEqual({ volume: 0.7, muted: true });
  await expect(muteLeft).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".hand-row").first()).toContainText("Muted");

  // Moving the slider un-mutes.
  await left.focus();
  await page.keyboard.press("ArrowRight");
  expect((await mix(page)).L).toEqual({ volume: 0.71, muted: false });
});

test("1 and 2 mute and un-mute the left and right hands, and the volume is remembered", async ({ page }) => {
  await page.evaluate(() => window.__app!.player!.setVolume("R", 0.4));
  await page.keyboard.press("2");
  expect((await mix(page)).R).toEqual({ volume: 0.4, muted: true });
  await page.keyboard.press("1");
  expect((await mix(page)).L.muted).toBe(true);
  await page.keyboard.press("2");
  await page.keyboard.press("1");
  expect(await mix(page)).toEqual({ L: { volume: 1, muted: false }, R: { volume: 0.4, muted: false } });
});

test("a double-click on a slider puts the hand back to full volume", async ({ page }) => {
  await page.evaluate(() => window.__app!.player!.setVolume("L", 0.3));
  await page.getByRole("slider", { name: "Left hand volume" }).dblclick();
  expect((await mix(page)).L).toEqual({ volume: 1, muted: false });
});

test("the folded panel says where each hand stands", async ({ page }) => {
  await page.evaluate(() => {
    window.__app!.player!.setVolume("L", 0.7);
    window.__app!.player!.setMuted("R", true);
  });
  await page.getByRole("button", { name: /^Hands/ }).click();
  await expect(page.getByRole("button", { name: /^Hands/ })).toContainText("Left 70% · Right Muted");
});

test("the hands' volumes survive a reload", async ({ page }) => {
  await page.evaluate(() => {
    window.__app!.player!.setVolume("L", 0.55);
    window.__app!.player!.setMuted("R", true);
  });
  await page.reload();
  await playerReady(page);
  expect(await mix(page)).toEqual({ L: { volume: 0.55, muted: false }, R: { volume: 1, muted: true } });
});

test("a session from before hands had a volume is carried over", async ({ page }) => {
  // Leaving the page saves the session in today's shape, so the old one is planted as the next page starts.
  await page.addInitScript(() => {
    if (sessionStorage.getItem("planted")) return;
    sessionStorage.setItem("planted", "1");
    sessionStorage.setItem(
      "piano-tutor:session:three-notes",
      JSON.stringify({ time: 0, levels: { L: "soft", R: "off" } }),
    );
  });
  await page.reload();
  await playerReady(page);
  expect(await mix(page)).toEqual({ L: { volume: 0.47, muted: false }, R: { volume: 1, muted: true } });
});

test("the controls fit a phone, with touch-sized targets", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ["Mute left hand", "Mute right hand"]) {
    const box = await page.getByRole("button", { name }).boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  const slider = await page.getByRole("slider", { name: "Right hand volume" }).boundingBox();
  expect(slider!.height).toBeGreaterThanOrEqual(44);
  expect(slider!.x + slider!.width).toBeLessThanOrEqual(390);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("the practice routine borrows the mute switches and hands them back; volumes are never touched", async ({
  page,
}) => {
  // Left at 60%, right at 100%, a half-second loop so the ten passes take a few seconds.
  await page.evaluate(() => {
    const p = window.__app!.player!;
    p.setVolume("L", 0.6);
    p.setLoop({ enabled: true, start: 0.4, end: 0.9 });
  });
  await page.getByRole("button", { name: /Start routine/ }).click();
  expect(await mix(page)).toEqual({ L: { volume: 0.6, muted: true }, R: { volume: 1, muted: false } }); // step 1: right hand alone
  await expect(page.getByText("Done.", { exact: false })).toBeVisible({ timeout: 20_000 });
  expect(await mix(page)).toEqual({ L: { volume: 0.6, muted: false }, R: { volume: 1, muted: false } });

  // Stopping part-way hands them back too, including a hand that was muted to begin with.
  await page.evaluate(() => window.__app!.player!.setMuted("R", true));
  await page.getByRole("button", { name: /Run again/ }).click();
  await page.getByRole("button", { name: /Stop routine/ }).click();
  expect(await mix(page)).toEqual({ L: { volume: 0.6, muted: false }, R: { volume: 1, muted: true } });
});
