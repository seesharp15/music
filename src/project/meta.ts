import { makeTimeMap } from "../music/time";
import { density } from "../song/summary";
import type { Project } from "./types";

/** What a list of projects shows, kept beside each project so listing never opens one. */
export interface ProjectMeta {
  id: string;
  title: string;
  updatedAt: string;
  /** Whole bars, counting a last part-bar as one. */
  bars: number;
  /** 48 values 0..1: how busy the project is over its length, for the card thumbnail. */
  preview: number[];
}

export function projectMeta(p: Project): ProjectMeta {
  const time = makeTimeMap(p.tempo, p.meter);
  const last = Math.max(0, p.lengthTicks - 1);
  const notes = p.tracks.flatMap((t) =>
    t.kind === "notes" ? t.notes.map((n) => ({ time: n.tick, duration: n.dur })) : [],
  );
  return {
    id: p.id,
    title: p.title,
    updatedAt: p.updatedAt,
    bars: p.lengthTicks > 0 ? time.positionAt(last).bar : 0,
    preview: density(notes, p.lengthTicks),
  };
}
