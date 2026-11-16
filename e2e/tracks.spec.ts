import { expect, test, type Page } from "@playwright/test";
import { needsSound } from "./helpers";
import {
  notesOf,
  notesOp,
  openProject,
  pixelAt,
  pointOf,
  project,
  setUi,
  settled,
  studioWith,
  ui,
} from "./studio-helpers";

/**
 * Tracks, the mixer, song settings and the transport (Stage 3, S3.7).
 */
needsSound();

const BAR = 1920;
const live = (page: Page) => page.getByTestId("studio-live");
const TUNE = [
  notesOp([60, 62, 64, 65]),
  notesOp([48, 55], { trackId: "chords", step: BAR }),
  notesOp([36], { trackId: "bass", dur: BAR }),
];
const compiled = (page: Page) =>
  page.evaluate(async () => (await window.__app!.kit()).compileProject(window.__app!.store!.getState().project));
const player = (page: Page) => page.evaluate(() => window.__app!.session!.playback.player.state);

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  const sheet = (page: Page) => page.getByRole("dialog", { name: "Tracks and mixer" });
  const open = async (page: Page) => {
    await page.getByRole("button", { name: "Tracks and mixer" }).click();
    await expect(sheet(page)).toBeVisible();
  };

  test("each track has a name, what it is for, a sound and a hand; changing them changes what is practised", async ({
    page,
  }) => {
    await studioWith(page, TUNE);
    await open(page);
    const name = sheet(page).getByRole("textbox", { name: "Name of track 3" });
    await expect(name).toHaveValue("Bass");
    await name.fill("Left-hand line");
    await name.press("Enter");
    await sheet(page).getByLabel("What Left-hand line is for").selectOption({ label: "Counter-melody" });
    await sheet(page).getByLabel("Sound of Left-hand line").selectOption({ label: "Electric piano" });
    await sheet(page)
      .getByRole("group", { name: "Hand that practises Left-hand line" })
      .getByRole("button", { name: "Right" })
      .click();
    await expect(live(page)).toHaveText("Left-hand line: right hand");

    const bass = (await project(page)).tracks[2];
    expect(bass).toMatchObject({ name: "Left-hand line", role: "counter", sound: "epiano", hand: "R" });
    const song = await compiled(page);
    expect(song.notes.find((n) => n.track === "bass")!.hand).toBe("R");
    expect(song.tracks!.find((t) => t.id === "bass")).toMatchObject({ name: "Left-hand line", sound: "epiano" });
    await expect(page.getByRole("tab", { name: "Left-hand line" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo change hand" })).toBeVisible();
  });

  test("volume is heard as the slider moves and is one undo step; mute takes the track out of what plays", async ({
    page,
  }) => {
    await studioWith(page, TUNE);
    await open(page);
    const slider = sheet(page).getByRole("slider", { name: "Chords volume" });
    await slider.focus();
    await page.keyboard.down("ArrowLeft");
    for (let i = 0; i < 9; i++) await page.keyboard.down("ArrowLeft"); // held: the key repeats
    // Heard already, before the key is let go and the change is written.
    expect((await player(page)).trackMix.chords.volume).toBeCloseTo(0.7, 5);
    await page.keyboard.up("ArrowLeft");
    expect((await project(page)).tracks[1].volume).toBeCloseTo(0.7, 5);
    await page.getByRole("button", { name: "Undo change volume" }).click();
    expect((await project(page)).tracks[1].volume).toBe(0.8);
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();

    await sheet(page).getByRole("button", { name: "Mute Chords" }).click();
    expect((await project(page)).tracks[1].muted).toBe(true);
    expect((await compiled(page)).notes.some((n) => n.track === "chords")).toBe(false);
    await expect(page.getByRole("tab", { name: "Chords" })).toHaveClass(/is-muted/);
  });

  test("solo is heard alone; a locked track refuses edits; a hidden one is neither drawn nor taken hold of", async ({
    page,
  }) => {
    await studioWith(page, TUNE);
    await settled(page);
    await open(page);
    await sheet(page).getByRole("button", { name: "Solo Bass" }).click();
    expect((await player(page)).solo).toBe("bass");
    await sheet(page).getByRole("button", { name: "Solo Bass" }).click();
    expect((await player(page)).solo).toBeNull();

    await sheet(page).getByRole("button", { name: "Lock Melody" }).click();
    await expect(live(page)).toHaveText("Melody locked");
    await page.getByRole("button", { name: "Close tracks and mixer" }).click();
    await setUi(page, { tool: "draw" });
    const at = await pointOf(page, 72, 600);
    await page.mouse.click(at.x, at.y);
    await expect(live(page)).toHaveText("Not done: that track is locked.");
    expect(await notesOf(page)).toHaveLength(4);
    await setUi(page, { tool: "select" });

    await open(page);
    await sheet(page).getByRole("button", { name: "Lock Melody" }).click();
    await sheet(page).getByRole("button", { name: "Hide Melody" }).click();
    await page.getByRole("button", { name: "Close tracks and mixer" }).click();
    await settled(page);
    const c = await pointOf(page, 60, 240);
    expect(Math.max(...(await pixelAt(page, c)))).toBeLessThan(60); // nothing drawn where C4 was
    await page.mouse.click(c.x, c.y);
    expect((await ui(page)).selection).toEqual([]);
    // Hidden, not muted: it still plays.
    expect((await compiled(page)).notes.filter((n) => n.track === "melody")).toHaveLength(4);
  });

  test("tracks are added, moved and deleted; deleting one with notes asks first", async ({ page }) => {
    await studioWith(page, TUNE);
    await open(page);
    await sheet(page).getByRole("button", { name: "Add a track" }).click();
    let p = await project(page);
    expect(p.tracks.map((t) => t.name)).toEqual(["Melody", "Chords", "Bass", "Drums", "Track 5"]);
    expect((await ui(page)).activeTrack).toBe("track1");

    await sheet(page).getByRole("button", { name: "Move Track 5 up" }).click();
    await sheet(page).getByRole("button", { name: "Move Bass up" }).click();
    p = await project(page);
    expect(p.tracks.map((t) => t.name)).toEqual(["Melody", "Bass", "Chords", "Track 5", "Drums"]);
    // Moving a track moves nothing in it.
    expect((await notesOf(page, "bass")).map((n) => [n.pitch, n.tick, n.dur])).toEqual([[36, 0, BAR]]);

    // An empty track goes at once; one with notes asks.
    await sheet(page).getByRole("button", { name: "Delete Track 5" }).click();
    expect((await project(page)).tracks).toHaveLength(4);
    await sheet(page).getByRole("button", { name: "Delete Chords" }).click();
    await page.getByRole("dialog", { name: "Delete “Chords”?" }).getByRole("button", { name: "Cancel" }).click();
    expect((await project(page)).tracks).toHaveLength(4);
    await sheet(page).getByRole("button", { name: "Delete Chords" }).click();
    await page
      .getByRole("dialog", { name: "Delete “Chords”?" })
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    expect((await project(page)).tracks.map((t) => t.name)).toEqual(["Melody", "Bass", "Drums"]);
    await page.getByRole("button", { name: "Undo delete track Chords" }).click();
    expect((await notesOf(page, "chords")).length).toBe(2);
  });

  test("hidden tracks, the metronome and the count-in are remembered for the song", async ({ page }) => {
    await studioWith(page, TUNE);
    await setUi(page, { hiddenTracks: ["bass"], metronome: true, countIn: false });
    await page.waitForTimeout(600);
    await openProject(page, "tune");
    expect(await ui(page)).toMatchObject({ hiddenTracks: ["bass"], metronome: true, countIn: false });
    expect((await player(page)).metronome).toBe(true);
  });
});

test("on a wide screen, tracks and sections stay open in a column beside the editor", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await studioWith(page, TUNE);
  const column = page.getByRole("complementary", { name: "Tracks and sections" });
  await expect(column.getByRole("heading", { name: "Tracks" })).toBeVisible();
  await expect(column.getByRole("heading", { name: "Sections" })).toBeVisible();
  await expect(column.getByRole("slider", { name: "Melody volume" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tracks and mixer" })).toBeHidden();
  await page.getByRole("button", { name: "Song menu" }).click();
  await expect(page.getByRole("menuitem", { name: "Sections" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  // The editor is beside it, not under it.
  const canvas = (await page.locator("canvas.editor-canvas").boundingBox())!;
  const side = (await column.boundingBox())!;
  expect(canvas.x).toBeGreaterThanOrEqual(side.x + side.width - 1);
  await column.getByRole("button", { name: "Add at the end" }).click();
  expect((await project(page)).sections).toHaveLength(1);
});

test.describe("song settings", () => {
  const sheet = (page: Page) => page.getByRole("dialog", { name: "Song settings" });
  const open = async (page: Page) => {
    await page.getByRole("button", { name: /song settings$/ }).click();
    await expect(sheet(page)).toBeVisible();
  };

  test("tempo can be typed, nudged or tapped; tapping is one undo step once the taps stop", async ({ page }) => {
    await studioWith(page, TUNE);
    await open(page);
    const tempo = sheet(page).getByRole("textbox", { name: "Tempo" });
    await tempo.fill("84");
    await tempo.press("Enter");
    expect((await project(page)).tempo).toEqual([{ tick: 0, bpm: 84 }]);
    await sheet(page).getByRole("button", { name: "Faster" }).click();
    await sheet(page).getByRole("button", { name: "Faster" }).click();
    await sheet(page).getByRole("button", { name: "Slower" }).click();
    expect((await project(page)).tempo[0].bpm).toBe(85);
    expect((await compiled(page)).bpm).toBe(85);
    // Nonsense is refused and the field shows what is really there.
    await tempo.fill("fast");
    await tempo.press("Enter");
    await expect(tempo).toHaveValue("85");

    // Four taps half a second apart: 120.
    const before = await page.evaluate(() => window.__app!.store!.getState().undoLabel);
    await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Tap tempo")!;
      const t0 = performance.now();
      for (let i = 0; i < 4; i++) {
        const e = new PointerEvent("pointerdown", { bubbles: true });
        Object.defineProperty(e, "timeStamp", { value: t0 + i * 500 });
        button.dispatchEvent(e);
      }
    });
    await expect(sheet(page).getByRole("button", { name: "Tap · 120" })).toBeVisible();
    expect((await project(page)).tempo[0].bpm).toBe(85); // not until the taps stop
    await expect.poll(async () => (await project(page)).tempo[0].bpm, { timeout: 3000 }).toBe(120);
    await expect(live(page)).toHaveText("Tempo 120");
    expect(before).toBe("Set tempo");
    await page.getByRole("button", { name: "Undo set tempo" }).click();
    expect((await project(page)).tempo[0].bpm).toBe(85);
  });

  test("time signature, key, swing, snap and length", async ({ page }) => {
    await studioWith(page, [notesOp([65, 67, 69, 70, 72, 70, 69, 67, 65, 60, 65, 69], { step: 240 })]);
    await open(page);

    await sheet(page).getByLabel("Time signature").selectOption("3/4");
    expect((await project(page)).meter).toEqual([{ tick: 0, numerator: 3, denominator: 4 }]);
    expect((await compiled(page)).timeSignature).toEqual([3, 4]);
    // The song is now counted in bars of three: the fourth beat is the start of bar 2.
    await setUi(page, { cursor: 1440 });
    await expect(page.locator("canvas.editor-canvas")).toHaveAttribute("aria-label", /Cursor at bar 2, beat 1/);
    await sheet(page).getByLabel("Time signature").selectOption("4/4");

    await sheet(page).getByLabel("Key note").selectOption({ label: "Eb" });
    await sheet(page).getByLabel("Mode").selectOption({ label: "minor" });
    expect((await project(page)).key).toEqual([{ tick: 0, tonic: "Eb", mode: "minor" }]);
    await sheet(page).getByLabel("Key note").selectOption({ label: "None" });
    expect((await project(page)).key).toEqual([]);
    await expect(sheet(page).getByLabel("Mode")).toBeDisabled();
    await sheet(page).getByRole("button", { name: "Detect from my notes" }).click();
    await expect(live(page)).toHaveText("Key: F major");
    expect((await project(page)).key).toEqual([{ tick: 0, tonic: "F", mode: "major" }]);

    // Swing: the off-beat eighths are played late; it is one undo step for the whole drag.
    const straight = (await compiled(page)).notes.map((n) => n.time);
    const swing = sheet(page).getByRole("slider", { name: "Swing" });
    await swing.focus();
    for (let i = 0; i < 17; i++) await page.keyboard.press("ArrowRight");
    expect((await project(page)).swing.amount).toBeCloseTo(0.67, 5);
    const swung = (await compiled(page)).notes.map((n) => n.time);
    expect(swung[0]).toBe(straight[0]);
    expect(swung[1]).toBeGreaterThan(straight[1] + 0.05);
    expect(swung[2]).toBeCloseTo(straight[2], 6);
    await sheet(page).getByLabel("Which notes swing").selectOption({ label: "Sixteenths" });
    expect((await project(page)).swing.unit).toBe(16);

    await sheet(page).getByLabel("Snap to").selectOption({ label: "Eighth triplets" });
    expect((await ui(page)).snap).toBe("8t");

    const length = sheet(page).getByRole("textbox", { name: "Length in bars" });
    await expect(length).toHaveValue("8");
    await length.fill("12");
    await length.press("Enter");
    expect((await project(page)).lengthTicks).toBe(12 * BAR);
    // It cannot be made shorter than its last note: one bar is asked for, the notes need a bar and a half.
    await length.fill("1");
    await length.press("Enter");
    expect((await project(page)).lengthTicks).toBe(12 * 240);
  });
});

test.describe("the transport", () => {
  test("Loop takes the selection, or the section under the cursor, or four bars; and lets go again", async ({
    page,
  }) => {
    await studioWith(page, [
      ...TUNE,
      { op: "setSections", sections: [{ id: "v", name: "Verse", tick: 2 * BAR, dur: 2 * BAR }] },
    ]);
    const loop = page.getByRole("button", { name: "Loop", exact: true });

    await loop.click();
    await expect(live(page)).toHaveText("Looping bars 1 to 4");
    expect((await ui(page)).loop).toEqual({ start: 0, end: 4 * BAR });
    await expect(loop).toHaveAttribute("aria-pressed", "true");
    await loop.click();
    expect((await ui(page)).loop).toBeNull();

    await setUi(page, { cursor: 2 * BAR + 480 });
    await loop.click();
    await expect(live(page)).toHaveText("Looping Verse");
    expect((await ui(page)).loop).toEqual({ start: 2 * BAR, end: 4 * BAR });
    await loop.click();

    // Two notes in bar 1 selected: the loop is the whole of that bar.
    const notes = await notesOf(page);
    await setUi(page, { selection: [notes[1].id, notes[2].id] });
    await loop.click();
    await expect(live(page)).toHaveText("Looping the selection");
    expect((await ui(page)).loop).toEqual({ start: 0, end: BAR });
    expect((await player(page)).loop).toMatchObject({ enabled: true, start: 0 });
  });

  test("Space and the Play button play from the cursor; the metronome clicks on the beat", async ({ page }) => {
    await studioWith(page, TUNE);
    await setUi(page, { cursor: 960 });
    await settled(page);
    // Record what the player asks for, as well as letting it sound.
    await page.evaluate(async () => {
      const { recordSink } = await window.__app!.testing();
      const recording = recordSink(window.__app!.session!.playback.player);
      (window as unknown as { rec: typeof recording }).rec = recording;
    });
    await page.getByRole("button", { name: /^Tempo/ }).click();
    await page.getByRole("checkbox", { name: "Metronome" }).check();
    await page.keyboard.press("Escape");
    // Space is "play" wherever focus is, except on a button, which it presses instead.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press(" ");
    await expect.poll(async () => (await ui(page)).playing).toBe(true);
    await page.waitForFunction(() => window.__app!.session!.playback.tick() > 960 + 1600);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    const calls = await page.evaluate(
      () =>
        (window as unknown as { rec: { calls: { kind: string; when: number; pitch?: number; accent?: boolean }[] } })
          .rec.calls,
    );
    const notes = calls.filter((c) => c.kind === "note");
    const clicks = calls.filter((c) => c.kind === "click");
    // From the cursor: the first note asked for is the one at beat 3 (E), not the C at the start.
    expect(notes[0].pitch).toBe(64);
    // 100 BPM: a click every 0.6 s, the first of them with the first note.
    expect(clicks.length).toBeGreaterThanOrEqual(3);
    expect(Math.abs(clicks[0].when - notes[0].when)).toBeLessThan(0.02);
    // (Whatever falls exactly where playback starts is asked for a moment late — Stage 0's build
    // notes — so the spacing is measured between the clicks after it.)
    expect(clicks[2].when - clicks[1].when).toBeCloseTo(0.6, 3);
    expect(clicks[1].when - clicks[0].when).toBeGreaterThan(0.5);
    expect(clicks[1].when - clicks[0].when).toBeLessThan(0.61);
    // Beat 3, beat 4, then the downbeat of bar 2 is the accented one.
    expect(clicks.slice(0, 3).map((c) => c.accent)).toEqual([false, false, true]);
    await settled(page);
    expect((await ui(page)).cursor).toBe(960);
  });

  test("the tool row fits a phone without scrolling, every button a full touch target", async ({ page }) => {
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 800 });
      await studioWith(page, TUNE);
      for (const name of ["Select", "Draw", "Erase", "Chords", "Record", "Play from the cursor", "Loop"]) {
        const box = (await page.getByRole("button", { name, exact: true }).boundingBox())!;
        expect(Math.round(Math.min(box.width, box.height)), `${name} at ${width}`).toBeGreaterThanOrEqual(
          width >= 390 ? 44 : 40,
        );
        expect(box.x + box.width, `${name} at ${width}`).toBeLessThanOrEqual(width);
      }
      const tempo = (await page.getByRole("button", { name: /^Tempo/ }).boundingBox())!;
      expect(tempo.x + tempo.width).toBeLessThanOrEqual(width);
      expect(tempo.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(
        0,
      );
    }
  });
});
