import { expect, test, type Page } from "@playwright/test";
import type { EditOp, Project } from "../src/project/types";
import { needsSound } from "./helpers";
import { project, setUi, settled, studioWith, ui } from "./studio-helpers";

/**
 * Sections and arrangement (Stage 3, S3.6): the Sections sheet, and the music moving with its
 * section when one is duplicated, moved or deleted.
 */
needsSound();
// A phone: the sections are a sheet opened from the song menu. (On a wide screen they stay open in
// a column beside the editor; e2e/tracks.spec.ts covers that.)
test.use({ viewport: { width: 390, height: 844 } });

const BAR = 1920;
const Q = 480;
const live = (page: Page) => page.getByTestId("studio-live");
const sheet = (page: Page) => page.getByRole("dialog", { name: "Sections" });
const names = async (page: Page) => (await project(page)).sections.map((s) => [s.name, s.tick / BAR, s.dur / BAR]);

/** Three note tracks and a drum clip: a four-bar Verse, a four-bar Chorus, and a note after them. */
const quarter = (pitch: number, tick: number, dur = Q) => ({ pitch, tick, dur, vel: 0.7, origin: "manual" as const });
const SONG: EditOp[] = [
  { op: "patchSong", patch: { lengthTicks: 12 * BAR } },
  { op: "addNotes", trackId: "melody", notes: [60, 62, 64, 65, 67, 69, 71, 72].map((p, i) => quarter(p, i * 2 * Q)) },
  { op: "addNotes", trackId: "melody", notes: [76, 74, 72, 71].map((p, i) => quarter(p, 4 * BAR + i * BAR, BAR)) },
  { op: "addNotes", trackId: "melody", notes: [quarter(84, 8 * BAR)] },
  { op: "addNotes", trackId: "chords", notes: [48, 52, 55].map((p) => quarter(p, 0, 4 * BAR)) },
  { op: "addNotes", trackId: "chords", notes: [53, 57, 60].map((p) => quarter(p, 4 * BAR, 4 * BAR)) },
  { op: "addNotes", trackId: "bass", notes: [36, 36, 43, 36].map((p, i) => quarter(p, i * BAR, BAR)) },
  { op: "addNotes", trackId: "bass", notes: [41, 41, 43, 43].map((p, i) => quarter(p, 4 * BAR + i * BAR, BAR)) },
  {
    op: "setChords",
    range: { start: 0, end: 8 * BAR },
    chords: [
      { tick: 0, dur: 4 * BAR, symbol: "C", origin: "manual" },
      { tick: 4 * BAR, dur: 2 * BAR, symbol: "F", origin: "manual" },
      { tick: 6 * BAR, dur: 2 * BAR, symbol: "G", origin: "manual" },
    ],
  },
  {
    op: "putPattern",
    trackId: "drums",
    pattern: {
      id: "beat",
      name: "Beat",
      stepsPerBar: 16,
      bars: 1,
      lanes: { kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0] },
    },
  },
  { op: "placeClip", trackId: "drums", patternId: "beat", tick: 0, repeats: 4 },
  {
    op: "setSections",
    sections: [
      { id: "verse", name: "Verse", tick: 0, dur: 4 * BAR },
      { id: "chorus", name: "Chorus", tick: 4 * BAR, dur: 4 * BAR },
    ],
  },
];

/** Everything that starts in a range, counted from its start, without ids. */
function contents(p: Project, start: number, end: number) {
  const inside = (x: { tick: number }) => x.tick >= start && x.tick < end;
  const at = <T extends { tick: number }>(x: T) => ({ ...x, tick: x.tick - start, id: undefined });
  return {
    tracks: p.tracks.map((t) =>
      t.kind === "notes"
        ? t.notes.filter(inside).map(at)
        : { clips: t.clips.filter(inside).map(at), hits: t.hits.filter(inside).map(at) },
    ),
    chords: p.chords.filter(inside).map(at),
  };
}

async function openSections(page: Page) {
  await page.getByRole("button", { name: "Song menu" }).click();
  await page.getByRole("menuitem", { name: "Sections" }).click();
  await expect(sheet(page)).toBeVisible();
}

// ── Acceptance criterion 6 ──
test("duplicating a four-bar section gives eight bars whose second half equals the first on every track; one undo restores it", async ({
  page,
}) => {
  await studioWith(page, SONG);
  await openSections(page);
  const before = await project(page);
  await sheet(page).getByRole("button", { name: "Duplicate Verse" }).click();
  await expect(live(page)).toHaveText("Verse duplicated");

  const after = await project(page);
  expect(contents(after, 4 * BAR, 8 * BAR)).toEqual(contents(after, 0, 4 * BAR));
  expect(contents(after, 0, 4 * BAR)).toEqual(contents(before, 0, 4 * BAR));
  // Three note tracks and the drum clip are all in each half.
  const half = contents(after, 4 * BAR, 8 * BAR);
  expect(half.tracks.map((t) => (Array.isArray(t) ? t.length : t.clips.length))).toEqual([8, 3, 4, 1]);
  expect(half.chords).toHaveLength(1);
  expect(contents(after, 8 * BAR, 12 * BAR)).toEqual(contents(before, 4 * BAR, 8 * BAR));
  expect(await names(page)).toEqual([
    ["Verse", 0, 4],
    ["Verse", 4, 4],
    ["Chorus", 8, 4],
  ]);

  await page.getByRole("button", { name: "Undo duplicate Verse" }).click();
  expect(await project(page)).toEqual(before);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("moving a section moves its notes, chords and clips together; one undo restores the original", async ({
  page,
}) => {
  await studioWith(page, SONG);
  await openSections(page);
  const before = await project(page);
  await expect(sheet(page).getByRole("button", { name: "Move Verse earlier" })).toBeDisabled();
  await expect(sheet(page).getByRole("button", { name: "Move Chorus later" })).toBeDisabled();

  await sheet(page).getByRole("button", { name: "Move Chorus earlier" }).click();
  await expect(live(page)).toHaveText("Chorus moved earlier");
  const after = await project(page);
  expect(contents(after, 0, 4 * BAR)).toEqual(contents(before, 4 * BAR, 8 * BAR));
  expect(contents(after, 4 * BAR, 8 * BAR)).toEqual(contents(before, 0, 4 * BAR));
  expect(contents(after, 8 * BAR, 12 * BAR)).toEqual(contents(before, 8 * BAR, 12 * BAR));
  expect(after.chords.map((c) => [c.symbol, c.tick / BAR])).toEqual([
    ["F", 0],
    ["G", 2],
    ["C", 4],
  ]);
  // The drum clip went with the verse.
  const drums = after.tracks.find((t) => t.kind === "drums")!;
  expect(drums.kind === "drums" && drums.clips.map((c) => c.tick / BAR)).toEqual([4]);
  expect(await names(page)).toEqual([
    ["Chorus", 0, 4],
    ["Verse", 4, 4],
  ]);
  expect(after.lengthTicks).toBe(before.lengthTicks);

  await page.getByRole("button", { name: "Undo move Chorus earlier" }).click();
  expect(await project(page)).toEqual(before);
});

test("sections are added at the end or at the cursor, renamed, recoloured and resized", async ({ page }) => {
  await studioWith(page);
  await setUi(page, { started: true });
  await openSections(page);
  await expect(sheet(page).getByText(/No sections yet/)).toBeVisible();
  await sheet(page).getByRole("button", { name: "Add at the end" }).click();
  await sheet(page).getByRole("button", { name: "Add at the end" }).click();
  expect(await names(page)).toEqual([
    ["Intro", 0, 4],
    ["Verse", 4, 4],
  ]);
  await setUi(page, { cursor: 10 * BAR + 300 });
  await sheet(page).getByRole("button", { name: "Add at the cursor" }).click();
  expect((await names(page))[2]).toEqual(["Chorus", 10, 4]);
  // The song has grown to hold it.
  expect((await project(page)).lengthTicks).toBe(14 * BAR);

  const name = sheet(page).getByRole("combobox", { name: "Name of section 2" });
  await name.fill("Verse 1");
  await name.press("Enter");
  await sheet(page).getByRole("textbox", { name: "Bars in Verse 1" }).fill("6");
  await sheet(page).getByRole("textbox", { name: "Bars in Verse 1" }).press("Enter");
  expect((await names(page))[1]).toEqual(["Verse 1", 4, 6]);
  const colour = (await project(page)).sections[0].color;
  await sheet(page).getByRole("button", { name: "Colour of Intro: change" }).click();
  expect((await project(page)).sections[0].color).not.toBe(colour);
  await expect(page.getByRole("button", { name: "Undo recolour section" })).toBeVisible();
});

test("deleting asks how: close the gap, keep the bars empty, or remove just the name", async ({ page }) => {
  await studioWith(page, SONG);
  await openSections(page);
  const before = await project(page);
  const choose = async (label: RegExp) => {
    await sheet(page).getByRole("button", { name: "Delete Verse" }).click();
    await page.getByRole("dialog", { name: "Delete “Verse”?" }).getByRole("button", { name: label }).click();
  };

  await choose(/Remove just the name/);
  let after = await project(page);
  expect(after.tracks).toEqual(before.tracks);
  expect(await names(page)).toEqual([["Chorus", 4, 4]]);
  await page.getByRole("button", { name: /^Undo/ }).click();

  await choose(/keep the bars/);
  after = await project(page);
  expect(
    contents(after, 0, 4 * BAR).tracks.every((t) => (Array.isArray(t) ? t.length === 0 : t.clips.length === 0)),
  ).toBe(true);
  expect(contents(after, 4 * BAR, 12 * BAR)).toEqual(contents(before, 4 * BAR, 12 * BAR));
  await page.getByRole("button", { name: /^Undo/ }).click();

  await choose(/close the gap/);
  after = await project(page);
  expect(contents(after, 0, 4 * BAR)).toEqual(contents(before, 4 * BAR, 8 * BAR));
  expect(after.lengthTicks).toBe(before.lengthTicks - 4 * BAR);
  await expect(live(page)).toHaveText("Verse deleted");
  await page.getByRole("button", { name: "Undo delete Verse" }).click();
  expect(await project(page)).toEqual(before);

  // Cancel does nothing.
  await sheet(page).getByRole("button", { name: "Delete Verse" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(await project(page)).toEqual(before);
});

test("a section's Loop button plays it round: the cursor goes to its start and playback wraps at its end", async ({
  page,
}) => {
  await studioWith(page, SONG);
  await openSections(page);
  await sheet(page).getByRole("button", { name: "Loop Chorus" }).click();
  await expect(live(page)).toHaveText("Looping Chorus");
  expect(await ui(page)).toMatchObject({ loop: { start: 4 * BAR, end: 8 * BAR }, cursor: 4 * BAR });
  // 100 BPM: a bar is 2.4 s.
  const loop = await page.evaluate(() => window.__app!.session!.playback.player.state.loop);
  expect(loop.enabled).toBe(true);
  expect(loop.start).toBeCloseTo(9.6, 6);
  expect(loop.end).toBeCloseTo(19.2, 6);

  // Jump near the end and watch it come round.
  await page.getByRole("button", { name: "Play from the cursor" }).click();
  await expect.poll(async () => (await ui(page)).playing).toBe(true);
  const wrappedTo = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const player = window.__app!.session!.playback.player;
        const off = player.onLoopWrap(() => {
          off();
          resolve(player.currentTime());
        });
        player.seek(player.state.loop.end - 0.3);
      }),
  );
  expect(wrappedTo).toBeGreaterThanOrEqual(9.6);
  expect(wrappedTo).toBeLessThan(10.2);
  await page.getByRole("button", { name: "Stop", exact: true }).click();

  await sheet(page).getByRole("button", { name: "Loop Chorus" }).click();
  expect((await ui(page)).loop).toBeNull();
  expect(await page.evaluate(() => window.__app!.session!.playback.player.state.loop.enabled)).toBe(false);
  await settled(page);
});

test("the sheet fits a phone and every control is big enough for a finger", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await studioWith(page, SONG);
  await openSections(page);
  for (const name of [
    "Loop Verse",
    "Move Chorus earlier",
    "Duplicate Verse",
    "Delete Verse",
    "Colour of Verse: change",
    "Add at the end",
  ]) {
    const box = (await sheet(page).getByRole("button", { name }).boundingBox())!;
    // Rounded: measured while the sheet is still sliding up, a 44 px button can read 43.99997.
    expect(Math.round(Math.min(box.width, box.height)), name).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
