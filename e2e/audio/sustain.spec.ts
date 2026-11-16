import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { open } from "../helpers";

/**
 * The sustain pedal, measured on rendered samples. Levels are relative to the note's own level at
 * the moment its key is released, so the same numbers hold for every sound.
 */
const SYNTHS = ["clear", "soft", "epiano", "bright"] as const;
type Sound = (typeof SYNTHS)[number] | "piano";

const shortNote = {
  format: "piano-song/v1" as const,
  id: "short",
  title: "Short",
  notes: [{ pitch: 60, time: 0.2, duration: 0.2, hand: "R" as const, velocity: 0.8 }],
};
const END = 0.4; // when the key is released

/** The densest 20 seconds of Divenire: 263 notes. */
function densest() {
  const song = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../public/songs/divenire.json", import.meta.url)), "utf8"),
  );
  const from = 326;
  return {
    format: "piano-song/v1" as const,
    id: "dense",
    title: "Dense",
    duration: 20,
    notes: (song.notes as { pitch: number; time: number; duration: number; hand: "L" | "R"; velocity?: number }[])
      .filter((n) => n.time >= from && n.time < from + 20)
      .map((n) => ({ ...n, time: Number((n.time - from).toFixed(3)) })),
  };
}

/** The sampled piano needs its samples; where the host is unreachable, those cases are skipped. */
async function pianoAvailable(page: Page) {
  return page.evaluate(async () => {
    try {
      return (await fetch("https://tonejs.github.io/audio/salamander/A4.mp3", { method: "HEAD" })).ok;
    } catch {
      return false;
    }
  });
}

async function envelope(page: Page, sound: Sound) {
  return page.evaluate(
    async ({ song, sound, end }) => {
      const { renderOffline, levelDb } = await window.__app!.testing();
      const at = (r: Awaited<ReturnType<typeof renderOffline>>, t: number) => levelDb(r, t, t + 0.05);
      const on = await renderOffline(song, { sound, seconds: 9.5, sustain: true });
      const off = await renderOffline(song, { sound, seconds: 3 });
      const lifted = await renderOffline(song, { sound, seconds: 3, sustain: true, dampAt: [1.0] });
      const ref = at(on, end - 0.05);
      const refOff = at(off, end - 0.05);
      return {
        sameWhileHeld: ref - refOff,
        on15: at(on, end + 1.5) - ref,
        on8: at(on, end + 8) - ref,
        off12: at(off, end + 1.2) - refOff,
        beforeLift: at(lifted, 0.9) - ref,
        afterLift: at(lifted, 1.2) - ref,
      };
    },
    { song: shortNote, sound, end: END },
  );
}

function expectPedalEnvelope(m: Awaited<ReturnType<typeof envelope>>) {
  expect(Math.abs(m.sameWhileHeld)).toBeLessThan(0.5); // the pedal changes the ending, not the note
  expect(m.on15).toBeGreaterThan(-20); // still ringing a second and a half on
  expect(m.on8).toBeLessThan(-50); // and gone by eight seconds
  expect(m.off12).toBeLessThan(-40); // without the pedal it stops as it always has
  expect(m.beforeLift).toBeGreaterThan(-20);
  expect(m.afterLift).toBeLessThan(-60); // lifting the pedal silences it within 200 ms
}

test.beforeEach(async ({ page }) => {
  await open(page);
});

for (const sound of SYNTHS) {
  test(`${sound}: a released note rings on, dies away, and stops when the pedal lifts`, async ({ page }) => {
    expectPedalEnvelope(await envelope(page, sound));
  });
}

/**
 * The grand piano is a recording, and a recorded string dies away at its own pace: a second and a
 * half after a short middle C it is already some 25 dB down, pedal or no pedal. So it is not held to
 * the synthesized sounds' figure. The right question for it is whether the pedal behaves like a held
 * key: a short note under the pedal should sound like the same note with the key kept down.
 */
test("grand piano: under the pedal a short note rings like a held one, then stops when the pedal lifts", async ({
  page,
}) => {
  test.skip(!(await pianoAvailable(page)), "the piano samples' host cannot be reached from here");
  const m = await page.evaluate(
    async ({ song, end }) => {
      const { renderOffline, levelDb } = await window.__app!.testing();
      const at = (r: Awaited<ReturnType<typeof renderOffline>>, t: number) => levelDb(r, t, t + 0.05);
      const held = { ...song, notes: [{ ...song.notes[0], duration: 9 }] };
      const pedal = await renderOffline(song, { sound: "piano", seconds: 9.5, sustain: true });
      const key = await renderOffline(held, { sound: "piano", seconds: 9.5 });
      const off = await renderOffline(song, { sound: "piano", seconds: 3 });
      const lifted = await renderOffline(song, { sound: "piano", seconds: 3, sustain: true, dampAt: [1.0] });
      const ref = at(pedal, end - 0.05);
      return {
        sameWhileHeld: ref - at(off, end - 0.05),
        // The pedal against the held key, at the same moments.
        vsHeld05: at(pedal, end + 0.5) - at(key, end + 0.5),
        vsHeld15: at(pedal, end + 1.5) - at(key, end + 1.5),
        vsHeld30: at(pedal, end + 3) - at(key, end + 3),
        // For the record: how fast the recording itself dies away.
        heldDrop15: at(key, end + 1.5) - at(key, end - 0.05),
        pedalDrop15: at(pedal, end + 1.5) - ref,
        on8: at(pedal, end + 8) - ref,
        off12: at(off, end + 1.2) - at(off, end - 0.05),
        beforeLift: at(lifted, 0.9) - at(key, 0.9),
        afterLift: at(lifted, 1.2) - ref,
      };
    },
    { song: shortNote, end: END },
  );
  console.log("grand piano under the pedal:", JSON.stringify(m));
  expect(Math.abs(m.sameWhileHeld), JSON.stringify(m)).toBeLessThan(0.5);
  expect(m.vsHeld05, JSON.stringify(m)).toBeGreaterThan(-3); // within 3 dB of a held key…
  expect(m.vsHeld15, JSON.stringify(m)).toBeGreaterThan(-3);
  expect(m.vsHeld30, JSON.stringify(m)).toBeGreaterThan(-6); // …the slow fade only starting to tell
  expect(m.on8, JSON.stringify(m)).toBeLessThan(-50);
  expect(m.off12, JSON.stringify(m)).toBeLessThan(-40);
  expect(m.beforeLift, JSON.stringify(m)).toBeGreaterThan(-3);
  expect(m.afterLift, JSON.stringify(m)).toBeLessThan(-60);
});

async function densePassage(page: Page, sound: Sound, sustain: boolean) {
  const warnings: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "warning" || m.type() === "error") warnings.push(m.text());
  });
  const m = await page.evaluate(
    async ({ song, sound, sustain }) => {
      const { renderOffline, peakDb, levelDb } = await window.__app!.testing();
      const r = await renderOffline(song, { sound, seconds: 24, sustain });
      return { peak: peakDb(r), level: levelDb(r, 0, 20) };
    },
    { song: densest(), sound, sustain },
  );
  return { ...m, dropped: warnings.filter((w) => /polyphony|dropped/i.test(w)) };
}

for (const sound of SYNTHS) {
  test(`${sound}: Divenire's densest passage with the pedal down drops nothing and does not clip`, async ({ page }) => {
    test.slow(sound === "epiano");
    const dry = await densePassage(page, sound, false);
    const wet = await densePassage(page, sound, true);
    expect(dry.dropped).toEqual([]);
    expect(wet.dropped).toEqual([]);
    expect(wet.peak).toBeLessThan(0);
    expect(wet.level).toBeGreaterThan(dry.level); // the pedal really is adding sound
  });
}

test("grand piano: Divenire's densest passage with the pedal down drops nothing and does not clip", async ({
  page,
}) => {
  test.skip(!(await pianoAvailable(page)), "the piano samples' host cannot be reached from here");
  test.slow();
  const wet = await densePassage(page, "piano", true);
  expect(wet.dropped).toEqual([]);
  expect(wet.peak).toBeLessThan(0);
});

test("a key struck again takes over its own ring instead of piling up", async ({ page }) => {
  // The same key forty times in four seconds, pedal down. If every strike kept its own six-second
  // ring, the level would climb far past a single note's.
  const repeated = {
    ...shortNote,
    notes: Array.from({ length: 40 }, (_, i) => ({ ...shortNote.notes[0], time: 0.2 + i * 0.1, duration: 0.05 })),
  };
  const m = await page.evaluate(
    async ({ one, many }) => {
      const { renderOffline, peakDb } = await window.__app!.testing();
      return {
        one: peakDb(await renderOffline(one, { seconds: 2, sustain: true })),
        many: peakDb(await renderOffline(many, { seconds: 6, sustain: true })),
      };
    },
    { one: shortNote, many: repeated },
  );
  expect(m.many - m.one).toBeLessThan(3);
});

test("more notes than there are voices still all sound", async ({ page }) => {
  // 120 different keys in six seconds on one hand: more than the 48 voices a hand may have ringing.
  const run = {
    ...shortNote,
    notes: Array.from({ length: 120 }, (_, i) => ({
      pitch: 36 + (i % 60),
      time: 0.1 + i * 0.05,
      duration: 0.04,
      hand: "R" as const,
      velocity: 0.8,
    })),
  };
  const levels = await page.evaluate(async (song) => {
    const { renderOffline, levelDb } = await window.__app!.testing();
    const r = await renderOffline(song, { seconds: 8, sustain: true });
    return Array.from({ length: 12 }, (_, i) => levelDb(r, 0.1 + i * 0.5, 0.6 + i * 0.5));
  }, run);
  for (const level of levels) expect(level).toBeGreaterThan(-45); // every half second of the run is audible
});
