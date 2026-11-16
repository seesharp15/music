import { expect, test, type Page } from "@playwright/test";
import { open, playerReady } from "./helpers";

const bank = (page: Page) => page.getByRole("region", { name: "Song bank" });
const cards = (page: Page) => bank(page).getByRole("link");
const hashOf = (page: Page) => new URL(page.url()).hash;

test("every song in the index gets a card, without downloading a single song", async ({ page }) => {
  const songFiles: string[] = [];
  page.on("request", (r) => {
    const m = /\/songs\/([^/?]+\.json)/.exec(r.url());
    if (m && m[1] !== "index.json") songFiles.push(m[1]);
  });
  await open(page, "#/");
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).filter({ hasText: "Rewrite the Stars" })).toContainText("The Greatest Showman");
  await expect(cards(page).filter({ hasText: "Rewrite the Stars" })).toContainText("3:29 · 125 BPM");
  await expect(cards(page).filter({ hasText: "Rewrite the Stars" })).toContainText("Film & TV");
  await expect(cards(page).filter({ hasText: "Divenire" })).toContainText("6:47"); // no tempo: free time
  await expect(bank(page).getByRole("img", { name: "Difficulty 4 of 5" })).toBeVisible();
  expect(songFiles).toEqual([]);
});

test("search narrows as you type, lives in the address, and survives a reload", async ({ page }) => {
  await open(page, "#/");
  await page.getByRole("searchbox", { name: "Search songs" }).fill("einaudi");
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page)).toContainText("Divenire");
  expect(hashOf(page)).toBe("#/?q=einaudi");

  await page.reload();
  await expect(page.getByRole("searchbox", { name: "Search songs" })).toHaveValue("einaudi");
  await expect(cards(page)).toHaveCount(1);

  await page.getByRole("searchbox", { name: "Search songs" }).fill("");
  await expect(cards(page)).toHaveCount(2);
  expect(hashOf(page)).toBe("#/");
});

test("a search with no matches says so and offers to clear it", async ({ page }) => {
  await open(page, "#/?q=zzzz");
  await expect(page.getByText("No songs match.")).toBeVisible();
  await page.getByRole("button", { name: "Clear search and filters" }).click();
  await expect(cards(page)).toHaveCount(2);
});

test("genre chips offer only the genres that have songs, and filter", async ({ page }) => {
  await open(page, "#/");
  const chips = page.getByRole("group", { name: "Genre" }).getByRole("button");
  await expect(chips).toHaveText(["All", "Film & TV", "Neoclassical"]);
  await chips.filter({ hasText: "Neoclassical" }).click();
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page)).toContainText("Divenire");
  expect(hashOf(page)).toBe("#/?genre=neoclassical");
  await page.goBack(); // a filter is a step you can undo
  await expect(cards(page)).toHaveCount(2);
});

test("difficulty and sort work, and sort is kept in the address", async ({ page }) => {
  await open(page, "#/");
  await expect(cards(page).first()).toContainText("Divenire"); // newest first: listed later, same day
  await page.getByRole("combobox", { name: "Sort by" }).selectOption("title");
  await expect(cards(page).first()).toContainText("Divenire");
  await page.getByRole("combobox", { name: "Sort by" }).selectOption("length");
  await expect(cards(page).first()).toContainText("Rewrite the Stars");
  expect(hashOf(page)).toBe("#/?sort=length");
  await page.getByRole("combobox", { name: "Difficulty" }).selectOption("4");
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page)).toContainText("Divenire");
});

test("what you played comes first under Continue, and picks up where you left it", async ({ page }) => {
  await open(page, "#/");
  await expect(page.getByRole("heading", { name: "Continue" })).toHaveCount(0);

  await cards(page).filter({ hasText: "Rewrite the Stars" }).click();
  await playerReady(page);
  await page.evaluate(() => window.__app!.player!.seek(60));
  await page.getByRole("link", { name: "← Library" }).click();

  const row = page.getByRole("region", { name: "Continue" });
  await expect(row.getByRole("link")).toHaveCount(1);
  await expect(row.getByRole("link")).toContainText("Rewrite the Stars");
  await expect(row.getByRole("link")).toContainText("Resume at 1:00 of 3:29");

  // Even in a fresh tab, where nothing else remembers the position.
  await page.evaluate(() => sessionStorage.clear());
  await row.getByRole("link").click();
  await playerReady(page);
  expect(await page.evaluate(() => window.__app!.player!.currentTime())).toBeCloseTo(60, 1);

  // The song played most recently is the first card.
  await page.getByRole("link", { name: "← Library" }).click();
  await cards(page).filter({ hasText: "Divenire" }).click();
  await playerReady(page);
  await page.evaluate(() => window.__app!.player!.seek(30));
  await page.getByRole("link", { name: "← Library" }).click();
  await expect(page.getByRole("region", { name: "Continue" }).getByRole("link")).toContainText([
    "Divenire",
    "Rewrite the Stars",
  ]);
});

test("opening a song without listening does not put it under Continue", async ({ page }) => {
  await open(page, "#/play/divenire");
  await playerReady(page);
  await page.getByRole("link", { name: "← Library" }).click();
  await expect(page.getByRole("heading", { name: "Song bank" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Continue" })).toHaveCount(0);
});

test("cards work from the keyboard and are announced by title and artist", async ({ page }) => {
  await open(page, "#/");
  const card = page.getByRole("link", { name: /Divenire.*Ludovico Einaudi/ });
  await expect(card).toBeVisible();
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Divenire" })).toBeVisible();
});

test("nothing scrolls sideways on a small phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await open(page, "#/");
  await expect(cards(page)).toHaveCount(2);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("a song list that fails to load says so, and Try again recovers", async ({ page }) => {
  let calls = 0;
  await page.route("**/songs/index.json", (route) =>
    ++calls === 1 ? route.fulfill({ status: 500, body: "no" }) : route.continue(),
  );
  await open(page, "#/");
  await expect(page.getByText("The song list couldn’t be loaded.")).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(cards(page)).toHaveCount(2);
});

test("cards arrive without shifting the page: placeholders hold their place", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/songs/index.json", async (route) => {
    await held;
    await route.continue();
  });
  await open(page, "#/");
  const grid = page.locator(".song-grid");
  await expect(grid).toHaveAttribute("aria-busy", "true");
  const before = await grid.locator(".song-card").first().boundingBox();
  release();
  await expect(cards(page)).toHaveCount(2);
  const after = await cards(page).first().boundingBox();
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(1);
  expect(Math.abs(after!.height - before!.height)).toBeLessThan(1);
});
