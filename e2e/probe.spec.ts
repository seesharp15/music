import { test } from "@playwright/test";
import { open } from "./helpers";

/**
 * Not a test of the app: a look at what the WebKit build that CI runs can and cannot do, printed to
 * the log. WebKit cannot be run where this is developed, and its smoke test fails with a blank page.
 */
test("what this browser can do", async ({ page, browserName }) => {
  test.skip(browserName !== "webkit", "only needed to diagnose WebKit");
  const events: string[] = [];
  page.on("crash", () => events.push("CRASH"));
  page.on("pageerror", (e) => events.push(`uncaught: ${e.message}`));
  page.on("console", (m) => events.push(`${m.type()}: ${m.text()}`));

  const step = async (name: string, run: () => Promise<unknown>) => {
    try {
      const result = await Promise.race([
        run(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timed out after 8 s")), 8000)),
      ]);
      console.log(`[probe] ${name}: ${JSON.stringify(result)}`);
    } catch (e) {
      console.log(`[probe] ${name}: FAILED ${(e as Error).message.split("\n")[0]}`);
    }
  };

  await step("credits page (no audio code)", async () => {
    await open(page, "#/credits");
    return page.locator("h1").innerText({ timeout: 5000 });
  });
  await step("library (no audio code)", async () => {
    await open(page, "#/");
    return page.locator("h1").innerText({ timeout: 5000 });
  });
  await step("audio support", () =>
    page.evaluate(async () => {
      const out: Record<string, unknown> = { AudioContext: typeof AudioContext, Offline: typeof OfflineAudioContext };
      try {
        const ctx = new AudioContext();
        out.state = ctx.state;
        out.sampleRate = ctx.sampleRate;
        out.compressor = typeof ctx.createDynamicsCompressor;
        await ctx.close();
      } catch (e) {
        out.error = String(e);
      }
      return out;
    }),
  );
  await step("practice page", async () => {
    await open(page, "#/play/rewrite-the-stars");
    await page.waitForTimeout(3000);
    return { text: (await page.locator("body").innerText({ timeout: 3000 })).slice(0, 200) };
  });
  console.log(`[probe] events: ${JSON.stringify(events.slice(0, 20))}`);
});
