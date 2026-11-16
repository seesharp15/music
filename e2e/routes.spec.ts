import { expect, test } from "@playwright/test";
import { needsSound, open } from "./helpers";

const heading = (name: string) => ({ level: 1, name }) as const;

test("home is the library", async ({ page }) => {
  await open(page, "#/");
  await expect(page.getByRole("heading", heading("Song bank"))).toBeVisible();
  await open(page, "");
  await expect(page.getByRole("heading", heading("Song bank"))).toBeVisible();
});

test("an unknown address says so and offers the way home", async ({ page }) => {
  await open(page, "#/no/such/place");
  await expect(page.getByText("There’s nothing at this address.")).toBeVisible();
  await page.getByRole("link", { name: "Go to the songs" }).click();
  await expect(page.getByRole("heading", heading("Song bank"))).toBeVisible();
});

test("the piano samples are credited, one tap from any page", async ({ page }) => {
  await open(page, "#/");
  await page.getByRole("link", { name: "Credits" }).click();
  await expect(page.getByRole("heading", heading("Credits"))).toBeVisible();
  await expect(page.getByText("Salamander Grand Piano")).toBeVisible();
  await expect(page.getByText("Alexander Holm")).toBeVisible();
  await expect(page.getByRole("link", { name: "Creative Commons Attribution 3.0" })).toBeVisible();
});

// The song screen loads the audio code even to say a song is missing.
test.describe("routes that open the song screen", () => {
  needsSound();

  test("a link from before the app had routes still opens its song", async ({ page }) => {
    await open(page, "#rewrite-the-stars");
    await expect(page.getByRole("heading", heading("Rewrite the Stars"))).toBeVisible();
    expect(new URL(page.url()).hash).toBe("#/play/rewrite-the-stars");
  });

  test("a song has its own address", async ({ page }) => {
    await open(page, "#/play/divenire");
    await expect(page.getByRole("heading", heading("Divenire"))).toBeVisible();
  });

  test("an unknown song says so, and does not open another song instead", async ({ page }) => {
    await open(page, "#/play/nope");
    await expect(page.getByText("That song isn’t in the library.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(0);
    await page.getByRole("link", { name: "See all the songs" }).click();
    await expect(page.getByRole("heading", heading("Song bank"))).toBeVisible();
  });

  test("library to a song and back, by link and by the browser's buttons", async ({ page }) => {
    await open(page, "#/");
    await page.getByRole("link", { name: /Rewrite the Stars/ }).click();
    await expect(page.getByRole("heading", heading("Rewrite the Stars"))).toBeVisible();
    expect(new URL(page.url()).hash).toBe("#/play/rewrite-the-stars");

    await page.getByRole("link", { name: "← Library" }).click();
    await expect(page.getByRole("heading", heading("Song bank"))).toBeVisible();
    await page.getByRole("link", { name: /Divenire/ }).click();
    await expect(page.getByRole("heading", heading("Divenire"))).toBeVisible();

    await page.goBack();
    await expect(page.getByRole("heading", heading("Song bank"))).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", heading("Rewrite the Stars"))).toBeVisible();
    await page.goForward();
    await page.goForward();
    await expect(page.getByRole("heading", heading("Divenire"))).toBeVisible();
  });

  test("the brand is the way home from a song", async ({ page }) => {
    await open(page, "#/play/divenire");
    await page.getByRole("link", { name: "Piano Tutor: all songs" }).click();
    await expect(page.getByRole("heading", heading("Song bank"))).toBeVisible();
  });
});
