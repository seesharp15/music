import { expect, test, type Page } from "@playwright/test";
import { needsSound, open, openStudio } from "./helpers";

/**
 * The Studio (Stage 3): its frame, opening and closing projects, and what happens when a stored
 * project is damaged. The editor loads the audio engine, so these run in Chromium only.
 */
needsSound();

const project = (page: Page) => page.evaluate(() => window.__app!.store!.getState().project);

async function newSong(page: Page) {
  await openStudio(page);
  await page.getByRole("button", { name: /New song/ }).click();
  await expect(page).toHaveURL(/#\/studio\/[a-z0-9]+$/);
  await page.waitForFunction(() => !!window.__app?.store);
}

test.describe("with the studio flag off", () => {
  test("no Studio code is downloaded by the Library or by Practice", async ({ page }) => {
    const scripts: string[] = [];
    page.on("response", (r) => {
      if (/\.(js|css)$/.test(new URL(r.url()).pathname)) scripts.push(r.url());
    });
    await open(page);
    await expect(page.getByRole("link", { name: /Divenire/ })).toBeVisible();
    await page.getByRole("link", { name: /Rewrite the Stars/ }).click();
    await page.waitForFunction(() => !!window.__app?.player);
    await page.waitForLoadState("networkidle");
    expect(scripts.length).toBeGreaterThan(3);
    // Every file the two screens fetched, read back: none of it is the Studio's or My songs'.
    for (const url of scripts) {
      const body = await (await page.request.get(url)).text();
      expect(body, url).not.toMatch(/studio-bar|mysongs-title|first-run-choice/);
    }
  });
});

test("New song opens an empty song in the Studio, which asks how to begin", async ({ page }) => {
  await newSong(page);
  const p = await project(page);
  expect(p).toMatchObject({ title: "Untitled", tempo: [{ tick: 0, bpm: 100 }], key: [{ tonic: "C", mode: "major" }] });
  expect(p.meter[0]).toMatchObject({ numerator: 4, denominator: 4 });

  const choices = page.getByRole("group", { name: "How would you like to start?" });
  await expect(choices.getByRole("button")).toHaveCount(3);
  await expect(choices.getByRole("button", { name: /Tap it in, one note at a time/ })).toBeVisible();
  await expect(choices.getByRole("button", { name: /Play it live/ })).toBeVisible();
  await expect(choices.getByRole("button", { name: /Start with chords/ })).toBeVisible();
  await choices.getByRole("button", { name: /Tap it in/ }).click();
  await expect(choices).toHaveCount(0);
  expect(await page.evaluate(() => window.__app!.ui!.getState().input)).toBe("step");

  // The page itself does not scroll: the Studio fills the viewport.
  expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0);
});

test("the title opens song settings; renaming is one undo step and reaches the Library", async ({ page }) => {
  await newSong(page);
  await page.getByRole("button", { name: /Tap it in/ }).click();
  await page.getByRole("button", { name: "Untitled: song settings" }).click();
  const sheet = page.getByRole("dialog", { name: "Song settings" });
  await sheet.getByRole("textbox", { name: "Title" }).fill("Twinkle");
  await sheet.getByRole("textbox", { name: "Title" }).press("Enter");
  expect((await project(page)).title).toBe("Twinkle");

  // Escape closes the sheet; undo and redo say what they will do.
  await sheet.getByRole("textbox", { name: "Written by" }).focus();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await page.getByRole("button", { name: "Undo rename song" }).click();
  expect((await project(page)).title).toBe("Untitled");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Redo rename song" }).click();
  expect((await project(page)).title).toBe("Twinkle");

  // Leaving saves without being asked; the Library lists it under My songs.
  await page.getByRole("link", { name: "Back to the library" }).click();
  await expect(page.getByRole("link", { name: "Edit Twinkle" })).toBeVisible();
});

test("the song menu duplicates and deletes", async ({ page }) => {
  await newSong(page);
  await page.getByRole("button", { name: /Tap it in/ }).click();
  const first = (await project(page)).id;

  await page.getByRole("button", { name: "Song menu" }).click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await page.waitForFunction(
    (first) => window.__app?.store && window.__app.store.getState().project.id !== first,
    first,
  );
  const copy = await project(page);
  expect(copy.title).toBe("Untitled (copy)");

  await page.getByRole("button", { name: "Song menu" }).click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My songs" })).toBeVisible();
  await expect(page.locator(".project-card")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Edit Untitled", exact: true })).toBeVisible();
});

test("a song that is not on this device says so", async ({ page }) => {
  await openStudio(page, "#/studio/nothing-here");
  await expect(page.getByText("That song isn’t on this device.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to the library" })).toBeVisible();
});

test.describe("a stored project that fails validation", () => {
  async function damage(page: Page, opts: { snapshot: boolean }) {
    await openStudio(page);
    await page.evaluate(async ({ snapshot }) => {
      const kit = await window.__app!.kit();
      const good = kit.applyOps(kit.newProject({ id: "tune", title: "A Small Tune" }), [
        {
          op: "addNotes",
          trackId: "melody",
          notes: [{ pitch: 60, tick: 0, dur: 480, vel: 0.7, origin: "manual" }],
        },
      ]);
      await kit.storage.saveProject(good, { snapshot });
      const bad = JSON.parse(JSON.stringify(good));
      bad.tracks[0].notes[0].pitch = 400;
      bad.tempo = [];
      await (await kit.storage.openDb()).put("projects", bad);
    }, opts);
  }

  test("opens on a screen that says what is wrong and offers the last good version; it never reaches the editor", async ({
    page,
  }) => {
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(e.message));
    await damage(page, { snapshot: true });
    await page.goto("/?flags=test-hooks,studio#/studio/tune");

    await expect(page.getByRole("heading", { name: "This song can’t be opened for editing" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^\d problems$/ })).toBeVisible();
    await expect(page.locator(".damaged-errors")).toContainText("tracks.0.notes.0.pitch");
    await expect(page.locator(".damaged-errors")).toContainText("tempo");
    await expect(page.getByRole("region", { name: "Last good version" })).toContainText("“A Small Tune”, 8 bars");
    expect(await page.evaluate(() => window.__app!.store)).toBeNull();

    // Look at it: the editor opens, read-only — no undo, no tracks to write to, nothing saved.
    await page.getByRole("button", { name: "Look at it first" }).click();
    await page.waitForFunction(() => !!window.__app?.store);
    await expect(page.getByText("You are looking at the last good version.")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Undo/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Song menu" })).toHaveCount(0);
    await page.getByRole("button", { name: "Back", exact: true }).click();

    // Restore it: the good version is the project again, and the editor opens on it.
    await page.getByRole("button", { name: "Restore this version" }).click();
    await page.waitForFunction(() => !!window.__app?.store);
    await expect(page.getByRole("button", { name: "Song menu" })).toBeVisible();
    const p = await project(page);
    expect(p.tempo).toEqual([{ tick: 0, bpm: 100 }]);
    expect(p.tracks[0].kind === "notes" && p.tracks[0].notes[0].pitch).toBe(60);
    expect(problems).toEqual([]);
  });

  test("says so plainly when no good version was kept", async ({ page }) => {
    await damage(page, { snapshot: false });
    await page.goto("/?flags=test-hooks,studio#/studio/tune");
    await expect(page.getByRole("heading", { name: "This song can’t be opened for editing" })).toBeVisible();
    await expect(page.getByText("No earlier version of it was kept that is still sound.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Restore this version" })).toHaveCount(0);
  });
});

test("the frame fits a phone: the bar, the editor and the track row, with touch-sized targets", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await newSong(page);
  await page.getByRole("button", { name: /Tap it in/ }).click();
  for (const name of ["Back to the library", "Song menu"]) {
    const box = await page.getByRole(name === "Song menu" ? "button" : "link", { name }).boundingBox();
    expect(box!.width, name).toBeGreaterThanOrEqual(44);
    expect(box!.height, name).toBeGreaterThanOrEqual(44);
  }
  const tabs = page.getByRole("tablist", { name: "Track that input goes to" });
  await expect(tabs.getByRole("tab")).toHaveText(["Melody", "Chords", "Bass", "Drums"]);
  await tabs.getByRole("tab", { name: "Bass" }).click();
  await expect(tabs.getByRole("tab", { name: "Bass" })).toHaveAttribute("aria-selected", "true");
  expect(await page.evaluate(() => window.__app!.ui!.getState().activeTrack)).toBe("bass");
  expect((await tabs.getByRole("tab", { name: "Bass" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
