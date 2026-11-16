import type { Page } from "@playwright/test";
import type { EditOp, Project } from "../src/project/types";
import type { UiState } from "../src/studio/ui-store";
import type { View } from "../src/studio/view";
import { openStudio } from "./helpers";

/** A step of notes: quarter notes on the melody track from tick 0 unless said otherwise. */
export const notesOp = (
  pitches: number[],
  opts: { trackId?: string; start?: number; step?: number; dur?: number } = {},
): EditOp => ({
  op: "addNotes",
  trackId: opts.trackId ?? "melody",
  notes: pitches.map((pitch, i) => ({
    pitch,
    tick: (opts.start ?? 0) + i * (opts.step ?? 480),
    dur: opts.dur ?? opts.step ?? 480,
    vel: 0.7,
    origin: "manual" as const,
  })),
});

/** Store a new project with these edits applied, without opening it. The page must be on the app. */
export async function seedProject(page: Page, id: string, ops: EditOp[] = [], title = "A Small Tune") {
  await page.evaluate(
    async ({ id, ops, title }) => {
      const kit = await window.__app!.kit();
      const project = kit.applyOps(kit.newProject({ id, title }), ops);
      await kit.storage.saveProject(project);
    },
    { id, ops, title },
  );
}

/** Open a stored project in the Studio and wait until the canvas has been laid out. */
export async function openProject(page: Page, id: string) {
  await page.goto(`/?flags=test-hooks,studio#/studio/${id}`);
  await page.waitForFunction(() => !!window.__app?.session?.editor?.view());
}

/** Seed and open in one go. */
export async function studioWith(page: Page, ops: EditOp[] = [], id = "tune") {
  await openStudio(page);
  await seedProject(page, id, ops);
  await openProject(page, id);
}

export const project = (page: Page): Promise<Project> => page.evaluate(() => window.__app!.store!.getState().project);
export const ui = (page: Page): Promise<UiState> => page.evaluate(() => window.__app!.ui!.getState());
export const setUi = (page: Page, patch: Partial<UiState>) =>
  page.evaluate((patch) => window.__app!.ui!.setState(patch), patch);
export const view = (page: Page): Promise<View> => page.evaluate(() => window.__app!.session!.editor!.view()!);

/** Wait for the music to stop gliding: the view's tick has reached the cursor. */
export async function settled(page: Page) {
  await page.waitForFunction(() => {
    const s = window.__app!.session!;
    const v = s.editor?.view();
    return !!v && !s.ui.getState().playing && v.tick === s.ui.getState().cursor;
  });
}

/** Where a note position, or a key of the keyboard, is on the page. */
export const pointOf = (page: Page, pitch: number, tick: number) =>
  page.evaluate(({ pitch, tick }) => window.__app!.session!.editor!.pointOf(pitch, tick)!, { pitch, tick });
export const keyPoint = (page: Page, pitch: number) =>
  page.evaluate((pitch) => window.__app!.session!.editor!.keyPoint(pitch)!, pitch);

/** The colour of the canvas at a point on the page, as [r, g, b]. */
export async function pixelAt(page: Page, at: { x: number; y: number }): Promise<[number, number, number]> {
  return page.evaluate(({ x, y }) => {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas.editor-canvas")!;
    const r = canvas.getBoundingClientRect();
    const dpr = canvas.width / r.width;
    const d = canvas
      .getContext("2d")!
      .getImageData(Math.round((x - r.left) * dpr), Math.round((y - r.top) * dpr), 1, 1).data;
    return [d[0], d[1], d[2]] as [number, number, number];
  }, at);
}

/** The notes of a track, as plain objects. */
export async function notesOf(page: Page, trackId = "melody") {
  const p = await project(page);
  const t = p.tracks.find((x) => x.id === trackId);
  return t && t.kind === "notes" ? t.notes : [];
}
