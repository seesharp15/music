import { expect, test, type Page } from "@playwright/test";
import { needsSound, openStudio } from "./helpers";
import { keyPoint, notesOf, project, ui } from "./studio-helpers";

/**
 * Milestone M2, and Stage 3's first acceptance criterion: write a short tune by tapping keys, add
 * chords, and practise it — start to finish through the real screens, on a phone and on a desktop.
 */
needsSound();

const BAR = 1920;
// Twinkle, twinkle, little star / how I wonder what you are: fourteen notes, four bars.
const MELODY: [pitch: number, half: boolean][] = [
  [60, false],
  [60, false],
  [67, false],
  [67, false],
  [69, false],
  [69, false],
  [67, true],
  [65, false],
  [65, false],
  [64, false],
  [64, false],
  [62, false],
  [62, false],
  [60, true],
];

async function tapKey(page: Page, pitch: number) {
  const at = await keyPoint(page, pitch);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(80); // taps closer together than 60 ms would be a chord
}

for (const [label, viewport] of [
  ["a phone", { width: 390, height: 844 }],
  ["a desktop", { width: 1440, height: 900 }],
] as const) {
  test(`the Twinkle run-through on ${label}: new song → fourteen notes → five chords → Write to track → play → Practice it`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(e.message));

    // A new song: C major, 100 BPM.
    await openStudio(page);
    await page.getByRole("button", { name: /New song/ }).click();
    await page.waitForFunction(() => !!window.__app?.session?.editor?.view());
    const fresh = await project(page);
    expect(fresh).toMatchObject({ tempo: [{ tick: 0, bpm: 100 }], key: [{ tick: 0, tonic: "C", mode: "major" }] });
    await page.getByRole("button", { name: /Tap it in, one note at a time/ }).click();
    await page.getByRole("button", { name: /song settings$/ }).click();
    const title = page.getByRole("textbox", { name: "Title" });
    await title.fill("Twinkle");
    await title.press("Enter");
    await page.getByRole("button", { name: "Close song settings" }).click();

    // Fourteen notes, in step mode, from the on-screen keys.
    for (const [pitch, half] of MELODY) {
      await page.getByRole("button", { name: half ? "Half note" : "Quarter note" }).click();
      await tapKey(page, pitch);
    }
    const melody = await notesOf(page);
    expect(melody.map((n) => n.pitch)).toEqual(MELODY.map(([p]) => p));
    expect(melody).toHaveLength(14);
    expect(melody[13].tick + melody[13].dur).toBe(4 * BAR);
    expect((await ui(page)).cursor).toBe(4 * BAR);

    // Chords C, F, C, G, C from the picker, a bar each, from the start.
    await page.keyboard.press("Home");
    await page.getByRole("button", { name: "Chords", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Chords" });
    for (const chord of ["C, I", "F, IV", "C, I", "G, V", "C, I"]) {
      await picker.getByRole("button", { name: chord, exact: true }).click();
    }
    expect((await project(page)).chords.map((c) => [c.symbol, c.tick / BAR])).toEqual([
      ["C", 0],
      ["F", 1],
      ["C", 2],
      ["G", 3],
      ["C", 4],
    ]);

    // Write to track.
    await picker.getByRole("button", { name: "Write to track" }).click();
    expect(await notesOf(page, "chords")).toHaveLength(15);
    await page.getByRole("button", { name: "Close chords" }).click();

    // Play: it plays from the start, the music moving past the line.
    await page.keyboard.press("Home");
    await page.getByRole("button", { name: "Play from the cursor" }).click();
    await page.waitForFunction(() => window.__app!.session!.playback.tick() > 900);
    await page.getByRole("button", { name: "Stop", exact: true }).click();

    // Practice it.
    const id = (await project(page)).id;
    await page.getByRole("button", { name: "Practice it" }).click();
    await expect(page).toHaveURL(new RegExp(`#/play/u-${id}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Twinkle" })).toBeVisible();
    await page.waitForFunction(() => !!window.__app?.player);

    // The melody is in the right hand and the chords in the left.
    const song = await page.evaluate(
      async (songId) => (await (await window.__app!.kit()).catalog().load(songId))!,
      `u-${id}`,
    );
    const right = song.notes.filter((n) => n.hand === "R");
    const left = song.notes.filter((n) => n.hand === "L");
    expect(right.map((n) => n.pitch)).toEqual(MELODY.map(([p]) => p));
    expect(left).toHaveLength(15);
    expect(left.every((n) => n.pitch < 60 || n.track === "chords")).toBe(true);
    // And Practice says so, count by count: both hands on the first beat, the right alone on the second.
    const map = page.getByLabel("Rhythm map: which hand plays on each count");
    await expect(map.getByLabel(/^Bar 1, count 1: /)).toHaveAttribute("aria-label", /both/i);
    await expect(map.getByLabel(/^Bar 1, count 2: /)).toHaveAttribute("aria-label", /right/i);
    await expect(map.getByLabel(/^Bar 1, count 2: /)).not.toHaveAttribute("aria-label", /left|both/i);

    // The bar count is right: eight bars of 4/4 at 100 BPM is 19.2 seconds, and bar 1 leads the map.
    expect(song).toMatchObject({ bpm: 100, timeSignature: [4, 4], title: "Twinkle", key: "C major" });
    expect(song.duration).toBeCloseTo(8 * 2.4, 6);
    expect(await page.evaluate(() => window.__app!.player!.duration)).toBeCloseTo(19.2, 6);
    await expect(map.getByText("Bar 1", { exact: true })).toBeVisible();

    // It plays in Practice, like any song.
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.waitForFunction(() => window.__app!.player!.currentTime() > 0.5);
    await page.getByRole("button", { name: "Pause", exact: true }).click();

    // And there is a way back to change it.
    await expect(page.getByRole("link", { name: "Edit in Studio" })).toHaveAttribute("href", `#/studio/${id}`);

    // The Library lists the song under My songs.
    await page.getByRole("link", { name: "← Library" }).click();
    const mine = page.getByRole("region", { name: "My songs" });
    await expect(mine.getByRole("link", { name: "Edit Twinkle" })).toBeVisible();
    await expect(mine.locator(".project-card")).toContainText("8 bars");
    expect(problems).toEqual([]);
  });
}
