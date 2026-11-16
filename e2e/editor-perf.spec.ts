import { expect, test } from "@playwright/test";
import { needsSound, openStudio } from "./helpers";
import { openProject, settled } from "./studio-helpers";

/**
 * Stage 3, criterion 9: the editor with a 3,000-note song, at a phone's size with the CPU slowed
 * four times. What is asserted is what the editor itself costs — how long a frame takes to draw —
 * which does not depend on how busy the machine running the tests is. Frames per second are
 * recorded beside it, for the build notes; on a real phone the owner is the judge.
 */
needsSound();
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true });

const FRAME_BUDGET_MS = 1000 / 60;

test("with 3,000 notes, drawing a frame takes a small part of the frame's time, playing and dragging", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openStudio(page);
  // Divenire is 2,996 notes; four more make three thousand.
  const count = await page.evaluate(async () => {
    const kit = await window.__app!.kit();
    const song = await (await fetch("songs/divenire.json")).json();
    let p = { ...kit.projectFromSong(song), id: "big", title: "Three thousand notes" };
    p = kit.applyOps(p, [
      {
        op: "addNotes",
        trackId: p.tracks[0].id,
        notes: [0, 1, 2, 3].map((i) => ({
          pitch: 96 + i,
          tick: i * 480,
          dur: 240,
          vel: 0.7,
          origin: "manual" as const,
        })),
      },
    ]);
    await kit.storage.saveProject(p);
    return p.tracks.reduce((n, t) => n + (t.kind === "notes" ? t.notes.length : 0), 0);
  });
  expect(count).toBe(3000);
  await openProject(page, "big");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  /** Watch frames for a while: the gaps between them, and what each redraw of the editor cost. */
  const watch = (ms: number) =>
    page.evaluate(
      (ms) =>
        new Promise<{ gaps: number[]; draws: number[] }>((resolve) => {
          const editor = window.__app!.session!.editor!;
          const gaps: number[] = [];
          const draws: number[] = [];
          let last = performance.now();
          let drawn = editor.stats().frames;
          const t0 = last;
          const tick = (now: number) => {
            gaps.push(now - last);
            last = now;
            const s = editor.stats();
            if (s.frames !== drawn) draws.push(s.lastMs);
            drawn = s.frames;
            if (now - t0 < ms) requestAnimationFrame(tick);
            else resolve({ gaps, draws });
          };
          requestAnimationFrame(tick);
        }),
      ms,
    );
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const note = (label: string, m: { gaps: number[]; draws: number[] }) => {
    const fps = (m.gaps.length / m.gaps.reduce((a, b) => a + b, 0)) * 1000;
    test.info().annotations.push({
      type: label,
      description: `${fps.toFixed(1)} fps; draw median ${median(m.draws).toFixed(2)} ms, worst ${Math.max(...m.draws).toFixed(2)} ms, over ${m.draws.length} redraws`,
    });
  };

  // Playing, from a dense passage.
  await page.evaluate(() => window.__app!.ui!.setState({ cursor: 480 * 4 * 40, started: true }));
  await settled(page);
  await page.evaluate(() => window.__app!.session!.playback.play());
  await page.waitForFunction(() => window.__app!.ui!.getState().playing);
  const playing = await watch(4000);
  await page.evaluate(() => window.__app!.session!.playback.stop());
  note("playing", playing);
  // It redrew all the way through, and a redraw cost well under half a frame.
  expect(playing.draws.length).toBeGreaterThan(100);
  expect(median(playing.draws)).toBeLessThan(FRAME_BUDGET_MS / 2);

  // Dragging a note about: a preview each move, nothing written until it is let go.
  await settled(page);
  await page.evaluate(() => {
    const s = window.__app!.session!;
    const t = s.store.getState().project.tracks.find((x) => x.id === s.ui.getState().activeTrack)!;
    const n = t.kind === "notes" ? t.notes.find((x) => x.tick >= s.ui.getState().cursor + 480)! : null;
    s.ui.setState({ cursor: Math.floor((n!.tick - 480) / 120) * 120 });
  });
  await settled(page);
  const target = await page.evaluate(() => {
    const s = window.__app!.session!;
    const cursor = s.ui.getState().cursor;
    const t = s.store.getState().project.tracks.find((x) => x.id === s.ui.getState().activeTrack)!;
    const n = t.kind === "notes" ? t.notes.find((x) => x.tick >= cursor + 240)! : null;
    return { ...s.editor!.pointOf(n!.pitch, n!.tick + n!.dur / 2)!, id: n!.id, pitch: n!.pitch, tick: n!.tick };
  });
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  const watching = watch(3000);
  for (let i = 0; i < 120; i++) {
    await page.mouse.move(target.x + Math.sin(i / 8) * 50, target.y - 30 + Math.cos(i / 11) * 28);
    await page.waitForTimeout(12);
  }
  const dragging = await watching;
  await page.mouse.up();
  note("dragging a note", dragging);
  expect(dragging.draws.length).toBeGreaterThan(20);
  expect(median(dragging.draws)).toBeLessThan(FRAME_BUDGET_MS / 2);
  // The drag was real: the note is somewhere else now, in one undo step.
  const after = await page.evaluate((id) => {
    const notes = window.__app!.store!.getState().project.tracks.flatMap((t) => (t.kind === "notes" ? t.notes : []));
    const n = notes.find((x) => x.id === id)!;
    return { pitch: n.pitch, tick: n.tick, undo: window.__app!.store!.getState().undoLabel };
  }, target.id);
  expect([after.pitch, after.tick]).not.toEqual([target.pitch, target.tick]);
  expect(after.undo).toBe("Move 1 note");
});
