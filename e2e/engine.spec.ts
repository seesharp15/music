import { expect, test, type Page } from "@playwright/test";
import { bandSong, partsSong } from "./fixtures/band";
import { fixture, mockBank, needsSound, open, playerReady } from "./helpers";

/**
 * The audio engine and what the player gained on top of it in Stage 2: songs with tracks, drums and
 * tempo changes; swapping the song under a running transport; soloing; a count-in; notes played by
 * hand. `e2e/scheduling.spec.ts` is the guard that none of this moved a note of what Practice
 * already did; this file is about what is new.
 */
needsSound();

const MS = 0.001;
const SILENT = -80;
const AUDIBLE = -50;

/** Record what the player asks its sink for while it plays, for `forMs`. Times are audio-clock seconds. */
async function record(page: Page, forMs: number, before?: string) {
  return page.evaluate(
    async ({ forMs, before }) => {
      const { recordSink, audioNow } = await window.__app!.testing();
      const player = window.__app!.player!;
      player.pause();
      player.setLoop({ enabled: false });
      player.setRate(1);
      player.seek(0);
      const rec = recordSink(player, { silent: true });
      if (before) await new Function("player", `return (async () => { ${before} })()`)(player);
      else await player.play();
      const startedAt = audioNow();
      await new Promise((r) => setTimeout(r, forMs));
      const position = player.currentTime();
      player.pause();
      rec.stop();
      return { startedAt, position, calls: rec.calls };
    },
    { forMs, before },
  );
}

test.describe("a song with tracks, drums and a tempo change", () => {
  const band = bandSong();

  test.beforeEach(async ({ page }) => {
    await mockBank(page, [band as never]);
    await open(page, "#/play/u-band");
    await playerReady(page);
  });

  // ── Acceptance criterion 11, first half ──
  test("every note and drum hit is asked for within 5 ms of its compiled time", async ({ page }) => {
    const run = await record(page, 5200);
    const notes = run.calls.filter((c) => c.kind === "note");
    const drums = run.calls.filter((c) => c.kind === "drum");
    expect(notes).toHaveLength(band.notes.length);
    expect(drums).toHaveLength(band.drums!.hits.length);

    // Where "time zero" of the song fell on the audio clock, taken from the first note.
    const zero = notes[0].when - band.notes[0].time;
    expect(Math.abs(zero - run.startedAt)).toBeLessThan(40 * MS);
    let worst = 0;
    notes.forEach((c, i) => {
      const n = band.notes[i];
      expect([c.pitch, c.hand, c.track]).toEqual([n.pitch, n.hand, n.track]);
      expect(c.duration!).toBeCloseTo(n.duration, 5);
      worst = Math.max(worst, Math.abs(c.when - zero - n.time));
    });
    drums.forEach((c, i) => {
      const h = band.drums!.hits[i];
      expect([c.pad, c.velocity]).toEqual([h.pad, h.velocity]);
      worst = Math.max(worst, Math.abs(c.when - zero - h.time));
    });
    expect(worst).toBeLessThan(5 * MS);

    // The second bar is at 90: its eighth notes are a third of a second apart, not a quarter.
    const hats = drums.filter((c) => c.pad === "hat");
    expect(hats[1].when - hats[0].when).toBeCloseTo(2 / 3, 2);
  });

  test("each track's notes go to that track, on that track's sound", async ({ page }) => {
    const run = await record(page, 1500);
    const notes = run.calls.filter((c) => c.kind === "note");
    expect(notes.filter((c) => c.track === "melody").every((c) => c.sound === "bright" && c.hand === "R")).toBe(true);
    expect(notes.filter((c) => c.track === "bass").every((c) => c.sound === "soft" && c.hand === "L")).toBe(true);
    const mixer = await page.evaluate(() => {
      const { trackMix, drumMix, solo } = window.__app!.player!.state;
      return { trackMix, drumMix, solo };
    });
    // The mix the song was written with is where the player starts.
    expect(mixer).toEqual({
      trackMix: {
        melody: { volume: 0.9, muted: false },
        chords: { volume: 0.8, muted: false },
        bass: { volume: 0.7, muted: false },
      },
      drumMix: { volume: 0.8, muted: false },
      solo: null,
    });
  });

  test("Practice plays it: the screen opens, plays, and counts along through the tempo change", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "The Band" })).toBeVisible();
    await page.keyboard.press("Space");
    await expect.poll(() => page.evaluate(() => window.__app!.player!.currentTime())).toBeGreaterThan(0.5);
    await page.keyboard.press("Space");
    expect(await page.evaluate(() => window.__app!.player!.state.playing)).toBe(false);
  });

  test("the track mixer changes volume and mute, and ignores tracks that are not there", async ({ page }) => {
    const out = await page.evaluate(() => {
      const p = window.__app!.player!;
      let changes = 0;
      const stop = p.subscribe(() => changes++);
      p.setTrackMix("bass", { volume: 0.25 });
      p.setTrackMix("melody", { muted: true });
      p.setTrackMix("nope", { volume: 0.1 });
      p.setTrackMix("bass", { volume: 0.25 }); // no change
      p.setDrumMix({ volume: 2 }); // clamped
      p.solo("nope");
      p.solo("bass");
      stop();
      return { ...p.state.trackMix, drums: p.state.drumMix, solo: p.state.solo, changes };
    });
    expect(out).toEqual({
      melody: { volume: 0.9, muted: true },
      chords: { volume: 0.8, muted: false },
      bass: { volume: 0.25, muted: false },
      drums: { volume: 1, muted: false },
      solo: "bass",
      changes: 4,
    });
  });
});

// ── Acceptance criterion 11, second half ──
test("soloing a track silences the others, and letting go brings them back", async ({ page }) => {
  await open(page);
  const out = await page.evaluate(async (song) => {
    const { renderPlayed, levelDb } = await window.__app!.testing();
    const measure = async (solo: string | null, mute?: string) => {
      const r = await renderPlayed(song, {
        seconds: 8,
        steps: [
          {
            at: 0,
            do: (p) => {
              p.solo(solo);
              if (mute === "drums") p.setDrumMix({ muted: true });
              else if (mute) p.setTrackMix(mute, { muted: true });
            },
          },
        ],
      });
      return { melody: levelDb(r, 0.55, 1.45), bass: levelDb(r, 2.05, 2.95), drums: levelDb(r, 5.0, 5.9) };
    };
    return {
      all: await measure(null),
      melody: await measure("melody"),
      bass: await measure("bass"),
      mutedBass: await measure(null, "bass"),
      mutedDrums: await measure(null, "drums"),
    };
  }, partsSong());

  for (const part of ["melody", "bass", "drums"] as const)
    expect(out.all[part], `everything: ${part}`).toBeGreaterThan(AUDIBLE);
  expect(out.melody.melody).toBeGreaterThan(AUDIBLE);
  expect(out.melody.bass).toBeLessThan(SILENT);
  expect(out.melody.drums).toBeLessThan(SILENT);
  expect(out.bass.bass).toBeGreaterThan(AUDIBLE);
  expect(out.bass.melody).toBeLessThan(SILENT);
  expect(out.bass.drums).toBeLessThan(SILENT);
  // The soloed track is exactly as loud as it was in the full mix.
  expect(out.bass.bass).toBeCloseTo(out.all.bass, 1);
  // Muting is the other way round: one part gone, the rest untouched.
  expect(out.mutedBass.bass).toBeLessThan(SILENT);
  expect(out.mutedBass.melody).toBeCloseTo(out.all.melody, 1);
  expect(out.mutedDrums.drums).toBeLessThan(SILENT);
  expect(out.mutedDrums.bass).toBeCloseTo(out.all.bass, 1);
});

test("a track's volume follows the same law as a hand's: half way is 12 dB down", async ({ page }) => {
  await open(page);
  const out = await page.evaluate(async (song) => {
    const { renderOffline, levelDb } = await window.__app!.testing();
    const at = async (volume: number) =>
      levelDb(await renderOffline(song, { seconds: 4, trackMix: { bass: { volume, muted: false } } }), 2.05, 2.95);
    return { full: await at(1), half: await at(0.5) };
  }, partsSong());
  expect(out.full - out.half).toBeCloseTo(12.04, 0);
});

// ── Acceptance criterion 10 ──
test.describe("swapping the song under a running transport", () => {
  /**
   * Eight quarter notes at 120, one every half second from 0.5 s. The edit changes the song from
   * 2.0 s on: the note at 2.5 s is a different pitch, the one at 3.0 s is gone, and there is a new
   * one at 3.25 s. Everything before 2.0 s is the same in both.
   */
  const note = (pitch: number, time: number) => ({ pitch, time, duration: 0.4, hand: "R" as const, velocity: 0.8 });
  const original = {
    format: "piano-song/v1" as const,
    id: "swap",
    title: "Swap",
    bpm: 120,
    duration: 5,
    notes: [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4].map((t, i) => note(60 + i, t)),
  };
  const edited = {
    ...original,
    notes: [
      note(60, 0.5),
      note(61, 1),
      note(62, 1.5),
      note(63, 2),
      note(76, 2.5),
      note(71, 3.25),
      note(66, 3.5),
      note(67, 4),
    ],
  };
  const EDIT_POINT = 2.0;

  test("before the music reaches the edit: no gap, no doubled note, and it sounds exactly like the edited song", async ({
    page,
  }) => {
    await open(page);
    const out = await page.evaluate(
      async ({ original, edited }) => {
        const { renderPlayed, firstDifference, levelDb } = await window.__app!.testing();
        const swapped = await renderPlayed(original, {
          seconds: 6,
          steps: [{ at: 1.2, do: (p) => p.setSong(edited, { keepPosition: true }) }],
        });
        const clean = await renderPlayed(edited, { seconds: 6 });
        const notes = (r: typeof clean) =>
          r.calls
            .filter((c) => c.kind === "note")
            .map((c) => [c.pitch, Number(c.when.toFixed(6)), Number(c.duration!.toFixed(6))]);
        return {
          swapped: notes(swapped),
          clean: notes(clean),
          differsAt: firstDifference(swapped, clean),
          level: levelDb(clean, 0.5, 4.4),
          released: swapped.calls.filter((c) => c.kind === "release").length,
        };
      },
      { original, edited },
    );
    // Every note of the edited song, once, at its own time.
    expect(out.swapped).toEqual(out.clean);
    expect(out.swapped.map((n) => n[0])).toEqual([60, 61, 62, 63, 76, 71, 66, 67]);
    expect(out.swapped.map((n) => n[1])).toEqual([0.5, 1, 1.5, 2, 2.5, 3.25, 3.5, 4]);
    // And the sound is the same, sample for sample: nothing was cut off to make the change.
    expect(out.differsAt).toBeNull();
    expect(out.released).toBe(0);
    expect(out.level).toBeGreaterThan(AUDIBLE);
  });

  test("after the music has passed the edit: what differs from the edited song differs only after the edit point", async ({
    page,
  }) => {
    await open(page);
    const out = await page.evaluate(
      async ({ original, edited }) => {
        const { renderPlayed, firstDifference } = await window.__app!.testing();
        // Swapped at 2.7 s: the original's note at 2.5 s has already been played.
        const swapped = await renderPlayed(original, {
          seconds: 6,
          steps: [{ at: 2.7, do: (p) => p.setSong(edited, { keepPosition: true }) }],
        });
        const clean = await renderPlayed(edited, { seconds: 6 });
        const notes = (r: typeof clean) =>
          r.calls.filter((c) => c.kind === "note").map((c) => [c.pitch, Number(c.when.toFixed(6))]);
        return {
          swapped: notes(swapped),
          differsAt: firstDifference(swapped, clean),
          same: firstDifference(swapped, clean, 0) === firstDifference(swapped, clean, 1.9),
        };
      },
      { original, edited },
    );
    // The original's 2.5 s note (64) was played; from the swap on, the edited song's notes are.
    // The note at 3.0 s that the edit removed is not played, and nothing is played twice.
    expect(out.swapped).toEqual([
      [60, 0.5],
      [61, 1],
      [62, 1.5],
      [63, 2],
      [64, 2.5],
      [71, 3.25],
      [66, 3.5],
      [67, 4],
    ]);
    expect(out.differsAt).not.toBeNull();
    expect(out.differsAt!).toBeGreaterThanOrEqual(EDIT_POINT);
    expect(out.differsAt!).toBeGreaterThanOrEqual(2.5);
    expect(out.same).toBe(true);
  });

  test("live, in the app: the beat carries straight on through the swap", async ({ page }) => {
    await mockBank(page, [original as never]);
    await open(page, "#/play/swap");
    await playerReady(page);
    const out = await page.evaluate(async (edited) => {
      const { recordSink } = await window.__app!.testing();
      const player = window.__app!.player!;
      const rec = recordSink(player, { silent: true });
      await player.play();
      await new Promise((r) => setTimeout(r, 1200));
      const before = player.currentTime();
      player.setSong(edited, { keepPosition: true });
      const after = player.currentTime();
      await new Promise((r) => setTimeout(r, 3300));
      const playing = player.state.playing;
      player.pause();
      rec.stop();
      return {
        jump: after - before,
        playing,
        notes: rec.calls.filter((c) => c.kind === "note").map((c) => ({ pitch: c.pitch!, when: c.when })),
      };
    }, edited);
    expect(Math.abs(out.jump)).toBeLessThan(5 * MS);
    expect(out.playing).toBe(true);
    expect(out.notes.map((n) => n.pitch)).toEqual([60, 61, 62, 63, 76, 71, 66, 67]);
    const gaps = out.notes.slice(1).map((n, i) => n.when - out.notes[i].when);
    [0.5, 0.5, 0.5, 0.5, 0.75, 0.25, 0.5].forEach((expected, i) =>
      expect(Math.abs(gaps[i] - expected), `gap ${i}`).toBeLessThan(5 * MS),
    );
  });

  test("without keepPosition the new song starts from the top; a loop and the song's length follow the new song", async ({
    page,
  }) => {
    await mockBank(page, [original as never]);
    await open(page, "#/play/swap");
    await playerReady(page);
    const out = await page.evaluate(
      ({ edited }) => {
        const player = window.__app!.player!;
        player.seek(3);
        const wholeBefore = player.state.loop;
        player.setSong({ ...edited, duration: 8 }, { keepPosition: true });
        const kept = player.currentTime();
        const wholeAfter = player.state.loop;
        player.setLoop({ enabled: true, start: 6, end: 7.5 });
        player.setSong({ ...edited, duration: 4.5 }, { keepPosition: true });
        const clamped = { loop: player.state.loop, at: player.currentTime(), duration: player.duration };
        player.setSong(edited);
        return { wholeBefore, wholeAfter, kept, clamped, restarted: player.currentTime() };
      },
      { edited },
    );
    expect(out.wholeBefore).toEqual({ enabled: false, start: 0, end: 5 });
    expect(out.wholeAfter).toEqual({ enabled: false, start: 0, end: 8 });
    expect(out.kept).toBe(3);
    expect(out.clamped.duration).toBe(4.5);
    expect(out.clamped.loop.end).toBeLessThanOrEqual(4.5);
    expect(out.clamped.loop.end - out.clamped.loop.start).toBeGreaterThanOrEqual(0.25);
    expect(out.clamped.at).toBeLessThanOrEqual(4.5);
    expect(out.restarted).toBe(0);
  });
});

test.describe("count-in", () => {
  test.beforeEach(async ({ page }) => {
    await mockBank(page, [fixture("three-notes")]);
    await open(page, "#/play/three-notes");
    await playerReady(page);
  });

  test("a bar of clicks, accent first, then the music starts exactly a bar later", async ({ page }) => {
    // 120 BPM in 4/4: four clicks half a second apart, then the song's first note half a second in.
    const run = await record(page, 3200, "await player.play({ countInBars: 1 });");
    const clicks = run.calls.filter((c) => c.kind === "click");
    const notes = run.calls.filter((c) => c.kind === "note");
    expect(clicks.map((c) => c.accent)).toEqual([true, false, false, false]);
    expect(Math.abs(clicks[0].when - run.startedAt)).toBeLessThan(40 * MS);
    for (let i = 2; i < 4; i++) expect(Math.abs(clicks[i].when - clicks[i - 1].when - 0.5)).toBeLessThan(5 * MS);
    expect(notes.map((n) => n.pitch)).toEqual([60, 48]);
    // First note: two seconds of count-in after the second click's grid, then 0.5 s into the song.
    expect(Math.abs(notes[0].when - clicks[1].when - 2.0)).toBeLessThan(5 * MS);
    expect(Math.abs(run.position - 1.2)).toBeLessThan(0.1);
  });

  test("the playhead waits during the count, and the count follows the speed", async ({ page }) => {
    const out = await page.evaluate(async () => {
      const { recordSink } = await window.__app!.testing();
      const player = window.__app!.player!;
      player.setRate(0.5);
      const rec = recordSink(player, { silent: true });
      await player.play({ countInBars: 1 });
      const counting = player.state.countIn;
      await new Promise((r) => setTimeout(r, 1500));
      const during = { position: player.currentTime(), countIn: player.state.countIn };
      await new Promise((r) => setTimeout(r, 2900));
      const after = { position: player.currentTime(), countIn: player.state.countIn };
      player.pause();
      rec.stop();
      const clicks = rec.calls.filter((c) => c.kind === "click");
      return {
        counting,
        during,
        after,
        gaps: clicks.slice(2).map((c, i) => c.when - clicks[i + 1].when),
        clicks: clicks.length,
      };
    });
    expect(out.counting).toBe(true);
    expect(out.during).toEqual({ position: 0, countIn: true });
    // At half speed a beat lasts a second, so the bar of count-in lasts four.
    expect(out.clicks).toBe(4);
    out.gaps.forEach((g) => expect(Math.abs(g - 1)).toBeLessThan(5 * MS));
    expect(out.after.countIn).toBe(false);
    expect(out.after.position).toBeGreaterThan(0.1);
    expect(out.after.position).toBeLessThan(0.4);
  });

  test("pausing during the count leaves nothing waiting to sound", async ({ page }) => {
    const out = await page.evaluate(async () => {
      const { recordSink } = await window.__app!.testing();
      const player = window.__app!.player!;
      player.seek(0.45); // just before the first note
      const rec = recordSink(player, { silent: true });
      await player.play({ countInBars: 2 });
      await new Promise((r) => setTimeout(r, 700));
      player.pause();
      await new Promise((r) => setTimeout(r, 300));
      rec.stop();
      return {
        notes: rec.calls.filter((c) => c.kind === "note").length,
        state: { playing: player.state.playing, countIn: player.state.countIn },
        at: player.currentTime(),
      };
    });
    expect(out).toEqual({ notes: 0, state: { playing: false, countIn: false }, at: 0.45 });
  });

  test("a song with no tempo has nothing to count: it just starts", async ({ page }) => {
    const out = await page.evaluate(async () => {
      const player = window.__app!.player!;
      const song = {
        format: "piano-song/v1" as const,
        id: "free",
        title: "Free",
        duration: 3,
        notes: [{ pitch: 60, time: 0.5, duration: 0.5, hand: "R" as const }],
      };
      player.setSong(song);
      await player.play({ countInBars: 2 });
      const countIn = player.state.countIn;
      await new Promise((r) => setTimeout(r, 300));
      const at = player.currentTime();
      player.pause();
      return { countIn, at };
    });
    expect(out.countIn).toBe(false);
    expect(out.at).toBeGreaterThan(0.2);
  });
});

test.describe("playing by hand", () => {
  // ── Acceptance criterion 12 ──
  test("a note from a pointer event starts within one render quantum of the call", async ({ page }) => {
    await open(page);
    await page.evaluate(async () => {
      const { sharedEngine, listenForFirstSound } = await window.__app!.testing();
      const engine = sharedEngine();
      await engine.start();
      // A sound with a short tail, so each tap starts from silence.
      const ch = { hand: "R" as const, sound: "bright" as const };
      // What a screen with keys on it does when it appears.
      engine.prepare(ch);
      const listener = await listenForFirstSound(engine);
      const results = { engine: [] as unknown[], native: [] as unknown[] };
      (window as unknown as { results: typeof results }).results = results;
      const button = (id: string, left: number, down: () => void) => {
        const b = document.createElement("button");
        b.id = id;
        b.style.cssText = `position:fixed;top:80px;left:${left}px;width:100px;height:100px;z-index:9999`;
        b.addEventListener("pointerdown", down);
        document.body.append(b);
      };
      let pitch = 60;
      button("test-key", 20, () => {
        const p = pitch++;
        void listener
          .measure(() => engine.noteOn(p, 0.8, ch))
          .then((r) => {
            results.engine.push(r);
            engine.noteOff(p, ch);
          });
      });
      // The same, with nothing of ours in the way: a bare oscillator, started at once.
      button("test-native", 140, () => void listener.measureNative().then((r) => results.native.push(r)));
    });
    await page.waitForTimeout(1200);
    type Result = {
      calledAt: number;
      heardAt: number;
      blockAt: number;
      soundAt: number;
      quantum: number;
      wasQuiet: boolean;
    };
    const taps = 10;
    for (const [kind, x] of [
      ["engine", 70],
      ["native", 190],
    ] as const) {
      for (let i = 0; i < taps; i++) {
        await page.mouse.click(x, 130);
        await page.waitForFunction(
          ({ kind, n }) => (window as unknown as { results: Record<string, unknown[]> }).results[kind].length === n,
          { kind, n: i + 1 },
        );
        // Let the note die away, so the next one starts from silence: a second by the audio clock,
        // which on a busy machine runs slower than the wall clock a plain wait would count.
        await page.evaluate(async () => {
          const engine = (await window.__app!.testing()).sharedEngine();
          const until = engine.now() + 1;
          await new Promise<void>((resolve) => {
            const id = setInterval(() => {
              if (engine.now() < until) return;
              clearInterval(id);
              resolve();
            }, 20);
          });
        });
      }
    }
    const results = await page.evaluate(
      () => (window as unknown as { results: { engine: Result[]; native: Result[] } }).results,
    );
    const quantum = results.engine[0].quantum;
    expect(quantum).toBeCloseTo(128 / 44100, 3);
    for (const r of [...results.engine, ...results.native])
      expect(r.wasQuiet, "each measurement starts from silence").toBe(true);

    const ms = (xs: number[]) => xs.map((x) => (x * 1000).toFixed(2)).join(", ");
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const afterHeard = results.engine.map((r) => r.blockAt - r.heardAt);
    const afterCall = results.engine.map((r) => r.soundAt - r.calledAt);
    const nativeAfterCall = results.native.map((r) => r.soundAt - r.calledAt);
    console.log(`noteOn → sound, from the audio thread hearing of it, ms: ${ms(afterHeard)}`);
    console.log(`noteOn → sound, by the page's clock, ms: ${ms(afterCall)}`);
    console.log(`bare oscillator → sound, by the page's clock, ms: ${ms(nativeAfterCall)}`);

    test
      .info()
      .annotations.push({ type: "noteOn to sound, counted on the audio thread, ms", description: ms(afterHeard) });
    test.info().annotations.push({ type: "noteOn to sound, by the page's clock, ms", description: ms(afterCall) });
    test
      .info()
      .annotations.push({ type: "bare oscillator, by the page's clock, ms", description: ms(nativeAfterCall) });

    // 1. Counted on the audio thread: the note begins in the first render quantum that starts after
    //    the audio thread hears of the call. Nothing is asked for ahead of time, and nothing in the
    //    path delays it. (A tap now and then is later than that, when the machine running the test
    //    keeps the page waiting between hearing of the tap and asking for the note — which happens
    //    to the bare oscillator just as often. So: the typical tap, and nearly all of them.)
    const withinOne = (xs: number[]) => xs.filter((d) => d >= 0 && d <= quantum + 1e-6).length;
    expect(median(afterHeard)).toBeLessThanOrEqual(quantum + 1e-6);
    expect(withinOne(afterHeard)).toBeGreaterThanOrEqual(taps - 3);
    // 2. Counted on the page's clock, which can run behind the audio thread: the same, and no later
    //    than a bare oscillator started the same way.
    expect(median(afterCall)).toBeLessThanOrEqual(quantum + 1e-6);
    expect(median(afterCall)).toBeLessThanOrEqual(median(nativeAfterCall) + quantum + 1e-6);
    // 3. And never anything like a look-ahead: the scheduled path asks 150 ms ahead, Tone's own
    //    "now" 100 ms, and the limiter the live path avoids would add 6 ms to every note.
    expect(Math.max(...afterCall)).toBeLessThan(0.05);
  });

  test("a held key sounds until it is let go, and the same key twice does not double up", async ({ page }) => {
    await open(page);
    const out = await page.evaluate(async () => {
      const { renderEngine, levelDb, peakDb } = await window.__app!.testing();
      const r = await renderEngine(5, (engine) => {
        const ch = { hand: "R" as const };
        engine.noteOn(60, 0.8, ch, 0.5);
        engine.noteOff(60, ch, 1.5);
        // The same key struck twice without being let go in between.
        engine.noteOn(67, 0.8, ch, 2.5);
        engine.noteOn(67, 0.8, ch, 2.7);
        engine.noteOff(67, ch, 3.0);
        engine.noteOff(67, ch, 3.1); // a second key-up for nothing: ignored
        engine.noteOff(40, ch, 3.2); // a key that was never down: ignored
      });
      return {
        before: levelDb(r, 0, 0.45),
        held: levelDb(r, 1.0, 1.5),
        after: levelDb(r, 2.3, 2.5),
        second: levelDb(r, 2.75, 3.0),
        end: levelDb(r, 4.5, 5),
        peak: peakDb(r),
      };
    });
    expect(out.before).toBeLessThan(SILENT);
    expect(out.held).toBeGreaterThan(AUDIBLE);
    expect(out.after).toBeLessThan(SILENT);
    expect(out.second).toBeGreaterThan(AUDIBLE);
    expect(out.end).toBeLessThan(SILENT);
    expect(out.peak).toBeLessThan(0);
  });

  test("with the pedal down a key played by hand rings on after it is let go, until the pedal lifts", async ({
    page,
  }) => {
    await open(page);
    const out = await page.evaluate(async () => {
      const { renderEngine, levelDb } = await window.__app!.testing();
      const play = (sustain: boolean) =>
        renderEngine(
          6,
          (engine) => {
            engine.noteOn(60, 0.8, { hand: "R" }, 0.5);
            engine.noteOff(60, { hand: "R" }, 0.8);
            if (sustain) engine.damp(3); // the pedal lifting
          },
          { sustain },
        );
      const dry = await play(false);
      const wet = await play(true);
      return { dry: levelDb(dry, 1.8, 2.0), wet: levelDb(wet, 1.8, 2.0), lifted: levelDb(wet, 3.3, 3.6) };
    });
    expect(out.dry).toBeLessThan(-70);
    expect(out.wet).toBeGreaterThan(AUDIBLE);
    expect(out.lifted).toBeLessThan(SILENT);
  });

  test("played quietly, a note by hand is exactly as loud as the same note scheduled; played hard, a fistful does not clip", async ({
    page,
  }) => {
    await open(page);
    const out = await page.evaluate(async () => {
      const { renderEngine, levelDb, peakDb } = await window.__app!.testing();
      const ch = { hand: "R" as const };
      const byHand = await renderEngine(3, (engine) => {
        engine.noteOn(60, 0.7, ch, 0.5);
        engine.noteOff(60, ch, 1.5);
      });
      const scheduled = await renderEngine(3, (engine) => engine.play(60, 1, 0.7, ch, 0.5));
      // Ten keys at once, as hard as they go, on the loudest sound, in each hand.
      const fist = await renderEngine(
        3,
        (engine) => {
          for (const hand of ["L", "R"] as const) {
            for (let i = 0; i < 10; i++) engine.noteOn(48 + i * 2 + (hand === "R" ? 12 : 0), 1, { hand }, 0.5);
          }
        },
        { sound: "soft" },
      );
      // The limiter's 6 ms: the scheduled note is that much later than the one played by hand.
      const onset = (r: typeof byHand) => {
        for (let i = 0; i < r.left.length; i++) if (Math.abs(r.left[i]) > 1e-4) return i / r.sampleRate;
        return -1;
      };
      return {
        byHand: levelDb(byHand, 0.6, 1.4),
        scheduled: levelDb(scheduled, 0.6, 1.4),
        fistPeak: peakDb(fist),
        fistLevel: levelDb(fist, 0.5, 1),
        handOnset: onset(byHand),
        scheduledOnset: onset(scheduled),
      };
    });
    expect(out.byHand).toBeCloseTo(out.scheduled, 1);
    expect(out.fistPeak).toBeLessThan(0);
    expect(out.fistLevel).toBeGreaterThan(-12);
    // (Offline, a note asked for ahead of time starts at the next render quantum; live ones are asked for "now".)
    expect(out.handOnset).toBeGreaterThanOrEqual(0.5);
    expect(out.handOnset).toBeLessThan(0.5 + 129 / 44100);
    expect(out.scheduledOnset - out.handOnset).toBeGreaterThan(0.0055);
    expect(out.scheduledOnset - out.handOnset).toBeLessThan(0.0065);
  });

  test("notes played by hand follow the hand's volume, mute and side", async ({ page }) => {
    await open(page);
    const out = await page.evaluate(async () => {
      const { renderEngine, levelDb } = await window.__app!.testing();
      const play = async (set: (engine: Parameters<Parameters<typeof renderEngine>[1]>[0]) => void) => {
        const r = await renderEngine(2, (engine) => {
          engine.noteOn(60, 0.8, { hand: "L" }, 0.3); // the live path now exists
          set(engine);
          engine.noteOff(60, { hand: "L" }, 1.5);
        });
        const side = (ch: Float32Array) => {
          let sum = 0;
          const a = Math.floor(1.0 * r.sampleRate);
          const b = Math.floor(1.4 * r.sampleRate);
          for (let i = a; i < b; i++) sum += ch[i] * ch[i];
          return 10 * Math.log10(sum / (b - a) + 1e-20);
        };
        return { both: levelDb(r, 1.0, 1.4), left: side(r.left), right: side(r.right) };
      };
      return {
        full: await play(() => {}),
        half: await play((e) => e.setHandMix("L", { volume: 0.5, muted: false }, 0.5)),
        muted: await play((e) => e.setHandMix("L", { volume: 1, muted: true }, 0.5)),
        split: await play((e) => e.setStereoSplit(true)),
      };
    });
    expect(out.full.both - out.half.both).toBeCloseTo(12.04, 0);
    expect(out.muted.both).toBeLessThan(SILENT);
    expect(Math.abs(out.full.left - out.full.right)).toBeLessThan(0.5);
    // With the hands split, the left hand is mostly in the left ear.
    expect(out.split.left - out.split.right).toBeGreaterThan(6);
  });

  test("a track's notes played by hand go through that track's strip", async ({ page }) => {
    await open(page);
    const out = await page.evaluate(async () => {
      const { renderEngine, levelDb } = await window.__app!.testing();
      const at = async (muted: boolean) => {
        const r = await renderEngine(2, (engine) => {
          engine.setTrackMix("lead", { volume: 1, muted }, 0);
          engine.noteOn(72, 0.8, { hand: "R", track: "lead", sound: "bright" }, 0.2);
          engine.noteOff(72, { hand: "R", track: "lead", sound: "bright" }, 0.8);
        });
        return levelDb(r, 0.3, 0.8);
      };
      return { open: await at(false), muted: await at(true) };
    });
    expect(out.open).toBeGreaterThan(AUDIBLE);
    expect(out.muted).toBeLessThan(SILENT);
  });
});

test.describe("the synthesized drum kit", () => {
  const PADS = [
    "kick",
    "snare",
    "rim",
    "clap",
    "hat",
    "hatOpen",
    "hatPedal",
    "tomLow",
    "tomMid",
    "tomHigh",
    "crash",
    "ride",
    "shaker",
    "tamb",
    "cowbell",
    "perc",
  ] as const;

  test("every pad makes a sound, none of them clips, and nothing is downloaded", async ({ page }) => {
    const fetched: string[] = [];
    await open(page);
    page.on("request", (r) => fetched.push(r.url()));
    const out = await page.evaluate(async (pads) => {
      const { renderEngine, levelDb, peakDb } = await window.__app!.testing();
      const r = await renderEngine(pads.length * 2 + 2, (engine) =>
        pads.forEach((pad, i) => engine.drum(pad, 1, 0.5 + i * 2)),
      );
      return {
        before: levelDb(r, 0, 0.45),
        levels: Object.fromEntries(pads.map((pad, i) => [pad, levelDb(r, 0.5 + i * 2, 0.6 + i * 2)])),
        peaks: Object.fromEntries(pads.map((pad, i) => [pad, peakDb(r, 0.5 + i * 2, 2.5 + i * 2)])),
        // All sixteen at the very same instant, as loud as they go.
        together: peakDb(await renderEngine(3, (engine) => pads.forEach((pad) => engine.drum(pad, 1, 0.5)))),
      };
    }, PADS);
    expect(out.before).toBeLessThan(SILENT);
    for (const pad of PADS) {
      expect(out.levels[pad], `${pad} sounds`).toBeGreaterThan(AUDIBLE);
      expect(out.peaks[pad], `${pad} does not clip`).toBeLessThan(-1);
    }
    expect(out.together).toBeLessThan(0);
    expect(fetched.filter((u) => !u.startsWith("http://localhost") && !u.startsWith("blob:"))).toEqual([]);
  });

  test("the drum mix turns the kit down and off, and a pad struck twice at once is two hits, not an error", async ({
    page,
  }) => {
    await open(page);
    const out = await page.evaluate(async () => {
      const { renderEngine, levelDb } = await window.__app!.testing();
      const at = async (mix: { volume: number; muted: boolean }) => {
        const r = await renderEngine(2, (engine) => {
          engine.setDrumMix(mix, 0);
          engine.drum("snare", 1, 0.5);
          engine.drum("snare", 1, 0.5);
          engine.drum("kick", 1, 0.5);
        });
        return levelDb(r, 0.5, 0.7);
      };
      return {
        full: await at({ volume: 1, muted: false }),
        half: await at({ volume: 0.5, muted: false }),
        muted: await at({ volume: 1, muted: true }),
      };
    });
    expect(out.full).toBeGreaterThan(-35);
    expect(out.full - out.half).toBeGreaterThan(8);
    expect(out.muted).toBeLessThan(SILENT);
  });
});

test("the engine is one for the page: it outlives a song, and a second song leaves nothing of the first behind", async ({
  page,
}) => {
  await mockBank(page, [bandSong() as never, fixture("three-notes")]);
  await open(page, "#/play/u-band");
  await playerReady(page);
  const first = await page.evaluate(async () => {
    const { sharedEngine } = await window.__app!.testing();
    const engine = sharedEngine();
    const player = window.__app!.player!;
    await player.play();
    await new Promise((r) => setTimeout(r, 1200));
    player.pause();
    return { strips: engine.inspect().strips, latency: engine.latency(), now: engine.now() };
  });
  expect(first.strips).toEqual(["bass:L", "melody:R"]);
  expect(first.latency).toBeGreaterThanOrEqual(0);
  expect(first.latency).toBeLessThan(1);
  expect(first.now).toBeGreaterThan(1);

  // On to another song, within the same page: the engine stays, the band's tracks go.
  const second = await page.evaluate(async () => {
    const { sharedEngine } = await window.__app!.testing();
    const engine = sharedEngine();
    window.location.hash = "#/play/three-notes";
    await new Promise<void>((resolve) => {
      const check = () =>
        window.__app!.player && window.__app!.player.duration < 3.5 ? resolve() : setTimeout(check, 20);
      check();
    });
    const player = window.__app!.player!;
    await player.play();
    await new Promise((r) => setTimeout(r, 1200));
    player.pause();
    return { same: engine === sharedEngine(), ...engine.inspect() };
  });
  expect(second.same).toBe(true);
  expect(second.strips).toEqual([]);
  // Only the two hands' own instruments are left.
  expect(second.instruments).toEqual([":L:clear", ":R:clear"]);
});
