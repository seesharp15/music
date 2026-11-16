import { expect, test, type Page } from "@playwright/test";
import { needsSound } from "./helpers";
import { notesOf, notesOp, pointOf, project, setUi, settled, studioWith, ui, view } from "./studio-helpers";

/**
 * The chord track (Stage 3, S3.5): the gutter, the picker that knows the key, and Write to track.
 */
needsSound();

const BAR = 1920;
const live = (page: Page) => page.getByTestId("studio-live");
const sheet = (page: Page) => page.getByRole("dialog", { name: "Chords" });
const chords = async (page: Page) => (await project(page)).chords.map((c) => [c.symbol, c.tick, c.dur]);
const pick = (page: Page, name: string) => sheet(page).getByRole("button", { name, exact: true }).click();

/** Tap the chord gutter level with a tick. */
async function tapGutter(page: Page, tick: number) {
  const v = await view(page);
  const y = (await pointOf(page, 60, tick)).y;
  const box = (await page.locator("canvas.editor-canvas").boundingBox())!;
  await page.mouse.click(box.x + v.barGutter + v.chordGutter / 2, y - 3);
}

test("a tap on the chord gutter opens the picker at that beat; a tap on a chord sets it, plays it and moves on", async ({
  page,
}) => {
  await studioWith(page);
  await page.getByRole("button", { name: /Tap it in/ }).click();
  await settled(page);
  await tapGutter(page, BAR + 500); // inside beat 2 of bar 2
  await expect(sheet(page)).toBeVisible();
  expect((await ui(page)).chordTick).toBe(BAR + 480);
  await expect(sheet(page).getByRole("status")).toContainText("Bar 2, beat 2");
  await expect(sheet(page).getByRole("status")).toContainText("No chord here yet");

  // The seven chords of C major, each with its Roman numeral.
  const diatonic = sheet(page).getByRole("group", { name: "Chords of C major" }).getByRole("button");
  await expect(diatonic).toHaveText(["CI", "Dmii", "Emiii", "FIV", "GV", "Amvi", "Bdimvii°"]);
  // And the usual visitors.
  const visitors = sheet(page).getByRole("group", { name: "Borrowed and visiting chords" }).getByRole("button");
  await expect(visitors.first()).toHaveText("BbbVII");

  // Hear it: the chord is played on the Chords track as it is set.
  await page.evaluate(() => {
    const engine = window.__app!.session!.playback.engine;
    const heard: number[] = [];
    const noteOn = engine.noteOn.bind(engine);
    engine.noteOn = (pitch, velocity, ch, when) => {
      heard.push(pitch);
      noteOn(pitch, velocity, ch, when);
    };
    (window as unknown as { heard: number[] }).heard = heard;
  });
  await sheet(page).getByRole("button", { name: "Half a bar" }).click();
  await pick(page, "Am, vi");
  expect(await chords(page)).toEqual([["Am", BAR + 480, 960]]);
  expect(await page.evaluate(() => (window as unknown as { heard: number[] }).heard)).toEqual([57, 60, 64]);
  await expect(live(page)).toHaveText("Am at bar 2, beat 2");
  // The picker has moved on by half a bar, and the editor has followed it.
  expect(await ui(page)).toMatchObject({ chordTick: BAR + 480 + 960, cursor: BAR + 480 + 960 });
  await expect(page.getByRole("button", { name: "Undo set chord Am" })).toBeVisible();
});

test("chords give way to one another, and Remove clears the one under the picker", async ({ page }) => {
  await studioWith(page);
  await setUi(page, { started: true });
  await page.getByRole("button", { name: "Chords", exact: true }).click();
  for (const c of ["C, I", "F, IV", "G, V"]) await pick(page, c);
  expect(await chords(page)).toEqual([
    ["C", 0, BAR],
    ["F", BAR, BAR],
    ["G", 2 * BAR, BAR],
  ]);

  // Back two bars, and put a one-beat chord in the middle of F: F is cut and keeps its tail.
  await sheet(page).getByRole("button", { name: "Back a bar" }).click();
  await sheet(page).getByRole("button", { name: "Back a bar" }).click();
  await expect(sheet(page).getByRole("status")).toContainText("F is here");
  await sheet(page).getByRole("button", { name: "A beat" }).click();
  await sheet(page).getByRole("button", { name: "On a beat" }).click();
  await pick(page, "Dm, ii");
  expect(await chords(page)).toEqual([
    ["C", 0, BAR],
    ["F", BAR, 480],
    ["Dm", BAR + 480, 480],
    ["F", BAR + 960, 960],
    ["G", 2 * BAR, BAR],
  ]);

  await sheet(page).getByRole("button", { name: "Back a beat" }).click();
  await sheet(page).getByRole("button", { name: "Remove" }).click();
  expect((await chords(page)).map((c) => c[0])).toEqual(["C", "F", "F", "G"]);
  await expect(live(page)).toHaveText("Removed Dm");
});

test("More chords: any root, any kind, any bass — a slash chord, an altered dominant", async ({ page }) => {
  await studioWith(page);
  await setUi(page, { started: true });
  await page.getByRole("button", { name: "Chords", exact: true }).click();
  await sheet(page)
    .getByRole("button", { name: /More chords/ })
    .click();
  const any = sheet(page).getByRole("group", { name: "Any chord" });
  await any.getByLabel("Root", { exact: true }).selectOption({ label: "F" });
  await any.getByLabel("Bass note").selectOption({ label: "A" });
  await any.getByRole("button", { name: "Set F/A" }).click();
  await any.getByLabel("Root", { exact: true }).selectOption({ label: "G" });
  await any.getByLabel("Kind").selectOption({ label: "7b9" });
  await any.getByLabel("Bass note").selectOption({ label: "The root" });
  await any.getByRole("button", { name: "Set G7b9" }).click();
  expect(await chords(page)).toEqual([
    ["F/A", 0, BAR],
    ["G7b9", BAR, BAR],
  ]);
});

test("with no key set, the picker offers any chord, and Detect key once there are enough notes", async ({ page }) => {
  // An F major tune, and no key.
  await studioWith(page, [
    notesOp([65, 67, 69, 70, 72, 70, 69, 67, 65, 60, 65, 69, 72, 65]),
    { op: "patchSong", patch: { key: [] } },
  ]);
  await page.getByRole("button", { name: "Chords", exact: true }).click();
  await expect(sheet(page).getByText("This song has no key set")).toBeVisible();
  await expect(sheet(page).getByRole("group", { name: /^Chords of/ })).toHaveCount(0);
  await expect(sheet(page).getByRole("group", { name: "Any chord" })).toBeVisible();

  await sheet(page).getByRole("button", { name: "Detect key" }).click();
  await expect(live(page)).toHaveText("Key set to F major");
  expect((await project(page)).key).toEqual([{ tick: 0, tonic: "F", mode: "major" }]);
  await expect(sheet(page).getByRole("group", { name: "Chords of F major" }).getByRole("button").first()).toHaveText(
    "FI",
  );
});

test.describe("Write to track", () => {
  async function fiveChords(page: Page) {
    await studioWith(page);
    await page.getByRole("button", { name: /Start with chords/ }).click();
    for (const c of ["C, I", "F, IV", "C, I", "G, V", "C, I"]) await pick(page, c);
  }

  test("turns the chord symbols into block chords on the Chords track, in one undo step", async ({ page }) => {
    await fiveChords(page);
    await sheet(page).getByRole("button", { name: "Write to track" }).click();
    await expect(live(page)).toHaveText("Wrote 5 chords to the track");
    const notes = await notesOf(page, "chords");
    expect(notes).toHaveLength(15);
    expect(notes.slice(0, 6).map((n) => [n.pitch, n.tick, n.dur])).toEqual([
      [48, 0, BAR],
      [52, 0, BAR],
      [55, 0, BAR],
      [48, BAR, BAR],
      [53, BAR, BAR],
      [57, BAR, BAR],
    ]);
    // A mechanical tool: the notes count as the author's own.
    expect(notes.every((n) => n.origin === "manual")).toBe(true);
    await page.getByRole("button", { name: "Undo write chords to track" }).click();
    expect(await notesOf(page, "chords")).toEqual([]);
  });

  test("struck every beat instead: written again, the old notes are replaced, not added to", async ({ page }) => {
    await fiveChords(page);
    await sheet(page).getByRole("button", { name: "Write to track" }).click();
    await sheet(page).getByLabel("How the chords are struck").selectOption({ label: "Every beat" });
    await sheet(page).getByRole("button", { name: "Write to track" }).click();
    const notes = await notesOf(page, "chords");
    expect(notes).toHaveLength(60);
    expect(notes.every((n) => n.dur === 480)).toBe(true);
  });

  // ── Acceptance criterion 7 ──
  test("changing a chord under untouched notes rewrites them; under notes the author has edited, it leaves them alone", async ({
    page,
  }) => {
    await fiveChords(page);
    await sheet(page).getByRole("button", { name: "Write to track" }).click();
    const before = await notesOf(page, "chords");

    // Bar 2 (F): untouched. The picker offers to rewrite its notes, and does.
    await setUi(page, { chordTick: BAR, cursor: BAR });
    await expect(sheet(page).getByRole("status")).toContainText("F is here");
    const offer = sheet(page).getByRole("checkbox", { name: /Rewrite this chord’s notes/ });
    await expect(offer).toBeChecked();
    await pick(page, "Dm, ii");
    await expect(live(page)).toHaveText("Dm at bar 2, beat 1; its notes rewritten");
    let notes = await notesOf(page, "chords");
    const bar2 = notes.filter((n) => n.tick === BAR);
    expect(bar2.map((n) => n.pitch % 12).sort((a, b) => a - b)).toEqual([2, 5, 9]);
    expect(notes.filter((n) => n.tick !== BAR).map((n) => [n.pitch, n.tick])).toEqual(
      before.filter((n) => n.tick !== BAR).map((n) => [n.pitch, n.tick]),
    );
    // One undo takes back the chord and its notes together.
    await page.getByRole("button", { name: "Undo set chord Dm" }).click();
    expect(await notesOf(page, "chords")).toEqual(before);
    expect((await chords(page))[1][0]).toBe("F");

    // Bar 4 (G): the author moves one of its notes up a semitone. Changing the chord then leaves
    // the notes be. (Up an octave would only have been another inversion of G.)
    const g = before.find((n) => n.tick === 3 * BAR)!;
    await page.evaluate(
      (id) =>
        window.__app!.store!.apply(
          [{ op: "shiftNotes", trackId: "chords", ids: [id], ticks: 0, semitones: 1 }],
          "Move",
        ),
      g.id,
    );
    const edited = await notesOf(page, "chords");
    await setUi(page, { chordTick: 3 * BAR, cursor: 3 * BAR });
    await expect(sheet(page).getByRole("status")).toContainText("G is here");
    await expect(offer).toHaveCount(0);
    await pick(page, "Em, iii");
    await expect(live(page)).toHaveText("Em at bar 4, beat 1");
    expect((await chords(page))[3][0]).toBe("Em");
    notes = await notesOf(page, "chords");
    expect(notes).toEqual(edited);
  });

  test("the offer to rewrite can be declined", async ({ page }) => {
    await fiveChords(page);
    await sheet(page).getByRole("button", { name: "Write to track" }).click();
    const before = await notesOf(page, "chords");
    await setUi(page, { chordTick: 0, cursor: 0 });
    await sheet(page)
      .getByRole("checkbox", { name: /Rewrite this chord’s notes/ })
      .uncheck();
    await pick(page, "Am, vi");
    expect((await chords(page))[0][0]).toBe("Am");
    expect(await notesOf(page, "chords")).toEqual(before);
  });
});

test("the picker works from the keyboard alone and fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await studioWith(page);
  await setUi(page, { started: true });
  await page.getByRole("button", { name: "Chords", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(sheet(page)).toBeVisible();
  await sheet(page).getByRole("button", { name: "G, V", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  expect((await chords(page)).map((c) => c[0])).toEqual(["G", "G"]);
  // Space on a focused button presses it; it does not start playback.
  await page.keyboard.press(" ");
  expect((await ui(page)).playing).toBe(false);
  expect(await chords(page)).toHaveLength(3);

  for (const name of ["C, I", "Remove", "A bar", "Write to track", "Back a bar"]) {
    const box = (await sheet(page).getByRole("button", { name, exact: true }).boundingBox())!;
    expect(Math.min(box.width, box.height), name).toBeGreaterThanOrEqual(44);
  }
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
