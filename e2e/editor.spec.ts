import { expect, test } from "@playwright/test";
import { needsSound } from "./helpers";
import { notesOp, openProject, pixelAt, pointOf, setUi, settled, studioWith, ui, view } from "./studio-helpers";

/**
 * The editor canvas (Stage 3, S3.2): what it draws and where, scrolling and zoom, following
 * playback, and remembering the cursor and the zoom for each project.
 */
needsSound();

const GREEN = [95, 211, 141]; // the melody's colour, as in Practice
const BLUE = [90, 168, 248];
const near = (got: number[], want: number[], within = 40) => got.every((c, i) => Math.abs(c - want[i]) <= within);

const TUNE = [notesOp([60, 62, 64, 65, 67, 69, 71, 72]), notesOp([48, 55], { trackId: "chords", step: 1920 })];

test("the song is drawn as a waterfall: later music higher, each note above its key, coloured by track", async ({
  page,
}) => {
  await studioWith(page, TUNE);
  await settled(page);
  const v = await view(page);
  expect(v.tick).toBe(0);
  expect(v.barGutter + v.chordGutter).toBe(76);

  // The middle of a melody note is green; of a chord-track note, blue but fainter (it is not the
  // active track); between notes there is only background.
  const e = await pointOf(page, 64, 960 + 240);
  const g = await pointOf(page, 67, 1920 + 240);
  expect(near(await pixelAt(page, e), GREEN)).toBe(true);
  expect(near(await pixelAt(page, g), GREEN)).toBe(true);
  expect(e.y).toBeGreaterThan(g.y); // E comes first, so it is lower
  expect(e.x).toBeLessThan(g.x);
  const empty = await pixelAt(page, await pointOf(page, 70, 240));
  expect(Math.max(...empty)).toBeLessThan(40);

  await setUi(page, { keys: "song" });
  await page.waitForTimeout(700);
  const low = await pixelAt(page, await pointOf(page, 48, 960));
  expect(low[2]).toBeGreaterThan(low[0] + 15); // bluish
  expect(near(low, BLUE, 25)).toBe(false); // but not at full strength

  // Make it the active track and it is drawn solid.
  await page.getByRole("tab", { name: "Chords" }).click();
  await expect.poll(async () => near(await pixelAt(page, await pointOf(page, 48, 960)), BLUE)).toBe(true);
});

test("the cursor line sits two fifths of the way up; the music glides under it when the cursor moves", async ({
  page,
}) => {
  await studioWith(page, TUNE);
  await settled(page);
  const v = await view(page);
  const lineY = (await pointOf(page, 60, 0)).y;
  const canvas = (await page.locator("canvas.editor-canvas").boundingBox())!;
  const waterfall = v.height - v.kbH;
  expect(lineY - canvas.y).toBeCloseTo(waterfall * 0.6, 0);

  await setUi(page, { cursor: 1920 });
  await settled(page);
  expect((await view(page)).tick).toBe(1920);
  // Tick 1920 is now on the line; what was there has moved down.
  expect((await pointOf(page, 60, 1920)).y).toBeCloseTo(lineY, 0);
  expect((await pointOf(page, 60, 0)).y).toBeGreaterThan(lineY);
});

test("the wheel scrolls through the song and the cursor settles on the grid; it stops at the start", async ({
  page,
}) => {
  await studioWith(page, TUNE);
  await settled(page);
  const box = (await page.locator("canvas.editor-canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  // Rolling the wheel up brings later music down to the line, as in Practice.
  await page.mouse.wheel(0, -137);
  await expect.poll(async () => (await ui(page)).cursor).toBeGreaterThan(0);
  await settled(page);
  const { cursor, snap } = await ui(page);
  expect(snap).toBe(16);
  expect(cursor % 120).toBe(0);
  const v = await view(page);
  expect(Math.abs(cursor - 137 * v.ticksPerPx)).toBeLessThanOrEqual(60);

  await page.mouse.wheel(0, 5000);
  await expect.poll(async () => (await ui(page)).cursor).toBe(0);
});

test("zoom runs from one bar on screen to sixteen, by Ctrl+wheel and by the View buttons", async ({ page }) => {
  await studioWith(page, TUNE);
  await settled(page);
  const v0 = await view(page);
  const waterfall = v0.height - v0.kbH;
  const box = (await page.locator("canvas.editor-canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 100);

  await page.keyboard.down("Control");
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -400);
  await page.keyboard.up("Control");
  await expect.poll(async () => (await view(page)).ticksPerPx).toBeCloseTo(1920 / waterfall, 6);

  await page.getByRole("button", { name: "View: zoom and keys" }).click();
  const out = page.getByRole("button", { name: "Zoom out: show more bars" });
  for (let i = 0; i < 12; i++) await out.click();
  await expect.poll(async () => (await view(page)).ticksPerPx).toBeCloseTo((16 * 1920) / waterfall, 6);
  await page.getByRole("button", { name: "Zoom in: show fewer bars" }).click();
  await expect.poll(async () => (await view(page)).ticksPerPx).toBeLessThan((16 * 1920) / waterfall);
});

test("the View panel shifts the keys by octaves and switches between Fit, Song and All", async ({ page }) => {
  await studioWith(page, TUNE);
  await settled(page);
  const fit = await view(page);
  await page.getByRole("button", { name: "View: zoom and keys" }).click();

  await page.getByRole("button", { name: "Keys an octave higher" }).click();
  await expect.poll(async () => (await view(page)).keyLo).toBeCloseTo(fit.keyLo + 7, 3);
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect.poll(async () => (await view(page)).keyHi - (await view(page)).keyLo).toBeCloseTo(52, 3);
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await expect.poll(async () => (await view(page)).keyLo).toBeCloseTo(fit.keyLo, 3);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: "View", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "View: zoom and keys" })).toBeFocused();
});

test("during playback the music scrolls past the line; stopping returns to the cursor", async ({ page }) => {
  await studioWith(page, TUNE);
  await settled(page);
  await setUi(page, { cursor: 480 });
  await settled(page);
  await page.evaluate(() => window.__app!.session!.playback.play());
  await expect.poll(async () => (await ui(page)).playing).toBe(true);
  // 100 BPM: 800 ticks a second. The view follows the player's clock, not a timer of its own.
  await page.waitForFunction(() => window.__app!.session!.editor!.view()!.tick > 480 + 400);
  const drift = await page.evaluate(() => {
    const s = window.__app!.session!;
    return new Promise<number>((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => resolve(Math.abs(s.editor!.view()!.tick - s.playback.tick()))),
      ),
    );
  });
  expect(drift).toBeLessThan(40); // within a frame or two of the playhead
  expect((await ui(page)).cursor).toBe(480);

  await page.evaluate(() => window.__app!.session!.playback.stop());
  await settled(page);
  expect((await view(page)).tick).toBe(480);
});

test("closing the tab and reopening restores the cursor, the zoom, the tool and the active track", async ({
  page,
  context,
}) => {
  await studioWith(page, TUNE);
  await settled(page);
  await setUi(page, { cursor: 2400, ticksPerPx: 9.5, tool: "draw", activeTrack: "bass" });
  // Closed at once: sooner than the editor state is due to be written to the database.
  await page.close({ runBeforeUnload: true });

  const again = await context.newPage();
  await openProject(again, "tune");
  expect(await ui(again)).toMatchObject({ cursor: 2400, ticksPerPx: 9.5, tool: "draw", activeTrack: "bass" });
  await settled(again);
  expect((await view(again)).tick).toBe(2400);

  // And when there was time to write it properly, the last-moment copy is not left behind.
  await setUi(again, { cursor: 960 });
  await again.waitForTimeout(600);
  expect(await again.evaluate(() => localStorage.getItem("piano-tutor:studio:tune"))).toBeNull();
  await again.reload();
  await again.waitForFunction(() => !!window.__app?.session?.editor?.view());
  expect((await ui(again)).cursor).toBe(960);
});

test("the canvas redraws only when something changed", async ({ page }) => {
  await studioWith(page, TUNE);
  await settled(page);
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => window.__app!.session!.editor!.stats().frames);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__app!.session!.editor!.stats().frames)).toBe(before);
  await setUi(page, { cursor: 480 });
  await settled(page);
  expect(await page.evaluate(() => window.__app!.session!.editor!.stats().frames)).toBeGreaterThan(before);
});
