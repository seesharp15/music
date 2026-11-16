import { test } from "@playwright/test";
import { open } from "./helpers";

/**
 * Not a test of the app: a look at what the WebKit build that CI runs can and cannot do, printed to
 * the log. WebKit cannot be run where this is developed, and its smoke test crashes on Practice.
 * Each step is a fresh page, from least to most audio, so the log shows where it stops working.
 */
test("what this browser can do", async ({ browser, browserName }) => {
  test.skip(browserName !== "webkit", "only needed to diagnose WebKit");
  test.setTimeout(120_000);

  const step = async (name: string, hash: string, run: (page: import("@playwright/test").Page) => Promise<unknown>) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const events: string[] = [];
    page.on("crash", () => events.push("CRASH"));
    page.on("pageerror", (e) => events.push(`uncaught: ${e.message}`));
    try {
      await open(page, hash);
      await page.waitForFunction(() => !!window.__app, undefined, { timeout: 8000 });
      const result = await Promise.race([
        run(page),
        new Promise((_, reject) => setTimeout(() => reject(new Error("no answer after 10 s")), 10_000)),
      ]);
      console.log(`[probe] ${name}: ${JSON.stringify(result)} ${JSON.stringify(events)}`);
    } catch (e) {
      console.log(`[probe] ${name}: FAILED ${(e as Error).message.split("\n")[0]} ${JSON.stringify(events)}`);
    }
    await context.close().catch(() => {});
  };

  await step("1 library renders", "#/", (page) => page.locator("h1").innerText({ timeout: 5000 }));
  await step("2 a plain AudioContext", "#/credits", (page) =>
    page.evaluate(async () => {
      const ctx = new AudioContext();
      const gain = ctx.createGain();
      ctx.createStereoPanner().connect(gain).connect(ctx.destination);
      const out = { state: ctx.state, sampleRate: ctx.sampleRate };
      await ctx.close();
      return out;
    }),
  );
  await step("3 load the audio code (Tone)", "#/credits", (page) =>
    page.evaluate(async () => Object.keys(await window.__app!.testing()).length),
  );
  await step("4 Tone creates its context", "#/credits", (page) =>
    page.evaluate(async () => (await window.__app!.testing()).audioNow()),
  );
  await step("5 an offline render", "#/credits", (page) =>
    page.evaluate(async () => {
      const t = await window.__app!.testing();
      const song = {
        format: "piano-song/v1" as const,
        id: "x",
        title: "x",
        notes: [{ pitch: 60, time: 0.1, duration: 0.3, hand: "R" as const }],
      };
      return t.levelDb(await t.renderOffline(song, { seconds: 1 }), 0.1, 0.4);
    }),
  );
  await step("6 the practice page", "#/play/rewrite-the-stars", async (page) => {
    await page.locator("h1").waitFor({ timeout: 8000 });
    return page.locator("h1").innerText({ timeout: 3000 });
  });
});
