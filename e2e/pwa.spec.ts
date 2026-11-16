import { expect, test, type Page } from "@playwright/test";
import { needsSound } from "./helpers";

/**
 * The installable app (Stage 3, S3.9, criterion 14): the manifest and icons a browser needs before
 * it offers to install, and the service worker that lets the app open with no network.
 */
needsSound();
test.use({ serviceWorkers: "allow" });

const STUDIO = "/?flags=test-hooks,studio";

/** Wait until the service worker controls the page and has finished keeping the app's files. */
async function workerReady(page: Page) {
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg?.active || !navigator.serviceWorker.controller) return false;
    const names = await caches.keys();
    const shell = names.find((n) => n.startsWith("shell-"));
    if (!shell) return false;
    const kept = (await (await caches.open(shell)).keys()).map((r) => new URL(r.url).pathname);
    return kept.some((p) => /StudioRoute-.*\.js$/.test(p)) && kept.some((p) => p.endsWith("/index.html"));
  });
}

test("the app passes the browser's installability checks", async ({ page }) => {
  await page.goto("/");
  const cdp = await page.context().newCDPSession(page);
  const manifest = await cdp.send("Page.getAppManifest");
  expect(manifest.errors).toEqual([]);
  expect(manifest.url).toMatch(/manifest\.webmanifest$/);
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
  expect(installabilityErrors).toEqual([]);

  const data = JSON.parse(manifest.data!);
  expect(data).toMatchObject({ name: "Piano Tutor", display: "standalone", start_url: "." });
  // Every icon it names is there, and is the size it says.
  for (const icon of data.icons as { src: string; sizes: string; purpose: string }[]) {
    const size = await page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      return `${img.naturalWidth}x${img.naturalHeight}`;
    }, icon.src);
    expect(size, icon.src).toBe(icon.sizes);
  }
  expect((data.icons as { purpose: string }[]).map((i) => i.purpose).sort()).toEqual(["any", "any", "maskable"]);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "icons/apple-touch-icon.png");
});

test("with the studio flag off there is no service worker: Practice loads exactly as it always has", async ({
  page,
}) => {
  await page.goto("/?flags=test-hooks#/play/rewrite-the-stars");
  await page.waitForFunction(() => !!window.__app?.player);
  await page.waitForLoadState("networkidle");
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  expect(await page.evaluate(() => caches.keys())).toEqual([]);
});

test("after a first visit, with no network the app shell opens and a saved song loads in the Studio", async ({
  page,
  context,
}) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto(STUDIO);
  await workerReady(page);

  // Write something, through the app.
  await page.getByRole("button", { name: /New song/ }).click();
  await page.waitForFunction(() => !!window.__app?.session?.editor?.view());
  await page.getByRole("button", { name: /Tap it in/ }).click();
  for (const pitch of [60, 64, 67]) {
    const at = await page.evaluate((p) => window.__app!.session!.editor!.keyPoint(p)!, pitch);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(80);
  }
  const id = await page.evaluate(() => window.__app!.store!.getState().project.id);
  await page.evaluate(() => window.__app!.store!.flush());

  // No network at all, and a cold start.
  await context.setOffline(true);
  await page.goto("about:blank");
  await page.goto(STUDIO);
  await expect(page.getByRole("heading", { name: "My songs" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit Untitled" })).toBeVisible();
  // The bank's list cannot be fetched, and says so; the app carries on.
  await expect(page.getByText("The song list couldn’t be loaded.")).toBeVisible();

  await page.getByRole("link", { name: "Edit Untitled" }).click();
  await page.waitForFunction(() => !!window.__app?.session?.editor?.view());
  const notes = await page.evaluate(() => {
    const t = window.__app!.store!.getState().project.tracks[0];
    return t.kind === "notes" ? t.notes.map((n) => n.pitch) : [];
  });
  expect(notes).toEqual([60, 64, 67]);
  expect(await page.evaluate(() => window.__app!.store!.getState().project.id)).toBe(id);
  // It can still be edited and played: nothing the editor needs is fetched.
  await page.getByRole("button", { name: "Play from the cursor" }).click();
  await expect.poll(() => page.evaluate(() => window.__app!.ui!.getState().playing)).toBe(true);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  expect(problems).toEqual([]);

  // Back on the network, the page is the network's own again — a new version is never held back.
  await context.setOffline(false);
  const [response] = await Promise.all([page.waitForResponse((r) => r.request().isNavigationRequest()), page.reload()]);
  expect(response.fromServiceWorker()).toBe(true);
  expect(response.status()).toBe(200);
});

test("a new version replaces the old worker's files", async ({ page }) => {
  await page.goto(STUDIO);
  await workerReady(page);
  // An older worker's cache, as a previous version of the app would have left it.
  await page.evaluate(async () => {
    const old = await caches.open("shell-000000000000");
    await old.put("assets/old.js", new Response("old"));
  });
  // The worker activating again clears every shell cache but its own.
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg!.unregister();
  });
  await page.reload();
  await workerReady(page);
  expect((await page.evaluate(() => caches.keys())).filter((n) => n.startsWith("shell-"))).toHaveLength(1);
  expect(await page.evaluate(() => caches.has("shell-000000000000"))).toBe(false);
});
