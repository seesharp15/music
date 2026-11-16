import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { mockBank, needsSound, open, playerReady, type FixtureSong } from "./helpers";

/**
 * Practice's waterfall must draw exactly what it drew before the Studio began to share its drawing
 * code (Stage 3, criterion 13). Every call the waterfall makes on its canvas for one frame — each
 * rectangle, colour, font and line, with its numbers in full — was recorded from the code as it
 * was before the helpers were extracted, and is kept in `e2e/fixtures/stage-frames/`. The same
 * calls with the same numbers paint the same pixels, on any machine and with any fonts.
 *
 * To record again after a deliberate change to how Practice looks: `STAGE_FRAMES=record npx
 * playwright test stage-frames`, and say in the pull request what changed and why.
 */
needsSound();

const song: FixtureSong = {
  format: "piano-song/v1",
  id: "frames",
  title: "Frames",
  bpm: 120,
  timeSignature: [4, 4],
  duration: 6,
  notes: [
    { pitch: 64, time: 0.2, duration: 0.1, hand: "R" },
    { pitch: 60, time: 1.0, duration: 0.5, hand: "R", velocity: 0.9 },
    { pitch: 48, time: 1.0, duration: 1.0, hand: "L" },
    { pitch: 61, time: 1.25, duration: 0.5, hand: "R" },
    { pitch: 51, time: 2.0, duration: 0.25, hand: "L" },
    { pitch: 67, time: 2.0, duration: 0.25, hand: "R" },
    { pitch: 72, time: 2.5, duration: 3.0, hand: "R" },
    { pitch: 36, time: 3.0, duration: 0.4, hand: "L" },
  ],
};

/** Record every call and every property set on the waterfall's 2D context, split into frames. */
function recorder() {
  const frames: string[][] = [];
  (window as unknown as { __frames: string[][] }).__frames = frames;
  const show = (v: unknown): string =>
    typeof v === "number"
      ? String(v)
      : typeof v === "string"
        ? JSON.stringify(v)
        : v instanceof CanvasGradient
          ? "<gradient>"
          : String(v);
  const on = (ctx: CanvasRenderingContext2D) => ctx.canvas.classList.contains("stage");
  const log = (line: string) => {
    // A frame begins when the waterfall paints its background.
    if (line === 'fillStyle="#0f1115"') frames.push([]);
    frames[frames.length - 1]?.push(line);
    if (frames.length > 40) frames.splice(0, frames.length - 40);
  };
  const proto = CanvasRenderingContext2D.prototype as unknown as Record<string, unknown>;
  for (const name of Object.getOwnPropertyNames(proto)) {
    const d = Object.getOwnPropertyDescriptor(proto, name)!;
    if (typeof d.value === "function" && name !== "constructor") {
      const original = d.value as (...args: unknown[]) => unknown;
      proto[name] = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
        if (on(this)) log(`${name}(${args.map(show).join(",")})`);
        return original.apply(this, args);
      };
    } else if (d.set && d.get) {
      const set = d.set;
      Object.defineProperty(proto, name, {
        ...d,
        set(this: CanvasRenderingContext2D, v: unknown) {
          if (on(this)) log(`${name}=${show(v)}`);
          set.call(this, v);
        },
      });
    }
  }
  const stop = CanvasGradient.prototype.addColorStop;
  CanvasGradient.prototype.addColorStop = function (offset: number, color: string) {
    log(`addColorStop(${offset},${JSON.stringify(color)})`);
    return stop.call(this, offset, color);
  };
}

/** One whole frame of the paused waterfall at song time `t`, having checked that it has settled. */
async function frameAt(page: Page, t: number): Promise<string> {
  return page.evaluate(async (t) => {
    const player = window.__app!.player!;
    if (player.state.playing) player.pause();
    player.seek(t);
    const frames = (window as unknown as { __frames: string[][] }).__frames;
    const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
    for (let i = 0; i < 6; i++) await nextFrame();
    // The last entry may be half drawn; the three before it are whole, and must agree.
    const whole = frames.slice(-4, -1).map((f) => f.join("\n"));
    if (whole.length < 3 || whole[0] !== whole[1] || whole[1] !== whole[2])
      throw new Error("the frame has not settled");
    return whole[2];
  }, t);
}

const path = (name: string) => fileURLToPath(new URL(`./fixtures/stage-frames/${name}.txt`, import.meta.url));

function check(name: string, frame: string) {
  if (process.env.STAGE_FRAMES === "record") {
    writeFileSync(path(name), `${frame}\n`);
    return;
  }
  expect(existsSync(path(name)), `no recorded frame "${name}": see the note at the top of this file`).toBe(true);
  const recorded = readFileSync(path(name), "utf8").trimEnd().split("\n");
  const now = frame.split("\n");
  // Compare line by line first, so a failure names the first call that differs.
  const at = now.findIndex((line, i) => line !== recorded[i]);
  expect(at === -1 ? "same" : `call ${at + 1}: ${now[at]}  (was: ${recorded[at]})`, name).toBe("same");
  expect(now.length, name).toBe(recorded.length);
}

async function openFrames(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  // With reduced motion the keyboard takes its width at once instead of gliding to it, so every
  // frame of a paused waterfall is exactly the same as the last.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(recorder);
  await mockBank(page, [song]);
  await open(page, "#/play/frames");
  await playerReady(page);
  await expect(page.locator("canvas.stage")).toBeVisible();
}

for (const [label, size] of [
  ["desktop", { width: 1440, height: 900 }],
  ["phone", { width: 390, height: 844 }],
] as const) {
  test(`Practice's waterfall draws what it drew before, call for call (${label})`, async ({ page }) => {
    await openFrames(page, size);
    const keys = page.getByRole("group", { name: "Keys shown" });

    // Before anything sounds; with notes sounding in both hands on white and black keys, and the
    // lines that link hands striking together; then deep in a long note.
    check(`${label}-song-0`, await frameAt(page, 0));
    check(`${label}-song-1.3`, await frameAt(page, 1.3));
    check(`${label}-song-3.1`, await frameAt(page, 3.1));

    // All 88 keys.
    await keys.getByRole("button", { name: "All" }).click();
    check(`${label}-all-2.05`, await frameAt(page, 2.05));
    await keys.getByRole("button", { name: "Song" }).click();

    // A muted hand and a quiet one are drawn fainter; sync lines off.
    await page.evaluate(() => {
      window.__app!.player!.setMuted("L", true);
      window.__app!.player!.setVolume("R", 0.5);
    });
    await page.getByRole("checkbox", { name: /sync lines/i }).uncheck();
    check(`${label}-faint-1.3`, await frameAt(page, 1.3));
  });
}
