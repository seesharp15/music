import { compileProject } from "../../src/project/compile";
import { newProject } from "../../src/project/new";
import { applyOps } from "../../src/project/ops";
import type { EditOp, Project } from "../../src/project/types";
import type { Song } from "../../src/song/types";

/**
 * A small band, for testing what a compiled project sounds like: a melody and a bass on different
 * sounds, a drum part made of free hits and a pattern, and a tempo change — 120 for the first bar,
 * then 90. Nothing falls on the very first instant, which a player cannot ask for on time.
 */
const n = (pitch: number, tick: number, dur = 240) => ({ pitch, tick, dur, vel: 0.8, origin: "manual" as const });
const hit = (pad: "kick" | "snare" | "hat" | "crash", tick: number) => ({
  pad,
  tick,
  vel: 0.9,
  origin: "tapped" as const,
});

export const BAND_OPS: EditOp[] = [
  {
    op: "patchSong",
    patch: {
      tempo: [
        { tick: 0, bpm: 120 },
        { tick: 1920, bpm: 90 },
      ],
    },
  },
  { op: "patchTrack", trackId: "melody", patch: { sound: "bright", volume: 0.9 } },
  { op: "patchTrack", trackId: "bass", patch: { sound: "soft", volume: 0.7 } },
  {
    op: "addNotes",
    trackId: "melody",
    notes: [n(72, 480), n(74, 960), n(76, 1440), n(77, 1920), n(79, 2400), n(81, 2880), n(84, 3360, 480)],
  },
  { op: "addNotes", trackId: "bass", notes: [n(36, 480, 1440), n(41, 1920, 960), n(43, 2880, 960)] },
  { op: "addHits", trackId: "drums", hits: [hit("kick", 480), hit("snare", 960), hit("kick", 1440)] },
  {
    op: "putPattern",
    trackId: "drums",
    pattern: {
      id: "beat",
      name: "Beat",
      stepsPerBar: 8,
      bars: 1,
      lanes: { kick: [1, 0, 0, 0, 1, 0, 0, 0], snare: [0, 0, 1, 0, 0, 0, 1, 0], hat: [0, 0.5, 0, 0.5, 0, 0.5, 0, 0.5] },
    },
  },
  { op: "placeClip", trackId: "drums", patternId: "beat", tick: 1920, repeats: 1 },
];

export function bandProject(): Project {
  return applyOps(
    newProject({ id: "band", title: "The Band", bpm: 120, bars: 2, now: new Date("2026-11-16T12:00:00Z") }),
    BAND_OPS,
  );
}

/** The band, compiled: 2 s at 120, then a bar at 90 (2.667 s). */
export function bandSong(): Song {
  return compileProject(bandProject());
}

/**
 * Three parts that never overlap, for hearing which is sounding: melody from 0.5 to 1.5 s, bass
 * from 2 to 3 s, drums from 5 to 6 s (after the bass has quite died away). At 120 BPM throughout.
 */
export function partsSong(): Song {
  const p = applyOps(
    newProject({ id: "parts", title: "Parts", bpm: 120, bars: 4, now: new Date("2026-11-16T12:00:00Z") }),
    [
      { op: "patchTrack", trackId: "melody", patch: { sound: "bright", volume: 1 } },
      { op: "patchTrack", trackId: "bass", patch: { sound: "soft", volume: 1 } },
      { op: "addNotes", trackId: "melody", notes: [n(72, 480, 480), n(76, 960, 480)] },
      { op: "addNotes", trackId: "bass", notes: [n(48, 1920, 480), n(43, 2400, 480)] },
      {
        op: "addHits",
        trackId: "drums",
        hits: [hit("kick", 4800), hit("snare", 5040), hit("kick", 5280), hit("snare", 5520)],
      },
    ],
  );
  return compileProject(p);
}
