import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { Project } from "../src/project/types";
import { needsSound, open, openStudio } from "./helpers";
import { notesOp, openProject, project, seedProject, studioWith } from "./studio-helpers";

/**
 * In and out of the Studio (Stage 3, S3.8): Practice it, exporting a project, a song and a MIDI
 * file, importing them back, and opening a copy of a bank song.
 */
needsSound();

const BAR = 1920;
const TUNE = [
  notesOp([60, 62, 64, 65, 67, 69, 71, 72]),
  notesOp([48, 52, 55], { trackId: "chords", step: 0, dur: BAR }),
  notesOp([36, 43], { trackId: "bass", step: BAR, dur: BAR }),
  {
    op: "setChords" as const,
    range: { start: 0, end: 2 * BAR },
    chords: [
      { tick: 0, dur: BAR, symbol: "C", origin: "manual" as const },
      { tick: BAR, dur: BAR, symbol: "G7", origin: "manual" as const },
    ],
  },
  { op: "setSections" as const, sections: [{ id: "a", name: "Tune", tick: 0, dur: 2 * BAR }] },
];
const triples = (p: Project, trackId: string) => {
  const t = p.tracks.find((x) => x.id === trackId);
  return t?.kind === "notes" ? t.notes.map((n) => [n.pitch, n.tick, n.dur]) : [];
};
const stored = (page: Page) =>
  page.evaluate(async () => {
    const { storage } = await window.__app!.kit();
    const out = [];
    for (const meta of await storage.listProjects()) {
      const loaded = await storage.loadProject(meta.id);
      if (loaded.ok) out.push(loaded.project);
    }
    return out;
  });

/** Choose a menu item of the song menu and catch the file it downloads. */
async function exportFrom(page: Page, item: string) {
  await page.getByRole("button", { name: "Song menu" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: item }).click(),
  ]);
  return { name: download.suggestedFilename(), path: await download.path() };
}
/** Import a file through the "Import a file" card and its real file picker. */
async function importFile(page: Page, file: { name: string; mimeType: string; buffer: Buffer } | string) {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: /Import a file/ }).click(),
  ]);
  await chooser.setFiles(file);
}

// ── Acceptance criterion 8 ──
test("a project exported and imported is deep-equal; exported as MIDI and imported, every note's pitch, tick and length comes back", async ({
  page,
}) => {
  await studioWith(page, TUNE);
  const before = await project(page);
  const json = await exportFrom(page, "Export project");
  const midi = await exportFrom(page, "Export as MIDI");
  expect(json.name).toBe("a-small-tune.piano-project.json");
  expect(midi.name).toBe("a-small-tune.mid");
  expect(readFileSync(midi.path).subarray(0, 4).toString("latin1")).toBe("MThd");

  // Onto a device that has never seen the song.
  await page.getByRole("link", { name: "Back to the library" }).click();
  await page.evaluate(async () => (await window.__app!.kit()).storage.deleteProject("tune"));
  await page.reload();
  await importFile(page, json.path);
  await expect(page.getByRole("status").filter({ hasText: "“A Small Tune” was imported." })).toBeVisible();
  expect(await stored(page)).toEqual([before]);

  await importFile(page, midi.path);
  await expect(page.getByRole("status").filter({ hasText: /brought in from the MIDI file/ })).toBeVisible();
  const all = await stored(page);
  expect(all).toHaveLength(2);
  const fromMidi = all.find((p) => p.id !== "tune")!;
  for (const track of ["melody", "chords", "bass"]) expect(triples(fromMidi, track)).toEqual(triples(before, track));
  expect(fromMidi.tempo).toEqual(before.tempo);
  expect(fromMidi.meter).toEqual(before.meter);
  // The title travels inside the file, whatever the file itself is called.
  expect(fromMidi.title).toBe("A Small Tune");
  expect(fromMidi.source?.kind).toBe("midi");
  // It opens in the editor like any other.
  await page.locator(`a.project-link[href="#/studio/${fromMidi.id}"]`).click();
  await page.waitForFunction(() => !!window.__app?.session?.editor?.view());
  expect(triples(await project(page), "melody")).toEqual(triples(before, "melody"));
});

test("Export song for the bank writes a song file in the bank's format: notes in seconds, a hand each, a plain id", async ({
  page,
}) => {
  await studioWith(page, TUNE);
  const file = await exportFrom(page, "Export song for the bank");
  expect(file.name).toBe("a-small-tune.json");
  const song = JSON.parse(readFileSync(file.path, "utf8"));
  expect(song).toMatchObject({
    format: "piano-song/v2",
    id: "a-small-tune",
    title: "A Small Tune",
    bpm: 100,
    timeSignature: [4, 4],
  });
  expect(song.notes).toHaveLength(13);
  expect(song.notes.filter((n: { hand: string }) => n.hand === "R")).toHaveLength(8);
  expect(song.notes[0]).toMatchObject({ time: 0, hand: "L" });
  expect(song.sections).toEqual([{ name: "Tune", start: 0, end: 4.8 }]);
  expect(song.chords.map((c: { symbol: string }) => c.symbol)).toEqual(["C", "G7"]);
  // The app reads it back as a song: dropped into the bank, it would play.
  const read = await page.evaluate(
    async (text) => (await window.__app!.kit()).readFile(text),
    readFileSync(file.path, "utf8"),
  );
  expect(read).toMatchObject({ ok: true, kind: "song" });
});

test("a song file from the bank imports as a project that can be edited", async ({ page }) => {
  await openStudio(page);
  await importFile(page, "public/songs/rewrite-the-stars.json");
  await expect(page.getByRole("link", { name: "Edit Rewrite the Stars" })).toBeVisible();
  const [p] = await stored(page);
  expect(
    p.tracks.filter((t) => t.kind === "notes").reduce((n, t) => n + (t.kind === "notes" ? t.notes.length : 0), 0),
  ).toBe(1400);
  expect(p.source?.kind).toBe("song");
});

test("importing something that is not a song is refused, saying what is wrong, and nothing is stored", async ({
  page,
}) => {
  await openStudio(page);
  const cases: [string, Buffer, RegExp][] = [
    ["notes.json", Buffer.from("{ this is not json"), /not valid JSON/],
    ["tune.mid", Buffer.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 2, 1, 0xe0, 0x4d, 0x54]), /cut off/],
    ["tune.mid", Buffer.from("hello"), /not a MIDI file/],
    ["other.json", Buffer.from(JSON.stringify({ format: "something/else" })), /format is "something\/else"/],
    ["empty.json", Buffer.from(""), /empty/],
  ];
  for (const [name, buffer, message] of cases) {
    await importFile(page, { name, mimeType: "application/octet-stream", buffer });
    await expect(page.locator(".mysongs-notice")).toHaveText(message);
  }
  expect(await stored(page)).toEqual([]);
});

test("a project file whose song is already here is kept beside it, not over it", async ({ page }) => {
  await studioWith(page, TUNE);
  const json = await exportFrom(page, "Export project");
  await page.getByRole("link", { name: "Back to the library" }).click();
  await importFile(page, json.path);
  await expect(page.getByRole("link", { name: "Edit A Small Tune (imported)" })).toBeVisible();
  expect((await stored(page)).map((p) => p.title).sort()).toEqual(["A Small Tune", "A Small Tune (imported)"]);
});

test("Open a copy in Studio makes a bank song the author's own to change, leaving the bank's as it was", async ({
  page,
}) => {
  await openStudio(page);
  await page.getByRole("button", { name: "More for Divenire" }).click();
  await page.getByRole("menuitem", { name: "Open a copy in Studio" }).click();
  await page.waitForFunction(() => !!window.__app?.session?.editor?.view());
  const p = await project(page);
  expect(p.title).toBe("Divenire (my version)");
  expect(p.tracks.filter((t) => t.kind === "notes").map((t) => t.name)).toEqual(["Melody", "Chords"]);
  // Free time: the grid is an estimate, and the project says so.
  expect(p.source).toMatchObject({ kind: "song", gridGuessed: true });
  await page.getByRole("link", { name: "Back to the library" }).click();
  await expect(page.getByRole("link", { name: "Edit Divenire (my version)" })).toBeVisible();
  // The bank's own card still plays the bank's own song.
  await expect(page.locator('a.card-link[href="#/play/divenire"]')).toBeVisible();
});

test("Practice from a card compiles the song as it now is; Practice plays it with the studio flag on or off", async ({
  page,
}) => {
  await openStudio(page);
  await seedProject(page, "tune", TUNE);
  await page.reload();
  await page.getByRole("button", { name: "More for A Small Tune" }).click();
  await page.getByRole("menuitem", { name: "Practice" }).click();
  await expect(page).toHaveURL(/#\/play\/u-tune$/);
  await expect(page.getByRole("heading", { level: 1, name: "A Small Tune" })).toBeVisible();
  await page.waitForFunction(() => !!window.__app?.player);
  // Read from this device, not fetched: there is no such file on the server.
  expect(await page.evaluate(() => window.__app!.player!.duration)).toBeCloseTo(8 * 2.4, 6);
  await expect(page.getByRole("link", { name: "Edit in Studio" })).toBeVisible();

  // Changed in the Studio, and practised again: the new version is what plays.
  await openProject(page, "tune");
  await page.evaluate(() =>
    window.__app!.store!.apply(
      [{ op: "patchSong", patch: { title: "A Bigger Tune", lengthTicks: 16 * 1920 } }],
      "Change",
    ),
  );
  await page.getByRole("button", { name: "Practice it" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "A Bigger Tune" })).toBeVisible();
  await page.waitForFunction(() => !!window.__app?.player);
  expect(await page.evaluate(() => window.__app!.player!.duration)).toBeCloseTo(16 * 2.4, 6);

  // With the flag off the song still plays — it is on the device — but there is no way into the Studio.
  await open(page, "#/play/u-tune");
  await page.waitForFunction(() => !!window.__app?.player);
  await expect(page.getByRole("heading", { level: 1, name: "A Bigger Tune" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit in Studio" })).toHaveCount(0);
});

test("a song of the author's that is not on this device says so", async ({ page }) => {
  await open(page, "#/play/u-nothing");
  await expect(page.getByText("That song isn’t in the library.")).toBeVisible();
});
