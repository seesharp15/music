import { describe, expect, it } from "vitest";
import { makeTimeMap } from "../../music/time";
import { newProject } from "../../project/new";
import { applyOps } from "../../project/ops";
import type { NoteTrack, Project } from "../../project/types";
import { beatLine, chordTicks, setChord, untouched, writeToTrack } from "./edit";

const BAR = 1920;
const base = () => newProject({ id: "p" });
const chordsOf = (p: Project) => p.chords.map((c) => [c.symbol, c.tick, c.dur]);
const track = (p: Project) => (p.tracks.find((t) => t.id === "chords") as NoteTrack).notes;
const triples = (p: Project) => track(p).map((n) => [n.pitch, n.tick, n.dur]);

function set(p: Project, tick: number, dur: number, symbol: string | null, rewrite = false): Project {
  const edit = setChord(p, tick, dur, symbol, { rewrite });
  if (!edit) throw new Error(`not a chord: ${symbol}`);
  return applyOps(p, edit.ops);
}
function write(p: Project, mode: "hold" | "bar" | "beat" = "hold"): Project {
  const w = writeToTrack(p, mode)!;
  return applyOps(p, w.ops);
}
const progression = (symbols: string[]) => symbols.reduce((p, s, i) => set(p, i * BAR, BAR, s), base());

describe("setting a chord", () => {
  it("puts it at a place for a length, in the kernel's spelling", () => {
    const p = set(set(base(), 0, BAR, "C"), BAR, BAR / 2, "A-7");
    expect(chordsOf(p)).toEqual([
      ["C", 0, BAR],
      ["Am7", BAR, BAR / 2],
    ]);
    expect(p.chords.every((c) => c.origin === "manual")).toBe(true);
    expect(setChord(base(), 0, BAR, "not a chord")).toBeNull();
  });

  it("replaces a chord that starts where it does", () => {
    expect(chordsOf(set(progression(["C", "F"]), BAR, BAR, "G7"))).toEqual([
      ["C", 0, BAR],
      ["G7", BAR, BAR],
    ]);
  });

  it("cuts short a chord running in from before, and keeps the tail of one running on after", () => {
    const long = set(base(), 0, 4 * BAR, "C");
    expect(chordsOf(set(long, BAR, BAR, "F"))).toEqual([
      ["C", 0, BAR],
      ["F", BAR, BAR],
      ["C", 2 * BAR, 2 * BAR],
    ]);
    // Over the join of two chords: both give way.
    expect(chordsOf(set(progression(["C", "F"]), BAR / 2, BAR, "G"))).toEqual([
      ["C", 0, BAR / 2],
      ["G", BAR / 2, BAR],
      ["F", BAR + BAR / 2, BAR / 2],
    ]);
  });

  it("leaves a neighbour that only touches it alone", () => {
    expect(chordsOf(set(progression(["C", "F", "G"]), BAR, BAR, "Am"))).toEqual([
      ["C", 0, BAR],
      ["Am", BAR, BAR],
      ["G", 2 * BAR, BAR],
    ]);
  });

  it("removing clears that stretch and nothing else", () => {
    expect(chordsOf(set(progression(["C", "F", "G"]), BAR, BAR, null))).toEqual([
      ["C", 0, BAR],
      ["G", 2 * BAR, BAR],
    ]);
    expect(chordsOf(set(set(base(), 0, 2 * BAR, "C"), 0, BAR, null))).toEqual([["C", BAR, BAR]]);
  });

  it("every result passes the project's own rules: no overlaps, in order", () => {
    let p = base();
    const moves: [number, number, string | null][] = [
      [0, 4 * BAR, "C"],
      [BAR, BAR, "F"],
      [480, 480, "G7"],
      [3 * BAR + 960, BAR, "Am"],
      [0, 480, null],
      [BAR - 240, 480, "Dm"],
    ];
    for (const [tick, dur, symbol] of moves) {
      p = set(p, tick, dur, symbol);
      for (let i = 1; i < p.chords.length; i++) {
        expect(p.chords[i].tick).toBeGreaterThanOrEqual(p.chords[i - 1].tick + p.chords[i - 1].dur);
      }
    }
    expect(p.chords.length).toBeGreaterThan(4);
  });
});

describe("Write to track", () => {
  it("writes each chord as a block chord on the Chords track, as the author's own notes", () => {
    const p = write(progression(["C", "F", "C", "G", "C"]));
    expect(track(p)).toHaveLength(15);
    expect(triples(p).slice(0, 6)).toEqual([
      [48, 0, BAR],
      [52, 0, BAR],
      [55, 0, BAR],
      [48, BAR, BAR],
      [53, BAR, BAR],
      [57, BAR, BAR],
    ]);
    expect(track(p).every((n) => n.origin === "manual")).toBe(true);
    const w = writeToTrack(progression(["C", "F"]), "hold")!;
    expect(w).toMatchObject({ trackId: "chords", written: 2, kept: 0 });
  });

  it("written again, it replaces what it wrote rather than piling more on top", () => {
    const once = write(progression(["C", "F"]));
    const again = write(once, "beat");
    expect(track(again)).toHaveLength(24);
    expect(track(write(again, "hold"))).toHaveLength(6);
  });

  it("leaves alone a chord whose notes the author has changed", () => {
    const p = write(progression(["C", "F"]));
    const edited = applyOps(p, [
      { op: "shiftNotes", trackId: "chords", ids: [track(p)[0].id], ticks: 0, semitones: -12 },
    ]);
    const w = writeToTrack(edited, "beat")!;
    expect(w).toMatchObject({ written: 1, kept: 1 });
    const after = applyOps(edited, w.ops);
    expect(triples(after).filter(([, tick]) => tick < BAR)).toEqual([
      [36, 0, BAR],
      [52, 0, BAR],
      [55, 0, BAR],
    ]);
    expect(track(after).filter((n) => n.tick >= BAR)).toHaveLength(12);
  });

  it("has nothing to do without chords, or without an unlocked Chords track", () => {
    expect(writeToTrack(base(), "hold")).toBeNull();
    const locked = applyOps(progression(["C"]), [{ op: "patchTrack", trackId: "chords", patch: { locked: true } }]);
    expect(writeToTrack(locked, "hold")).toBeNull();
  });
});

// ── Acceptance criterion 7 ──
describe("changing a chord under notes on the track", () => {
  const written = () => write(progression(["C", "F", "C"]));

  it("rewrites them when they are still exactly what Write to track wrote", () => {
    const p = written();
    expect(untouched(p, p.chords[1])).toBe("hold");
    const edit = setChord(p, BAR, BAR, "Dm", { rewrite: true })!;
    expect(edit.rewrote).toBe(true);
    const after = applyOps(p, edit.ops);
    expect(chordsOf(after)[1]).toEqual(["Dm", BAR, BAR]);
    const bar2 = triples(after).filter(([, tick]) => tick === BAR);
    expect(bar2.map(([pitch]) => pitch % 12).sort((a, b) => a - b)).toEqual([2, 5, 9]);
    expect(bar2.every(([, , dur]) => dur === BAR)).toBe(true);
    // The other bars' notes are not touched.
    expect(triples(after).filter(([, tick]) => tick !== BAR)).toEqual(triples(p).filter(([, tick]) => tick !== BAR));
    // And the new notes are, in turn, recognised as written.
    expect(untouched(after, after.chords[1])).toBe("hold");
  });

  it("keeps the way they were struck", () => {
    const p = write(progression(["C", "F"]), "beat");
    const after = applyOps(p, setChord(p, BAR, BAR, "G", { rewrite: true })!.ops);
    const bar2 = track(after).filter((n) => n.tick >= BAR);
    expect(bar2).toHaveLength(12);
    expect(bar2.every((n) => n.dur === 480)).toBe(true);
  });

  it("leaves them alone when the author has edited them", () => {
    const p = written();
    const mine = applyOps(p, [
      { op: "patchNotes", trackId: "chords", ids: [track(p).find((n) => n.tick === BAR)!.id], patch: { dur: 960 } },
    ]);
    expect(untouched(mine, mine.chords[1])).toBeNull();
    const edit = setChord(mine, BAR, BAR, "Dm", { rewrite: true })!;
    expect(edit.rewrote).toBe(false);
    const after = applyOps(mine, edit.ops);
    expect(chordsOf(after)[1]).toEqual(["Dm", BAR, BAR]);
    expect(triples(after)).toEqual(triples(mine));
  });

  it("leaves them alone when rewriting was not asked for, or the chord was not written out at all", () => {
    const p = written();
    expect(setChord(p, BAR, BAR, "Dm")!.rewrote).toBe(false);
    expect(triples(applyOps(p, setChord(p, BAR, BAR, "Dm")!.ops))).toEqual(triples(p));
    const bare = progression(["C", "F"]);
    expect(setChord(bare, BAR, BAR, "Dm", { rewrite: true })!.rewrote).toBe(false);
  });
});

describe("places and lengths", () => {
  const four = makeTimeMap([{ tick: 0, bpm: 100 }], [{ tick: 0, numerator: 4, denominator: 4 }]);
  const six = makeTimeMap([{ tick: 0, bpm: 100 }], [{ tick: 0, numerator: 6, denominator: 8 }]);
  const three = makeTimeMap([{ tick: 0, bpm: 100 }], [{ tick: 0, numerator: 3, denominator: 4 }]);
  it("a bar, half a bar and a beat follow the meter", () => {
    expect([chordTicks(four, 0, "bar"), chordTicks(four, 0, "half"), chordTicks(four, 0, "beat")]).toEqual([
      1920, 960, 480,
    ]);
    expect([chordTicks(six, 0, "bar"), chordTicks(six, 0, "half"), chordTicks(six, 0, "beat")]).toEqual([
      1440, 720, 240,
    ]);
    // Three beats do not halve: half a bar is two of them.
    expect(chordTicks(three, 0, "half")).toBe(960);
  });
  it("a tap on the gutter lands on the beat line at or before it", () => {
    expect(beatLine(four, 0)).toBe(0);
    expect(beatLine(four, 1919)).toBe(1440);
    expect(beatLine(four, 2000)).toBe(1920);
    expect(beatLine(six, 500)).toBe(480);
  });
});
