import { expect, test, type Page } from "@playwright/test";
import { needsSound } from "./helpers";
import { notesOf, notesOp, pointOf, project, setUi, settled, studioWith, ui, view } from "./studio-helpers";

/**
 * Editing by hand (Stage 3, S3.3): tools, selection, moving, resizing, drawing, erasing, the
 * inspector, the clipboard and the keyboard — with real pointer and key events on the canvas.
 */
needsSound();

// C D E F on the beats of bar 1, then G held for bar 2.
const TUNE = [notesOp([60, 62, 64, 65]), notesOp([67], { start: 1920, dur: 1920 })];

const live = (page: Page) => page.getByTestId("studio-live");
const mid = async (page: Page, pitch: number, tick: number, dur: number) => pointOf(page, pitch, tick + dur / 2);

/** Count calls to `store.apply`, so a test can say an edit was one undo step. */
async function countApplies(page: Page) {
  await page.evaluate(() => {
    const store = window.__app!.store!;
    const w = window as unknown as { applies: string[] };
    w.applies = [];
    const apply = store.apply.bind(store);
    store.apply = (ops, label) => {
      w.applies.push(label);
      apply(ops, label);
    };
  });
  return () => page.evaluate(() => (window as unknown as { applies: string[] }).applies);
}

async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  opts: { alt?: boolean } = {},
) {
  if (opts.alt) await page.keyboard.down("Alt");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  if (opts.alt) await page.keyboard.up("Alt");
}

test.describe("with the mouse", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await studioWith(page, TUNE);
    await settled(page);
  });

  // ── Acceptance criterion 4 ──
  test("dragging a note two keys right and one beat later changes exactly its pitch and tick; one undo restores it", async ({
    page,
  }) => {
    const applies = await countApplies(page);
    const before = await notesOf(page);
    const e = before.find((n) => n.pitch === 64)!;
    const from = await mid(page, 64, e.tick, e.dur);
    const to = await mid(page, 66, e.tick + 480, e.dur);
    await drag(page, from, to);

    const after = await notesOf(page);
    const moved = after.find((n) => n.id === e.id)!;
    expect(moved).toEqual({ ...e, pitch: 66, tick: e.tick + 480 });
    // Every other note is exactly as it was.
    expect(after.filter((n) => n.id !== e.id)).toEqual(before.filter((n) => n.id !== e.id));
    expect(await applies()).toEqual(["Move 1 note"]);
    expect((await ui(page)).selection).toEqual([e.id]);

    await page.getByRole("button", { name: "Undo move 1 note" }).click();
    expect(await notesOf(page)).toEqual(before);
  });

  test("dragging a note's top edge resizes it, by grid steps, as one undo step", async ({ page }) => {
    const applies = await countApplies(page);
    const g = (await notesOf(page)).find((n) => n.pitch === 67)!;
    const v = await view(page);
    const top = await pointOf(page, 67, g.tick + g.dur);
    // Take hold just inside the top edge and pull it down by a beat and a bit.
    await drag(page, { x: top.x, y: top.y + 4 }, { x: top.x, y: top.y + 4 + (480 + 50) / v.ticksPerPx });
    const after = (await notesOf(page)).find((n) => n.id === g.id)!;
    expect(after).toEqual({ ...g, dur: 1920 - 480 });
    expect(await applies()).toEqual(["Resize 1 note"]);
  });

  test("a box across empty space selects what it touches; dragging one of them moves them all", async ({ page }) => {
    const applies = await countApplies(page);
    const a = await pointOf(page, 59, 300);
    const b = await pointOf(page, 63, 1200);
    await drag(page, { x: a.x - 6, y: a.y }, b);
    const notes = await notesOf(page);
    const ids = notes.filter((n) => n.pitch === 60 || n.pitch === 62).map((n) => n.id);
    expect((await ui(page)).selection.sort()).toEqual(ids.sort());
    await expect(live(page)).toHaveText("2 notes selected");
    await expect(page.getByRole("button", { name: "Selection: 2 notes" })).toBeVisible();

    await drag(page, await mid(page, 62, 480, 480), await mid(page, 64, 480, 480));
    const after = await notesOf(page);
    expect(after.filter((n) => ids.includes(n.id)).map((n) => [n.pitch, n.tick])).toEqual([
      [62, 0],
      [64, 480],
    ]);
    expect(await applies()).toEqual(["Move 2 notes"]);

    // A tap on empty space lets go of them.
    const empty = await pointOf(page, 70, 300);
    await page.mouse.click(empty.x, empty.y);
    expect((await ui(page)).selection).toEqual([]);
  });

  test("Alt-drag places a copy and leaves the original", async ({ page }) => {
    const before = await notesOf(page);
    const c = before.find((n) => n.pitch === 60)!;
    await drag(page, await mid(page, 60, 0, 480), await mid(page, 72, 0, 480), { alt: true });
    const after = await notesOf(page);
    expect(after).toHaveLength(before.length + 1);
    expect(after.find((n) => n.id === c.id)).toEqual(c);
    const copy = after.find((n) => n.pitch === 72)!;
    expect(copy).toMatchObject({ tick: 0, dur: 480, origin: "manual" });
    expect((await ui(page)).selection).toEqual([copy.id]);
    await expect(page.getByRole("button", { name: "Undo duplicate 1 note" })).toBeVisible();
  });

  test("the Draw tool writes a note where empty space is tapped, of the chosen length, on the grid", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Draw" }).click();
    expect((await ui(page)).tool).toBe("draw");
    const at = await pointOf(page, 71, 960 + 130); // inside the sixteenth that starts at 1080
    await page.mouse.click(at.x, at.y);
    const added = (await notesOf(page)).find((n) => n.pitch === 71)!;
    expect(added).toMatchObject({ tick: 1080, dur: 480, origin: "manual" });
    await expect(live(page)).toHaveText(/^B4, bar 1, beat 3, tick 120, quarter note$/);
    // Tapping a note with the Draw tool selects it rather than writing another on top.
    const e = await mid(page, 64, 960, 480);
    await page.mouse.click(e.x, e.y);
    expect((await notesOf(page)).filter((n) => n.pitch === 64)).toHaveLength(1);
    expect((await ui(page)).selection).toHaveLength(1);
  });

  test("the Erase tool removes what is tapped, and a sweep removes everything it crosses in one step", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Erase" }).click();
    const applies = await countApplies(page);
    const f = await mid(page, 65, 1440, 480);
    await page.mouse.click(f.x, f.y);
    expect((await notesOf(page)).map((n) => n.pitch)).toEqual([60, 62, 64, 67]);

    await drag(page, await pointOf(page, 59, 100), await pointOf(page, 65, 1400));
    expect((await notesOf(page)).map((n) => n.pitch)).toEqual([67]);
    expect(await applies()).toEqual(["Delete 1 note", "Delete 3 notes"]);
    await page.getByRole("button", { name: "Undo delete 3 notes" }).click();
    expect(await notesOf(page)).toHaveLength(4);
  });

  test("only the active track's notes can be taken hold of, unless every track is being edited", async ({ page }) => {
    await page.getByRole("tab", { name: "Chords" }).click();
    // The keyboard glides to the keys an empty chords track starts with; wait for it to arrive.
    await expect.poll(async () => (await view(page)).keyHi).toBe(30);
    const c = await mid(page, 60, 0, 480);
    await page.mouse.click(c.x, c.y);
    expect((await ui(page)).selection).toEqual([]);

    await page.getByRole("button", { name: "View: zoom and keys" }).click();
    await page.getByRole("checkbox", { name: "Edit all tracks" }).check();
    await page.keyboard.press("Escape");
    await page.mouse.click(c.x, c.y);
    expect((await ui(page)).selection).toHaveLength(1);
  });
});

test.describe("the inspector", () => {
  test("changes pitch, start, length, velocity and hand of the selection, each as one step", async ({ page }) => {
    await studioWith(page, TUNE);
    await settled(page);
    const applies = await countApplies(page);
    const d = (await notesOf(page)).find((n) => n.pitch === 62)!;
    await setUi(page, { selection: [d.id] });
    await page.getByRole("button", { name: "Selection: 1 note" }).click();
    const sheet = page.getByRole("dialog", { name: "Selection" });
    await expect(sheet.getByText("D4, bar 1, beat 2, quarter note, selected")).toBeVisible();

    await sheet.getByRole("button", { name: "Up an octave" }).click();
    await sheet.getByRole("button", { name: "Down a semitone" }).click();
    const start = sheet.getByRole("group", { name: "Start" });
    await start.getByLabel("Beat").fill("4");
    await start.getByLabel("Beat").press("Enter");
    const length = sheet.getByRole("group", { name: "Length" });
    await length.getByLabel("Beats").fill("2");
    await length.getByLabel("Beats").press("Enter");
    await sheet.getByRole("slider", { name: "Velocity" }).focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowLeft");
    await sheet.getByRole("group", { name: "Hand in Practice" }).getByRole("button", { name: "Left" }).click();

    const after = (await notesOf(page)).find((n) => n.id === d.id)!;
    expect(after).toMatchObject({ pitch: 62 + 11, tick: 1440, dur: 960, hand: "L" });
    expect(after.vel).toBeCloseTo(0.65, 2);
    expect(await applies()).toEqual(
      expect.arrayContaining(["Move 1 note", "Change note", "Change velocity", "Give to the left hand"]),
    );

    // Auto hands the note back to its track.
    await sheet.getByRole("group", { name: "Hand in Practice" }).getByRole("button", { name: "Auto" }).click();
    expect((await notesOf(page)).find((n) => n.id === d.id)).not.toHaveProperty("hand");
  });

  test("for several notes: quantize, legato, duplicate, and the clipboard", async ({ page }) => {
    // Three notes a little off the grid, with gaps between them.
    await studioWith(page, [
      {
        op: "addNotes",
        trackId: "melody",
        notes: [
          { pitch: 60, tick: 7, dur: 200, vel: 0.7, origin: "manual" },
          { pitch: 62, tick: 470, dur: 200, vel: 0.7, origin: "manual" },
          { pitch: 64, tick: 975, dur: 200, vel: 0.7, origin: "manual" },
        ],
      },
    ]);
    await settled(page);
    await page.keyboard.press("Control+a");
    await page.getByRole("button", { name: "Selection: 3 notes" }).click();
    const sheet = page.getByRole("dialog", { name: "Selection" });

    await sheet.getByRole("button", { name: "Quantize" }).click();
    expect((await notesOf(page)).map((n) => n.tick)).toEqual([0, 480, 960]);
    await sheet.getByRole("button", { name: "Legato" }).click();
    expect((await notesOf(page)).map((n) => n.dur)).toEqual([480, 480, 200]);

    await sheet.getByRole("button", { name: "Duplicate" }).click();
    expect((await notesOf(page)).map((n) => [n.pitch, n.tick])).toEqual([
      [60, 0],
      [62, 480],
      [64, 960],
      [60, 1200],
      [62, 1680],
      [64, 2160],
    ]);

    // Cut the copies; paste them at the cursor, two bars on.
    await sheet.getByRole("button", { name: "Cut" }).click();
    expect(await notesOf(page)).toHaveLength(3);
    await setUi(page, { cursor: 3840 });
    await sheet.getByRole("button", { name: "Paste" }).click();
    const notes = await notesOf(page);
    expect(notes.slice(3).map((n) => [n.pitch, n.tick])).toEqual([
      [60, 3840],
      [62, 4320],
      [64, 4800],
    ]);
    expect((await ui(page)).selection).toEqual(notes.slice(3).map((n) => n.id));
    expect((await ui(page)).cursor).toBe(5040);
  });
});

// ── Acceptance criterion 5 ──
test.describe("by keyboard alone", () => {
  test("the cursor, the selection and every edit are reachable, and the live region says what happened", async ({
    page,
  }) => {
    await studioWith(page, TUNE);
    await settled(page);
    const said = live(page);

    // The cursor: by step, by bar, and from note to note.
    await page.keyboard.press("ArrowUp");
    await expect(said).toHaveText("Cursor at bar 1, beat 2");
    await page.keyboard.press("Shift+ArrowUp");
    await expect(said).toHaveText("Cursor at bar 2, beat 1");
    await page.keyboard.press("Shift+ArrowDown");
    await expect(said).toHaveText("Cursor at bar 1, beat 1");
    await page.keyboard.press("Alt+ArrowUp");
    await expect(said).toHaveText("D4, bar 1, beat 2, quarter note");
    expect((await ui(page)).cursor).toBe(480);

    // Select the note there, and move it: later by a grid step, up a semitone, up an octave.
    await page.keyboard.press("s");
    await expect(said).toHaveText("D4, bar 1, beat 2, quarter note, selected");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowRight");
    await expect(said).toHaveText("Eb4, bar 1, beat 2, tick 120, quarter note");
    await page.keyboard.press("Shift+ArrowRight");
    let d = (await notesOf(page)).find((n) => n.pitch === 75)!;
    expect(d).toMatchObject({ tick: 600 });
    // Earlier by a bar: it goes as far as the start of the song and no further.
    await page.keyboard.press("Shift+ArrowDown");
    await expect(said).toHaveText("Eb5, bar 1, beat 1, quarter note");
    d = (await notesOf(page)).find((n) => n.pitch === 75)!;
    expect(d.tick).toBe(0);

    // Copy, paste, duplicate, undo and redo.
    await page.keyboard.press("Control+c");
    await expect(said).toHaveText("Copied 1 note");
    await page.keyboard.press("Escape");
    await expect(said).toHaveText("Nothing selected");
    await page.keyboard.press("Shift+ArrowUp");
    await page.keyboard.press("Control+v");
    await expect(said).toHaveText("Pasted 1 note");
    expect((await notesOf(page)).filter((n) => n.pitch === 75).map((n) => n.tick)).toEqual([0, 1920]);
    await page.keyboard.press("Control+d");
    expect((await notesOf(page)).filter((n) => n.pitch === 75)).toHaveLength(3);
    await page.keyboard.press("Control+z");
    expect((await notesOf(page)).filter((n) => n.pitch === 75)).toHaveLength(2);
    await page.keyboard.press("Control+Shift+z");
    expect((await notesOf(page)).filter((n) => n.pitch === 75)).toHaveLength(3);

    // Delete the selection; select all; delete everything.
    await page.keyboard.press("Backspace");
    await expect(said).toHaveText("Deleted 1 note");
    await page.keyboard.press("Control+a");
    await expect(said).toHaveText("6 notes selected");
    await page.keyboard.press("Delete");
    expect(await notesOf(page)).toEqual([]);

    // Lengths, the next track, and the tools are all reachable too.
    await page.keyboard.press("5");
    await expect(said).toHaveText("sixteenth note");
    await page.keyboard.press(".");
    await expect(said).toHaveText("0.38 beats");
    await page.keyboard.press("]");
    await expect(said).toHaveText("Chords track");
    expect((await ui(page)).activeTrack).toBe("chords");
    await page.keyboard.press("[");
    expect((await ui(page)).activeTrack).toBe("melody");
    await page.getByRole("button", { name: "Erase" }).focus();
    await page.keyboard.press("Enter");
    expect((await ui(page)).tool).toBe("erase");
  });

  test("keys typed into a text field are text, not commands; Tab moves focus and is never taken", async ({ page }) => {
    await studioWith(page, TUNE);
    await settled(page);
    await page.getByRole("button", { name: /song settings$/ }).click();
    const title = page.getByRole("textbox", { name: "Title" });
    await title.fill("");
    await page.keyboard.type("Quiet 1 song.");
    await expect(title).toHaveValue("Quiet 1 song.");
    expect(await notesOf(page)).toHaveLength(5);
    expect((await ui(page)).length).toMatchObject({ base: 4, dotted: false });
    await page.keyboard.press("Tab");
    await expect(page.getByRole("textbox", { name: "Written by" })).toBeFocused();
    expect((await ui(page)).activeTrack).toBe("melody");
    expect((await project(page)).title).toBe("Quiet 1 song.");
  });

  test("the list of shortcuts is in the song menu", async ({ page }) => {
    await studioWith(page, TUNE);
    await page.getByRole("button", { name: "Song menu" }).click();
    await page.getByRole("menuitem", { name: "Keyboard shortcuts" }).click();
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog.getByText("Quantize the selection")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });
});

test.describe("by touch, on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  /** Drag one finger from a point to another, in steps, through the browser's own touch input. */
  async function swipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, holdMs = 0) {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", p?: { x: number; y: number }) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
    await touch("touchStart", from);
    if (holdMs) await page.waitForTimeout(holdMs);
    for (let i = 1; i <= 6; i++) {
      await touch("touchMove", { x: from.x + ((to.x - from.x) * i) / 6, y: from.y + ((to.y - from.y) * i) / 6 });
    }
    await touch("touchEnd");
  }

  test("a tap selects, a drag on a note moves it, a drag on empty space scrolls, a long press starts a box", async ({
    page,
  }) => {
    await studioWith(page, TUNE);
    await settled(page);
    const before = await notesOf(page);
    const e = before.find((n) => n.pitch === 64)!;

    const at = await mid(page, 64, e.tick, e.dur);
    await page.touchscreen.tap(at.x, at.y);
    expect((await ui(page)).selection).toEqual([e.id]);

    await swipe(page, at, await mid(page, 67, e.tick + 480, e.dur));
    expect((await notesOf(page)).find((n) => n.id === e.id)).toEqual({ ...e, pitch: 67, tick: e.tick + 480 });

    // Empty space: the music scrolls under the line and the cursor settles on the grid.
    const empty = await pointOf(page, 71, 2400);
    await swipe(page, empty, { x: empty.x, y: empty.y + 120 });
    await settled(page);
    const { cursor } = await ui(page);
    expect(cursor).toBeGreaterThan(0);
    expect(cursor % 120).toBe(0);
    expect(await notesOf(page)).toHaveLength(before.length);

    // A long press, then a drag: a box.
    await setUi(page, { cursor: 0, selection: [] });
    await settled(page);
    const a = await pointOf(page, 60, 2000);
    const b = await pointOf(page, 66, 30);
    await swipe(page, { x: a.x - 8, y: a.y }, b, 600);
    expect((await ui(page)).selection.length).toBeGreaterThanOrEqual(3);
  });

  test("what is selected floats over the canvas: it opens the inspector, collects more notes, and lets go", async ({
    page,
  }) => {
    await studioWith(page, TUNE);
    await settled(page);
    const notes = await notesOf(page);
    const chip = page.getByRole("group", { name: "Selection", exact: true });
    await expect(chip).toHaveCount(0);
    const c = await mid(page, 60, 0, 480);
    await page.touchscreen.tap(c.x, c.y);
    await expect(chip.getByRole("button", { name: "Selection: 1 note" })).toBeVisible();

    // "Add to selection" on: each tap adds a note, as Shift does with a mouse.
    await chip.getByRole("button", { name: "Add to selection" }).tap();
    const d = await mid(page, 62, 480, 480);
    await page.touchscreen.tap(d.x, d.y);
    expect((await ui(page)).selection.sort()).toEqual([notes[0].id, notes[1].id].sort());
    await chip.getByRole("button", { name: "Selection: 2 notes" }).tap();
    await expect(page.getByRole("dialog", { name: "Selection" })).toBeVisible();
    await page.getByRole("button", { name: "Close selection" }).tap();

    for (const name of ["Selection: 2 notes", "Add to selection", "Clear the selection"]) {
      const box = (await chip.getByRole("button", { name }).boundingBox())!;
      expect(box.height, name).toBeGreaterThanOrEqual(44);
    }
    await chip.getByRole("button", { name: "Clear the selection" }).tap();
    expect(await ui(page)).toMatchObject({ selection: [], addToSelection: false });
    await expect(chip).toHaveCount(0);
  });
});
