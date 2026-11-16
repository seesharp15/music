/**
 * Seeded random edits, for property tests: the same seed gives the same edits on every run.
 * Every op `randomOp` returns is valid for the project it is given.
 */
import { DRUM_PADS } from "../../song/ids";
import type { DrumTrack, EditOp, NoteTrack, Origin, Project } from "../types";

export type Rng = () => number;

/** Mulberry32: small, fast, and good enough to shuffle test cases. */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T>(r: Rng, list: readonly T[]): T => list[Math.floor(r() * list.length)];
const some = <T>(r: Rng, list: readonly T[], max: number): T[] => {
  const n = Math.min(list.length, int(r, 1, max));
  const pool = [...list];
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  return out;
};

const ORIGINS: Origin[] = ["manual", "played", "tapped", "hummed", "imported", "suggested"];
const CHORDS = ["C", "Am7", "F/A", "G7b9", "Dm", "Ebmaj7", "Bbsus4", "F#m7b5"];
const GRID = 120;

const note = (r: Rng) => ({
  pitch: int(r, 21, 108),
  tick: int(r, 0, 63) * GRID,
  dur: int(r, 1, 8) * GRID,
  vel: int(r, 1, 10) / 10,
  origin: pick(r, ORIGINS),
  ...(r() < 0.3 ? { offset: int(r, -20, 20) } : {}),
});

const hit = (r: Rng) => ({
  pad: pick(r, DRUM_PADS),
  tick: int(r, 0, 63) * GRID,
  vel: int(r, 1, 10) / 10,
  origin: pick(r, ORIGINS),
});

/** One valid edit for this project. `n` makes generated ids unique: pass a counter. */
export function randomOp(p: Project, r: Rng, n: number): EditOp {
  const open = p.tracks.filter((t) => !t.locked);
  const noteTracks = open.filter((t): t is NoteTrack => t.kind === "notes");
  const drumTracks = open.filter((t): t is DrumTrack => t.kind === "drums");
  const withNotes = noteTracks.filter((t) => t.notes.length);
  const withHits = drumTracks.filter((t) => t.hits.length);
  const withPatterns = drumTracks.filter((t) => t.patterns.length);
  const withClips = drumTracks.filter((t) => t.clips.length);
  const locked = p.tracks.filter((t) => t.locked);

  // Each entry is tried only if the project has what it needs; otherwise the next choice is drawn.
  for (;;) {
    switch (int(r, 0, 23)) {
      case 0:
      case 1:
      case 2:
        if (!noteTracks.length) break;
        return {
          op: "addNotes",
          trackId: pick(r, noteTracks).id,
          notes: Array.from({ length: int(r, 1, 4) }, () => note(r)),
        };
      case 3: {
        if (!withNotes.length) break;
        const t = pick(r, withNotes);
        return { op: "removeNotes", trackId: t.id, ids: some(r, t.notes, 3).map((x) => x.id) };
      }
      case 4: {
        if (!withNotes.length) break;
        const t = pick(r, withNotes);
        const patch = pick(r, [
          { vel: int(r, 0, 10) / 10 },
          { pitch: int(r, 21, 108) },
          { tick: int(r, 0, 63) * GRID },
          { dur: int(r, 1, 6) * GRID },
          { offset: undefined },
          { hand: "L" as const },
        ]);
        return { op: "patchNotes", trackId: t.id, ids: some(r, t.notes, 3).map((x) => x.id), patch };
      }
      case 5: {
        if (!withNotes.length) break;
        const t = pick(r, withNotes);
        const chosen = some(r, t.notes, 4);
        // Keep every shifted note on the keyboard and after the start.
        const up = Math.min(...chosen.map((x) => 108 - x.pitch));
        const down = Math.min(...chosen.map((x) => x.pitch - 21));
        const back = Math.min(...chosen.map((x) => x.tick));
        return {
          op: "shiftNotes",
          trackId: t.id,
          ids: chosen.map((x) => x.id),
          ticks: int(r, -Math.min(Math.floor(back / GRID), 4), 4) * GRID,
          semitones: int(r, -Math.min(down, 12), Math.min(up, 12)),
        };
      }
      case 6: {
        const start = int(r, 0, 12) * 480;
        const count = int(r, 0, 3);
        return {
          op: "setChords",
          range: { start, end: start + 1920 },
          chords: Array.from({ length: count }, (_, i) => ({
            tick: start + (i * 1920) / Math.max(count, 1),
            dur: 1920 / Math.max(count, 1),
            symbol: pick(r, CHORDS),
            origin: pick(r, ORIGINS),
          })).filter((c) => !p.chords.some((x) => x.tick < start && x.tick + x.dur > c.tick)),
        };
      }
      case 7:
      case 8:
        if (!drumTracks.length) break;
        return {
          op: "addHits",
          trackId: pick(r, drumTracks).id,
          hits: Array.from({ length: int(r, 1, 4) }, () => hit(r)),
        };
      case 9: {
        if (!withHits.length) break;
        const t = pick(r, withHits);
        return { op: "removeHits", trackId: t.id, ids: some(r, t.hits, 3).map((x) => x.id) };
      }
      case 10: {
        if (!withHits.length) break;
        const t = pick(r, withHits);
        return {
          op: "patchHits",
          trackId: t.id,
          ids: some(r, t.hits, 3).map((x) => x.id),
          patch: pick(r, [{ vel: 0.3 }, { pad: "snare" as const }, { tick: int(r, 0, 63) * GRID }]),
        };
      }
      case 11: {
        if (!drumTracks.length) break;
        const t = pick(r, drumTracks);
        const id = t.patterns.length && r() < 0.4 ? pick(r, t.patterns).id : `pat${n}`;
        const lane = () => Array.from({ length: 16 }, () => (r() < 0.3 ? 0.8 : 0));
        return {
          op: "putPattern",
          trackId: t.id,
          pattern: { id, name: `Pattern ${n}`, stepsPerBar: 16, bars: 1, lanes: { kick: lane(), hat: lane() } },
        };
      }
      case 12: {
        if (!withPatterns.length) break;
        const t = pick(r, withPatterns);
        return { op: "removePattern", trackId: t.id, patternId: pick(r, t.patterns).id };
      }
      case 13: {
        if (!withPatterns.length) break;
        const t = pick(r, withPatterns);
        return {
          op: "placeClip",
          trackId: t.id,
          patternId: pick(r, t.patterns).id,
          tick: int(r, 0, 7) * 1920,
          repeats: int(r, 1, 4),
        };
      }
      case 14: {
        if (!withClips.length) break;
        const t = pick(r, withClips);
        return { op: "removeClip", trackId: t.id, id: pick(r, t.clips).id };
      }
      case 15: {
        if (p.tracks.length >= 7) break;
        if (!p.tracks.some((t) => t.kind === "drums")) {
          const drums: DrumTrack = {
            kind: "drums",
            id: `d${n}`,
            name: "Drums",
            kit: "synth",
            volume: 0.8,
            muted: false,
            locked: false,
            feel: 1,
            patterns: [],
            clips: [],
            hits: [],
          };
          return { op: "addTrack", track: drums };
        }
        const track: NoteTrack = {
          kind: "notes",
          id: `t${n}`,
          name: `Track ${n}`,
          role: "counter",
          hand: "R",
          sound: "soft",
          volume: 0.7,
          muted: false,
          locked: false,
          feel: 1,
          notes: Array.from({ length: int(r, 0, 3) }, (_, i) => ({ ...note(r), id: i })),
        };
        return { op: "addTrack", track, index: int(r, 0, p.tracks.length) };
      }
      case 16:
        if (open.length < 2 || p.tracks.length < 3) break;
        return { op: "removeTrack", trackId: pick(r, open).id };
      case 17: {
        if (locked.length && r() < 0.6)
          return { op: "patchTrack", trackId: pick(r, locked).id, patch: { locked: false } };
        if (!open.length) break;
        const t = pick(r, open);
        return {
          op: "patchTrack",
          trackId: t.id,
          patch: pick(r, [
            { volume: int(r, 0, 10) / 10 },
            { muted: !t.muted },
            { name: `Renamed ${n}` },
            { feel: 0.5 },
            { locked: true },
          ]),
        };
      }
      case 18: {
        const count = int(r, 0, 3);
        return {
          op: "setSections",
          sections: Array.from({ length: count }, (_, i) => ({
            id: `s${n}-${i}`,
            name: `Part ${i + 1}`,
            tick: int(r, 0, 7) * 1920,
            dur: int(r, 1, 4) * 1920,
          })),
        };
      }
      case 19:
        return { op: "insertTime", tick: int(r, 0, 8) * 480, dur: int(r, 1, 4) * 480 };
      case 20:
        return { op: "deleteTime", tick: int(r, 0, 8) * 480, dur: int(r, 1, 4) * 480 };
      case 21: {
        const start = int(r, 0, 6) * 480;
        return { op: "copyRange", from: { start, end: start + int(r, 1, 4) * 480 }, to: int(r, 0, 8) * 480 };
      }
      case 22:
        return {
          op: "patchSong",
          patch: pick(r, [
            { title: `Song ${n}` },
            {
              tempo: [
                { tick: 0, bpm: int(r, 60, 180) },
                ...(r() < 0.5 ? [{ tick: 1920 * int(r, 1, 4), bpm: int(r, 60, 180) }] : []),
              ],
            },
            { meter: [{ tick: 0, numerator: pick(r, [3, 4, 6]), denominator: pick(r, [4, 8] as const) }] },
            {
              key: [
                { tick: 0, tonic: pick(r, ["C", "F#", "Bb"]), mode: pick(r, ["major", "minor", "dorian"] as const) },
              ],
            },
            { swing: { amount: 0.6, unit: 8 as const } },
            { handSpan: int(r, 8, 16) },
            { lengthTicks: int(r, 0, 20) * 1920 },
            { brief: { mood: "wistful" } },
          ]),
        };
      case 23: {
        if (p.ideas.length && r() < 0.4) return { op: "removeIdea", id: pick(r, p.ideas).id };
        if (noteTracks.length && r() < 0.3) {
          return r() < 0.5
            ? {
                op: "setPending",
                pending: { trackId: pick(r, noteTracks).id, slots: [{ tick: 0, dur: 240, vel: 0.7 }] },
              }
            : { op: "setPending", pending: undefined };
        }
        return {
          op: "putIdea",
          idea: {
            id: `idea${n % 5}`,
            kind: "melody",
            label: `Idea ${n}`,
            createdAt: "2026-11-16T00:00:00.000Z",
            source: "author",
            ops: [],
          },
        };
      }
    }
  }
}
