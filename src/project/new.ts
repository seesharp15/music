import { PPQ, ticksPerBar, type MeterEvent } from "../music/time";
import { PROJECT_FORMAT } from "./schema";
import type { DrumTrack, NoteTrack, Project } from "./types";

export interface NewProjectOptions {
  title?: string;
  bpm?: number;
  meter?: [number, MeterEvent["denominator"]];
  key?: { tonic: string; mode: Project["key"][number]["mode"] };
  /** Empty bars to start with. Default 8. */
  bars?: number;
  /** For tests and imports: fix the id and the clock. */
  id?: string;
  now?: Date;
}

/** A fresh id for a project: short, sortable by time, unique enough for one device. */
export function newProjectId(now = new Date()): string {
  return `${now.getTime().toString(36)}${Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0")}`;
}

export function noteTrack(id: string, name: string, role: NoteTrack["role"], hand: NoteTrack["hand"]): NoteTrack {
  return {
    kind: "notes",
    id,
    name,
    role,
    hand,
    sound: "piano",
    volume: 0.8,
    muted: false,
    locked: false,
    feel: 1,
    notes: [],
  };
}

export function drumTrack(id = "drums", name = "Drums"): DrumTrack {
  return {
    kind: "drums",
    id,
    name,
    kit: "synth",
    volume: 0.8,
    muted: false,
    locked: false,
    feel: 1,
    patterns: [],
    clips: [],
    hits: [],
  };
}

/**
 * An empty project: a Melody track for the right hand, Chords and Bass for the left, and an empty
 * drum track.
 */
export function newProject(opts: NewProjectOptions = {}): Project {
  const now = opts.now ?? new Date();
  const [numerator, denominator] = opts.meter ?? [4, 4];
  const stamp = now.toISOString();
  return {
    format: PROJECT_FORMAT,
    id: opts.id ?? newProjectId(now),
    title: opts.title ?? "Untitled",
    createdAt: stamp,
    updatedAt: stamp,
    seq: 1,
    lengthTicks: (opts.bars ?? 8) * ticksPerBar({ numerator, denominator }),
    tempo: [{ tick: 0, bpm: opts.bpm ?? 100 }],
    meter: [{ tick: 0, numerator, denominator }],
    key: [{ tick: 0, tonic: opts.key?.tonic ?? "C", mode: opts.key?.mode ?? "major" }],
    swing: { amount: 0.5, unit: 8 },
    handSpan: 14,
    sections: [],
    chords: [],
    tracks: [
      noteTrack("melody", "Melody", "melody", "R"),
      noteTrack("chords", "Chords", "chords", "L"),
      noteTrack("bass", "Bass", "bass", "L"),
      drumTrack(),
    ],
    ideas: [],
  };
}

export { PPQ };
