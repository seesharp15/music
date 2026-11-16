import { describe, expect, it } from "vitest";
import divenireJson from "../../public/songs/divenire.json";
import rewriteJson from "../../public/songs/rewrite-the-stars.json";
import { beatMapOf, isDownbeat } from "./beatmap";
import { normalize } from "./normalize";
import { analyzeRhythm, barAt, barsFrom, cellAt, cellTime, positionOf, type Rhythm } from "./rhythm";
import type { Song } from "./types";

/**
 * Acceptance criterion 2, as arithmetic. Practice now counts beats through a BeatMap. For a song at
 * one tempo with its first beat at zero, everything it works out must be the same as before — not
 * close: the same bits. Below is the arithmetic exactly as it stood in `src/song/rhythm.ts`,
 * `RhythmMap.tsx`, `Stage.tsx`, `Trimmer.tsx`, `Coach.tsx`, `Practice.tsx` and `player.ts` before the
 * change, frozen, and every result of the new code is compared with it by `Object.is`.
 */
const before = {
  analyze(song: Song) {
    const beat = 60 / (song.bpm ?? 120);
    const perBar = song.timeSignature?.[0] ?? 4;
    const moments: { time: number }[] = [];
    for (const n of song.notes) {
      const m = moments[moments.length - 1];
      if (!m || n.time - m.time > 0.03) moments.push({ time: n.time });
    }
    const eighth = beat / 2;
    const offGrid = moments.filter((m) => Math.abs(m.time / eighth - Math.round(m.time / eighth)) > 0.25).length;
    const sub = offGrid > moments.length * 0.05 ? 4 : 2;
    return { beat, perBar, sub, cell: beat / sub };
  },
  positionOf(r: { cell: number; perBar: number; sub: number }, t: number) {
    const cellIdx = Math.round(t / r.cell);
    const cellsPerBar = r.perBar * r.sub;
    const bar = Math.floor(cellIdx / cellsPerBar) + 1;
    const inBar = ((cellIdx % cellsPerBar) + cellsPerBar) % cellsPerBar;
    const beatInBar = Math.floor(inBar / r.sub) + 1;
    const subName = (r.sub === 2 ? ["", "&"] : ["", "e", "&", "a"])[inBar % r.sub];
    return { bar, beatInBar, label: `${beatInBar}${subName}` };
  },
  // RhythmMap.tsx
  lastBar: (r: { beat: number; perBar: number }, duration: number) =>
    Math.max(0, Math.floor(duration / (r.beat * r.perBar))),
  momentCell: (r: { cell: number }, time: number) => Math.round(time / r.cell),
  cellTime: (r: { cell: number }, idx: number) => idx * r.cell,
  barUnderPlayhead: (r: { beat: number; perBar: number }, t: number) => Math.floor((t + 1e-3) / (r.beat * r.perBar)),
  cellUnderPlayhead: (r: { cell: number }, t: number) => Math.floor((t + 1e-3) / r.cell),
  // Coach.tsx (two bars) and Practice.tsx (four)
  loopFrom(r: { beat: number; perBar: number }, t: number, bars: number) {
    const barLen = r.beat * r.perBar;
    const start = Math.floor(t / barLen) * barLen;
    return { start, end: start + bars * barLen };
  },
  // Stage.tsx: the beat lines visible from time t, as [time, is a bar line].
  stageLines(song: Song, t: number, visible: number) {
    const beat = song.bpm ? 60 / song.bpm : 0;
    const beatsPerBar = song.timeSignature?.[0] ?? 4;
    const out: [number, boolean][] = [];
    if (beat > 0)
      for (let b = Math.floor(t / beat); b * beat < t + visible; b++) out.push([b * beat, b % beatsPerBar === 0]);
    return out;
  },
  // Trimmer.tsx: the beat lines in a view, as [time, is a bar line, bar number], and the px-per-beat it gates on.
  trimmerLines(song: Song, view: { start: number; end: number }, w: number) {
    const out: [number, boolean, string][] = [];
    if (!song.bpm) return { out, pxPerBeat: null as number | null };
    const beat = 60 / song.bpm;
    const perBar = song.timeSignature?.[0] ?? 4;
    const pxPerBeat = (beat / (view.end - view.start)) * w;
    for (let b = Math.floor(view.start / beat); b * beat <= view.end; b++)
      out.push([b * beat, b % perBar === 0, String(b / perBar + 1)]);
    return { out, pxPerBeat };
  },
  // player.ts: the clicks scheduled for a window of song time, as [time, accent].
  clicks(song: Song, scheduledUpTo: number, windowEnd: number) {
    const out: [number, boolean][] = [];
    if (!song.bpm) return out;
    const beat = 60 / song.bpm;
    const perBar = song.timeSignature?.[0] ?? 4;
    for (let b = Math.ceil(scheduledUpTo / beat - 1e-6); b * beat < windowEnd; b++)
      out.push([b * beat, b % perBar === 0]);
    return out;
  },
};

/** The same things, as the code now works them out. */
const after = {
  stageLines(r: Rhythm, t: number, visible: number) {
    const out: [number, boolean][] = [];
    const beats = r.beats;
    if (beats) {
      for (let b = Math.floor(beats.beatAt(t)); beats.secondsAt(b) < t + visible; b++) {
        out.push([beats.secondsAt(b), isDownbeat(b, beats.beatsPerBar)]);
      }
    }
    return out;
  },
  trimmerLines(song: Song, view: { start: number; end: number }, w: number) {
    const out: [number, boolean, string][] = [];
    const beats = beatMapOf(song);
    if (!beats) return { out, pxPerBeat: null as number | null };
    const perBar = beats.beatsPerBar;
    const from = Math.floor(beats.beatAt(view.start));
    const at = song.tempoMap?.length ? from : 0;
    const pxPerBeat = ((beats.secondsAt(at + 1) - beats.secondsAt(at)) / (view.end - view.start)) * w;
    for (let b = from; beats.secondsAt(b) <= view.end; b++)
      out.push([beats.secondsAt(b), isDownbeat(b, perBar), String(b / perBar + 1)]);
    return { out, pxPerBeat };
  },
  clicks(song: Song, scheduledUpTo: number, windowEnd: number) {
    const out: [number, boolean][] = [];
    const beats = beatMapOf(song);
    if (!beats) return out;
    for (let b = Math.ceil(beats.beatAt(scheduledUpTo) - 1e-6); beats.secondsAt(b) < windowEnd; b++) {
      out.push([beats.secondsAt(b), isDownbeat(b, beats.beatsPerBar)]);
    }
    return out;
  },
};

/** Exactly the same value: the same bits, not merely close. */
function same(a: unknown, b: unknown, what: string) {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) throw new Error(`${what}: ${a.length} items became ${b.length}`);
    a.forEach((x, i) => same(x, b[i], `${what}[${i}]`));
  } else if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${what}.${k}`);
    }
  } else if (!Object.is(a, b)) {
    throw new Error(`${what}: ${String(a)} became ${String(b)}`);
  }
}

const rewrite = normalize(rewriteJson as unknown as Song);
const divenire = normalize(divenireJson as unknown as Song);
const fixtures: [string, Song][] = [
  ["Rewrite the Stars (125 BPM)", rewrite],
  ["a waltz at an awkward tempo", { ...rewrite, bpm: 97.3, timeSignature: [3, 4] }],
  ["Divenire with a tempo imagined for it", { ...divenire, bpm: 61.3 }],
];

describe.each(fixtures)("%s: nothing Practice works out has changed", (_name, song) => {
  const old = before.analyze(song);
  const now = analyzeRhythm(song);
  // Every moment of the song, every millisecond of its first two minutes, and every bar and cell line.
  const times = [
    ...now.moments.map((m) => m.time),
    ...Array.from({ length: 120_000 }, (_, i) => i / 1000),
    ...Array.from({ length: 2000 }, (_, i) => i * old.cell),
    ...Array.from({ length: 200 }, (_, i) => i * old.beat * old.perBar),
    song.duration!,
  ];

  it("the beat, the bar, and whether it counts in eighths or sixteenths", () => {
    same({ beat: now.beat, perBar: now.perBar, sub: now.sub, cell: now.cell }, old, "rhythm");
    expect(now.even).toBe(true);
  });

  it("the bar and count of every moment — the labels of the rhythm map and of step-through", () => {
    for (const t of times) same(positionOf(now, t), before.positionOf(old, t), `positionOf(${t})`);
  });

  it("the rhythm map: which cell each note is in, when each cell is, and what is under the playhead", () => {
    same(Math.max(0, Math.floor(barAt(now, song.duration!))), before.lastBar(old, song.duration!), "last bar");
    for (const m of now.moments)
      same(Math.round(cellAt(now, m.time)), before.momentCell(old, m.time), `cell of ${m.time}`);
    for (let idx = 0; idx < 3000; idx++) same(cellTime(now, idx), before.cellTime(old, idx), `time of cell ${idx}`);
    for (const t of times) {
      same(Math.floor(barAt(now, t + 1e-3)), before.barUnderPlayhead(old, t), `bar under ${t}`);
      same(Math.floor(cellAt(now, t + 1e-3)), before.cellUnderPlayhead(old, t), `cell under ${t}`);
    }
  });

  it("the default loops: two bars for the coach, four for the Loop button", () => {
    for (const t of times) {
      same(barsFrom(now, t, 2), before.loopFrom(old, t, 2), `two bars from ${t}`);
      same(barsFrom(now, t, 4), before.loopFrom(old, t, 4), `four bars from ${t}`);
    }
  });

  it("the beat lines in the waterfall", () => {
    for (let t = 0; t < 60; t += 0.0137)
      same(after.stageLines(now, t, 4), before.stageLines(song, t, 4), `lines at ${t}`);
  });

  it("the beat lines and bar numbers in the trimmer, at every zoom", () => {
    for (const [start, end] of [
      [0, song.duration!],
      [0, 30],
      [15.36, 38.4],
      [61.44, 63.1],
      [100.003, 101.997],
    ]) {
      same(
        after.trimmerLines(song, { start, end }, 390),
        before.trimmerLines(song, { start, end }, 390),
        `view ${start}–${end}`,
      );
    }
  });

  it("the metronome: every click of the song, as the scheduler asks for them window by window", () => {
    // The scheduler asks 150 ms ahead every 25 ms; at other speeds the windows fall elsewhere.
    for (const step of [0.025, 0.0125, 0.05, 0.0312]) {
      const was: [number, boolean][] = [];
      const is: [number, boolean][] = [];
      for (let upTo = 0; upTo < 30; upTo += step) {
        was.push(...before.clicks(song, upTo, upTo + step));
        is.push(...after.clicks(song, upTo, upTo + step));
      }
      same(is, was, `clicks, windows of ${step}`);
      expect(is.length).toBeGreaterThan(20);
    }
  });
});

describe("a song played freely still has no grid", () => {
  it("Divenire: no beat map, so no rhythm map, no beat lines and no metronome", () => {
    const r = analyzeRhythm(divenire);
    expect(r.beats).toBeNull();
    expect(beatMapOf(divenire)).toBeNull();
    expect(after.stageLines(r, 10, 4)).toEqual([]);
    expect(after.trimmerLines(divenire, { start: 0, end: 30 }, 390).out).toEqual([]);
    expect(after.clicks(divenire, 0, 30)).toEqual([]);
    // Step-through still names positions on the nominal grid it always used.
    same({ beat: r.beat, perBar: r.perBar, sub: r.sub, cell: r.cell }, before.analyze(divenire), "rhythm");
    for (const m of r.moments.slice(0, 500))
      same(positionOf(r, m.time), before.positionOf(r, m.time), `positionOf(${m.time})`);
  });
});

describe("a song whose tempo moves, or whose first downbeat comes late, is counted where its beats really are", () => {
  // 120 for two bars (4 s), then 60.
  const moving: Song = {
    format: "piano-song/v2",
    id: "m",
    title: "M",
    bpm: 120,
    tempoMap: [
      { time: 0, bpm: 120 },
      { time: 4, bpm: 60 },
    ],
    duration: 12,
    notes: [0, 0.5, 1, 1.5, 4, 5, 6, 7, 8].map((time) => ({ pitch: 60, time, duration: 0.2, hand: "R" as const })),
  };
  const r = analyzeRhythm(moving);

  it("bars and counts follow the tempo", () => {
    expect(r.even).toBe(false);
    expect(positionOf(r, 3.5)).toEqual({ bar: 2, beatInBar: 4, label: "4" });
    expect(positionOf(r, 4)).toEqual({ bar: 3, beatInBar: 1, label: "1" });
    expect(positionOf(r, 5)).toEqual({ bar: 3, beatInBar: 2, label: "2" });
    expect(positionOf(r, 5.5)).toEqual({ bar: 3, beatInBar: 2, label: "2&" });
    expect(positionOf(r, 8)).toEqual({ bar: 4, beatInBar: 1, label: "1" });
    expect(Math.floor(barAt(r, 7.99))).toBe(2);
    expect(cellTime(r, 16)).toBeCloseTo(4, 12); // the first cell of bar 3
    expect(cellTime(r, 18)).toBeCloseTo(5, 12);
    expect(barsFrom(r, 5, 2)).toEqual({ start: 4, end: 12 });
    expect(barsFrom(r, 1, 2)).toEqual({ start: 0, end: 4 });
  });

  it("beat lines and clicks follow it too", () => {
    expect(after.stageLines(r, 3, 4).map(([t, bar]) => [Number(t.toFixed(9)), bar])).toEqual([
      [3, false],
      [3.5, false],
      [4, true],
      [5, false],
      [6, false],
    ]);
    expect(after.clicks(moving, 3.4, 6.1).map(([t, accent]) => [Number(t.toFixed(9)), accent])).toEqual([
      [3.5, false],
      [4, true],
      [5, false],
      [6, false],
    ]);
  });

  it("with a late first downbeat, bar 1 starts there and what comes before is the pickup", () => {
    const pickup: Song = {
      format: "piano-song/v2",
      id: "p",
      title: "P",
      bpm: 120,
      gridOffset: 0.5,
      duration: 6,
      notes: [
        { pitch: 60, time: 0, duration: 0.4, hand: "R" },
        { pitch: 62, time: 0.5, duration: 0.4, hand: "R" },
      ],
    };
    const rp = analyzeRhythm(pickup);
    expect(rp.even).toBe(false);
    expect(positionOf(rp, 0.5)).toEqual({ bar: 1, beatInBar: 1, label: "1" });
    expect(positionOf(rp, 0)).toEqual({ bar: 0, beatInBar: 4, label: "4" });
    expect(after.clicks(pickup, 0, 1.1).map(([t, accent]) => [Number(t.toFixed(9)), accent])).toEqual([
      [0, false],
      [0.5, true],
      [1, false],
    ]);
    expect(barsFrom(rp, 0.6, 1)).toEqual({ start: 0.5, end: 2.5 });
  });
});
