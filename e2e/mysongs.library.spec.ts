import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { open, openStudio } from "./helpers";

/**
 * My songs in the Library (Stage 3). Nothing here opens the editor, so it loads no audio code and
 * runs in WebKit too — the browser where stored songs are most at risk.
 */

async function seed(page: Page, id: string, title: string, updatedAt = "2026-11-01T10:00:00.000Z") {
  await page.evaluate(
    async ({ id, title, updatedAt }) => {
      const kit = await window.__app!.kit();
      const project = kit.applyOps(kit.newProject({ id, title, now: new Date(updatedAt) }), [
        {
          op: "addNotes",
          trackId: "melody",
          notes: [60, 62, 64].map((pitch, i) => ({ pitch, tick: i * 480, dur: 480, vel: 0.7, origin: "manual" })),
        },
      ]);
      await kit.storage.saveProject(project);
    },
    { id, title, updatedAt },
  );
}

const mySongs = (page: Page) => page.getByRole("region", { name: "My songs" });
const cards = (page: Page) => mySongs(page).locator(".project-card");

test("with the studio flag off, the Library shows no My songs and the Studio has no address", async ({ page }) => {
  await open(page);
  await seed(page, "tune", "A Small Tune");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Song bank" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Divenire/ })).toBeVisible();
  await expect(page.getByText("My songs")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /New song/ })).toHaveCount(0);

  await page.goto("/?flags=test-hooks#/studio");
  await expect(page.getByText("There’s nothing at this address.")).toBeVisible();
  await page.goto("/?flags=test-hooks#/studio/tune");
  await expect(page.getByText("There’s nothing at this address.")).toBeVisible();
});

test("My songs lists every project, newest first, above the song bank, with a card to start a new one", async ({
  page,
}) => {
  await openStudio(page);
  await seed(page, "older", "Older Song", "2026-10-01T10:00:00.000Z");
  await seed(page, "newer", "Newer Song", "2026-11-10T10:00:00.000Z");
  await page.reload();

  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).nth(0)).toContainText("Newer Song");
  await expect(cards(page).nth(1)).toContainText("Older Song");
  await expect(cards(page).nth(0)).toContainText("8 bars");
  await expect(mySongs(page).getByRole("button", { name: /New song/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit Newer Song" })).toHaveAttribute("href", "#/studio/newer");

  // Above the bank.
  const mine = await page.getByRole("heading", { name: "My songs" }).boundingBox();
  const bank = await page.getByRole("heading", { name: "Song bank" }).boundingBox();
  expect(mine!.y).toBeLessThan(bank!.y);

  // And on its own page — which, like the Library, downloads none of the audio code: the editor
  // behind each card is fetched when a song is opened, not to list them.
  const scripts: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith(".js")) scripts.push(new URL(r.url()).pathname);
  });
  await page.goto("/?flags=test-hooks,studio#/studio");
  await expect(page.getByRole("heading", { level: 1, name: "My songs" })).toBeVisible();
  await expect(cards(page)).toHaveCount(2);
  expect(scripts.length).toBeGreaterThan(0);
  expect(scripts.filter((s) => /player-|OpenProject-/.test(s))).toEqual([]);
});

test("rename, duplicate and delete from a card's menu, by mouse and by keyboard", async ({ page }) => {
  await openStudio(page);
  await seed(page, "tune", "A Small Tune");
  await page.reload();

  // Rename, with the keyboard alone.
  await page.getByRole("button", { name: "More for A Small Tune" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Edit" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Practice" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Rename…" })).toBeFocused();
  await page.keyboard.press("Enter");
  const title = page.getByRole("textbox", { name: "Title" });
  await expect(title).toBeFocused();
  await title.fill("Renamed Tune");
  await page.keyboard.press("Enter");
  await expect(cards(page)).toContainText(["Renamed Tune"]);
  expect(
    await page.evaluate(async () => {
      const loaded = await (await window.__app!.kit()).storage.loadProject("tune");
      return loaded.ok && loaded.project.title;
    }),
  ).toBe("Renamed Tune");

  // Duplicate: a second song, with the same notes and its own id.
  await page.getByRole("button", { name: "More for Renamed Tune" }).click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(cards(page)).toHaveCount(2);
  await expect(page.getByRole("link", { name: "Edit Renamed Tune (copy)" })).toBeVisible();
  const copy = await page.evaluate(async () => {
    const { storage } = await window.__app!.kit();
    const list = await storage.listProjects();
    const other = list.find((p) => p.id !== "tune")!;
    const loaded = await storage.loadProject(other.id);
    return loaded.ok
      ? { id: other.id, notes: loaded.project.tracks[0].kind === "notes" && loaded.project.tracks[0].notes.length }
      : null;
  });
  expect(copy).toMatchObject({ notes: 3 });
  expect(copy!.id).not.toBe("tune");

  // Delete asks first; Cancel keeps the song, Delete removes it and its snapshots.
  await page.getByRole("button", { name: "More for Renamed Tune (copy)" }).click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  await expect(page.getByRole("dialog", { name: /Delete “Renamed Tune \(copy\)”/ })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(cards(page)).toHaveCount(2);
  await page.getByRole("button", { name: "More for Renamed Tune (copy)" }).click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(cards(page)).toHaveCount(1);
  expect(await page.evaluate(async () => (await (await window.__app!.kit()).storage.listProjects()).length)).toBe(1);
});

test("Export from a card downloads the project as a file that reads back the same", async ({ page }) => {
  await openStudio(page);
  await seed(page, "tune", "A Small Tune");
  await page.reload();
  await page.getByRole("button", { name: "More for A Small Tune" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "Export" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("a-small-tune.piano-project.json");
  const text = readFileSync(await download.path(), "utf8");
  const stored = await page.evaluate(async () => {
    const loaded = await (await window.__app!.kit()).storage.loadProject("tune");
    return loaded.ok ? loaded.project : null;
  });
  expect(JSON.parse(text)).toEqual(stored);
});

test("the cards fit a small phone, with touch-sized targets, and nothing scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openStudio(page);
  await seed(page, "tune", "A Song With A Very Long Title That Has To Be Cut Off Somewhere Sensible");
  await page.reload();
  await expect(cards(page)).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const menu = await mySongs(page)
    .getByRole("button", { name: /^More for/ })
    .boundingBox();
  expect(menu!.width).toBeGreaterThanOrEqual(44);
  expect(menu!.height).toBeGreaterThanOrEqual(44);
});

test("the Studio can be switched on for this device from the Credits page, with no address to type, and off again", async ({
  page,
}) => {
  // As an installed app opens: no flags in the address.
  await page.goto("/#/credits");
  const flag = page.getByRole("checkbox", { name: /Song builder on this device/ });
  await expect(flag).not.toBeChecked();
  // A click, not check(): the page reloads at once, so there is no box left to read back.
  await flag.click();
  await expect(page.getByRole("heading", { name: "My songs" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("piano-tutor:flags"))).toBe("studio");
  // It stays on: this is the device's choice, not the address's.
  await page.reload();
  await expect(page.getByRole("button", { name: /New song/ })).toBeVisible();

  await page.goto("/#/credits");
  await expect(flag).toBeChecked();
  await flag.click();
  await expect(page.getByRole("heading", { name: "Song bank" })).toBeVisible();
  await expect(page.getByText("My songs")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("piano-tutor:flags"))).toBeNull();
});
