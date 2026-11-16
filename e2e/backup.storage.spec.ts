import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openStudio } from "./helpers";
import { notesOp } from "./studio-helpers";

/**
 * Keeping the author's work safe (Stage 3, S3.9): Settings, "Export all my songs" and its way back
 * in, and the two quiet notes under My songs. None of it loads audio code, so it runs in WebKit
 * too — the browser that clears a site's data soonest.
 */

const SETTINGS = "/?flags=test-hooks,studio#/settings";

/** Three songs, one with editor state and assistant records kept beside it. */
async function seed(page: Page, daysAgo = 0) {
  await page.evaluate(
    async ({ ops, daysAgo }) => {
      const kit = await window.__app!.kit();
      const at = new Date(Date.now() - daysAgo * 86_400_000);
      for (const [id, title] of [
        ["one", "First Song"],
        ["two", "Second Song"],
        ["three", "Third Song"],
      ]) {
        await kit.storage.saveProject(kit.applyOps(kit.newProject({ id, title, now: at }), ops));
      }
      await kit.storage.kvSet("studio:one", { cursor: 960, ticksPerPx: 9 });
      await kit.storage.kvSet("assist:two", { history: [{ id: "s1" }] });
      await kit.storage.kvSet("songs:index", []);
    },
    { ops: [notesOp([60, 62, 64, 65])], daysAgo },
  );
}
const everything = (page: Page) =>
  page.evaluate(async () => {
    const { storage } = await window.__app!.kit();
    const projects = [];
    for (const meta of await storage.listProjects()) {
      const loaded = await storage.loadProject(meta.id);
      if (loaded.ok) projects.push(loaded.project);
    }
    projects.sort((a, b) => a.id.localeCompare(b.id));
    return { projects, studio: await storage.kvGet("studio:one"), assist: await storage.kvGet("assist:two") };
  });

// ── Acceptance criterion 14, second half ──
test("Export all my songs, then Restore on a clean profile, brings back every song and what was kept beside it", async ({
  page,
  browser,
}) => {
  await openStudio(page);
  await seed(page);
  const before = await everything(page);
  expect(before.projects).toHaveLength(3);

  await page.goto(SETTINGS);
  await expect(page.getByText("3 songs at the moment")).toBeVisible();
  await expect(page.getByText("Last backup: never.")).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export all my songs" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^piano-tutor-backup-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(page.getByText("3 songs saved to a backup file.")).toBeVisible();
  await expect(page.getByText("Last backup: never.")).toHaveCount(0);
  const path = await download.path();
  const file = JSON.parse(readFileSync(path, "utf8"));
  expect(file.format).toBe("piano-tutor-backup/v1");
  // The backup is the songs: no last-moment copies, no listings of other things.
  expect(Object.keys(file.kv).sort()).toEqual(["assist:two", "studio:one"]);

  // A clean profile: another browser context, with nothing stored.
  const clean = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const other = await clean.newPage();
  await other.goto(SETTINGS);
  await expect(other.getByText("0 songs at the moment")).toBeVisible();
  const [chooser] = await Promise.all([
    other.waitForEvent("filechooser"),
    other.getByRole("button", { name: "Restore from a backup…" }).click(),
  ]);
  await chooser.setFiles(path);
  await expect(other.getByText("3 songs restored.")).toBeVisible();
  await expect(other.getByText("3 songs at the moment")).toBeVisible();
  expect(await everything(other)).toEqual(before);

  // Restored a second time, nothing is doubled.
  const [again] = await Promise.all([
    other.waitForEvent("filechooser"),
    other.getByRole("button", { name: "Restore from a backup…" }).click(),
  ]);
  await again.setFiles(path);
  await expect(other.getByText("0 songs restored; 3 already here.")).toBeVisible();
  expect((await everything(other)).projects).toHaveLength(3);

  // A song changed since the backup is not overwritten by it: both are kept.
  await other.evaluate(async () => {
    const { storage } = await window.__app!.kit();
    const loaded = await storage.loadProject("two");
    if (loaded.ok) await storage.saveProject({ ...loaded.project, title: "Second Song, reworked" });
  });
  const [third] = await Promise.all([
    other.waitForEvent("filechooser"),
    other.getByRole("button", { name: "Restore from a backup…" }).click(),
  ]);
  await third.setFiles(path);
  await expect(other.getByText(/1 kept beside a different version already here/)).toBeVisible();
  expect((await everything(other)).projects.map((p) => p.title).sort()).toEqual([
    "First Song",
    "Second Song (from backup)",
    "Second Song, reworked",
    "Third Song",
  ]);
  await clean.close();
});

test("a file that is not a backup is refused with a reason; a damaged song inside one is named and left out", async ({
  page,
}) => {
  await openStudio(page);
  await page.goto(SETTINGS);
  const restore = async (name: string, text: string) => {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: "Restore from a backup…" }).click(),
    ]);
    await chooser.setFiles({ name, mimeType: "application/json", buffer: Buffer.from(text) });
  };
  await restore("x.json", "{ nope");
  await expect(page.getByRole("alert")).toContainText("This file could not be read");
  await restore("x.json", JSON.stringify({ format: "piano-project/v1" }));
  await expect(page.getByRole("alert")).toHaveText("This is not a Piano Tutor backup file.");

  const good = await page.evaluate(async () => {
    const kit = await window.__app!.kit();
    return kit.newProject({ id: "good", title: "Sound Song" });
  });
  const bad = { ...good, id: "bad", title: "Broken Song", tempo: [] };
  await restore(
    "b.json",
    JSON.stringify({ format: "piano-tutor-backup/v1", exportedAt: "x", projects: [good, bad], kv: {}, takes: [] }),
  );
  await expect(page.getByRole("alert")).toHaveText("1 song restored; 1 left out as damaged (Broken Song).");
  expect((await everything(page)).projects.map((p) => p.id)).toEqual(["good"]);
});

test("a backup can also be brought in through Import a file in the Library", async ({ page }) => {
  await openStudio(page);
  await seed(page);
  const text = await page.evaluate(async () => (await (await window.__app!.kit()).storage.collectBackup()).text);
  await page.evaluate(async () => {
    const { storage } = await window.__app!.kit();
    for (const id of ["one", "two", "three"]) await storage.deleteProject(id);
  });
  await page.reload();
  await expect(page.locator(".project-card")).toHaveCount(0);
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: /Import a file/ }).click(),
  ]);
  await chooser.setFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(text) });
  await expect(page.getByRole("status").filter({ hasText: "3 songs were imported from the backup." })).toBeVisible();
  await expect(page.locator(".project-card")).toHaveCount(3);
});

test("Settings says whether the browser will keep the songs, and how to install the app", async ({ page }) => {
  await openStudio(page);
  await page.goto(SETTINGS);
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByText("The browser is asked to keep your songs the first time one is saved.")).toBeVisible();
  await page.getByRole("button", { name: "Ask the browser to keep them" }).click();
  // Whatever it answers, the answer is shown and remembered.
  const status = page.getByRole("region", { name: "Where your songs are kept" }).getByRole("status");
  await expect(status).toContainText(/has agreed to keep|has not promised to keep|cannot say whether/);
  const answer = await page.evaluate(() => localStorage.getItem("piano-tutor:storage-persist"));
  expect(["persisted", "refused", "unsupported"]).toContain(answer);

  await expect(page.getByRole("region", { name: "Install the app" })).toContainText(
    /Add to Home Screen|install button|Install app/,
  );
  // With the flag off, there is no such page.
  await page.goto("/?flags=test-hooks#/settings");
  await expect(page.getByText("There’s nothing at this address.")).toBeVisible();
});

test.describe("the quiet notes under My songs", () => {
  test("how to install is said once there is a first song, and once only", async ({ page }) => {
    await openStudio(page);
    await expect(page.getByRole("note", { name: "Install the app" })).toHaveCount(0); // no songs yet
    await seed(page);
    await page.reload();
    const note = page.getByRole("note", { name: "Install the app" });
    await expect(note).toContainText("Your songs live on this device.");
    await expect(note.getByRole("link", { name: "Storage and backup" })).toHaveAttribute("href", "#/settings");
    await note.getByRole("button", { name: "Got it" }).click();
    await expect(note).toHaveCount(0);
    await page.reload();
    await expect(page.locator(".project-card")).toHaveCount(3);
    await expect(note).toHaveCount(0);
  });

  test("a reminder to back up appears when songs have changed and two weeks have passed, and not before", async ({
    page,
  }) => {
    await openStudio(page);
    await seed(page, 3);
    await page.reload();
    const note = page.getByRole("note", { name: "Back up your songs" });
    await expect(page.locator(".project-card")).toHaveCount(3);
    await expect(note).toHaveCount(0); // three days: too soon to nag

    await seed(page, 20);
    await page.reload();
    await expect(note).toContainText("Your songs have not been backed up yet.");
    // Not now: quiet for a week.
    await note.getByRole("button", { name: "Not now" }).click();
    await expect(note).toHaveCount(0);
    await page.reload();
    await expect(page.locator(".project-card")).toHaveCount(3);
    await expect(note).toHaveCount(0);

    // A week on (the snooze has run out), it asks again; backing up answers it.
    await page.evaluate(() =>
      localStorage.setItem("piano-tutor:backup-snooze", new Date(Date.now() - 1000).toISOString()),
    );
    await page.reload();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      note.getByRole("button", { name: "Back up now" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^piano-tutor-backup-/);
    await expect(note).toHaveCount(0);
    await expect(page.getByText("3 songs saved to a backup file.")).toBeVisible();
    await page.reload();
    await expect(page.locator(".project-card")).toHaveCount(3);
    await expect(note).toHaveCount(0);
  });

  test("a backup made long ago, and songs changed since: it says so", async ({ page }) => {
    await openStudio(page);
    await seed(page, 1);
    await page.evaluate(() =>
      localStorage.setItem("piano-tutor:last-backup", new Date(Date.now() - 30 * 86_400_000).toISOString()),
    );
    await page.reload();
    await expect(page.getByRole("note", { name: "Back up your songs" })).toContainText(
      "You have changed songs since your last backup, more than two weeks ago.",
    );
  });
});
