import { expect, test } from "@playwright/test";
import { open } from "./helpers";

const heading = (name: string) => ({ level: 1, name }) as const;

test("a link from before the app had routes still opens its song", async ({ page }) => {
  await open(page, "#rewrite-the-stars");
  await expect(page.getByRole("heading", heading("Rewrite the Stars"))).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#/play/rewrite-the-stars");
});

test("a song has its own address", async ({ page }) => {
  await open(page, "#/play/divenire");
  await expect(page.getByRole("heading", heading("Divenire"))).toBeVisible();
});

test("home opens the first song", async ({ page }) => {
  await open(page, "#/");
  await expect(page.getByRole("heading", heading("Rewrite the Stars"))).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#/play/rewrite-the-stars");
});

test("an unknown song falls back to the first one", async ({ page }) => {
  await open(page, "#/play/no-such-song");
  await expect(page.getByRole("heading", heading("Rewrite the Stars"))).toBeVisible();
});

test("back and forward move between songs", async ({ page }) => {
  await open(page, "#/play/rewrite-the-stars");
  await expect(page.getByRole("heading", heading("Rewrite the Stars"))).toBeVisible();
  await page.getByLabel("Song", { exact: true }).selectOption("divenire");
  await expect(page.getByRole("heading", heading("Divenire"))).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#/play/divenire");
  await page.goBack();
  await expect(page.getByRole("heading", heading("Rewrite the Stars"))).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", heading("Divenire"))).toBeVisible();
});
