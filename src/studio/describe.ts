/** Positions and notes in words, for the live region and for labels. */
import { noteName } from "../components/keyboard";
import { spell, keyAt } from "../music/theory";
import { makeTimeMap, PPQ } from "../music/time";
import type { PNote, Project } from "../project/types";

const NAMED: [number, string][] = [
  [PPQ * 4, "whole note"],
  [PPQ * 3, "dotted half note"],
  [PPQ * 2, "half note"],
  [(PPQ * 3) / 2, "dotted quarter note"],
  [PPQ, "quarter note"],
  [(PPQ * 3) / 4, "dotted eighth note"],
  [(PPQ * 2) / 3, "quarter-note triplet"],
  [PPQ / 2, "eighth note"],
  [PPQ / 3, "eighth-note triplet"],
  [PPQ / 4, "sixteenth note"],
  [PPQ / 8, "thirty-second note"],
];

/** "quarter note", or for an odd length, "1.5 beats". */
export function lengthName(ticks: number): string {
  const named = NAMED.find(([t]) => t === ticks);
  if (named) return named[1];
  const beats = Math.round((ticks / PPQ) * 100) / 100;
  return `${beats} ${beats === 1 ? "beat" : "beats"}`;
}

/** "bar 3, beat 2", with "and a bit" spelled as ticks when off the beat. */
export function positionName(project: Pick<Project, "tempo" | "meter">, tick: number): string {
  const pos = makeTimeMap(project.tempo, project.meter).positionAt(Math.max(0, tick));
  return `bar ${pos.bar}, beat ${pos.beat}${pos.tick ? `, tick ${pos.tick}` : ""}`;
}

/** A pitch as the key would spell it: "F#4" in D major, "Gb4" in D flat. */
export function pitchName(project: Pick<Project, "key">, pitch: number, tick = 0): string {
  try {
    return spell(pitch, keyAt(project, tick));
  } catch {
    return noteName(pitch);
  }
}

export const describeCursor = (project: Pick<Project, "tempo" | "meter">, tick: number) =>
  `Cursor at ${positionName(project, tick)}`;

/** "E4, bar 3, beat 2, quarter note". */
export function describeNote(project: Project, n: Pick<PNote, "pitch" | "tick" | "dur">): string {
  return `${pitchName(project, n.pitch, n.tick)}, ${positionName(project, n.tick)}, ${lengthName(n.dur)}`;
}
