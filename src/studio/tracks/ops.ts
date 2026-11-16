/** Tracks as edit operations: add, move up or down the list, remove. Pure. */
import { drumTrack, noteTrack } from "../../project/new";
import type { EditOp, Project, Track } from "../../project/types";

export interface TrackEdit {
  ops: EditOp[];
  label: string;
  /** The id of the track the edit made, if it made one. */
  trackId?: string;
}

function freshId(p: Project, stem: string): string {
  const used = new Set(p.tracks.map((t) => t.id));
  for (let n = 1; ; n++) if (!used.has(`${stem}${n}`)) return `${stem}${n}`;
}

/** A new, empty track at the end of the list: for notes (left hand, free role), or for drums. */
export function addTrack(p: Project, kind: Track["kind"]): TrackEdit {
  const count = p.tracks.filter((t) => t.kind === kind).length;
  const track: Track =
    kind === "notes"
      ? noteTrack(freshId(p, "track"), `Track ${p.tracks.length + 1}`, "free", "L")
      : drumTrack(freshId(p, "drums"), count ? `Drums ${count + 1}` : "Drums");
  return { ops: [{ op: "addTrack", track }], label: `Add track ${track.name}`, trackId: track.id };
}

/**
 * Move a track one place up (`-1`) or down (`1`) the list. Track order is the order tracks are
 * drawn and listed in; nothing about the music changes. A locked track stays where it is.
 */
export function moveTrack(p: Project, trackId: string, direction: 1 | -1): TrackEdit | null {
  const at = p.tracks.findIndex((t) => t.id === trackId);
  const to = at + direction;
  if (at < 0 || to < 0 || to >= p.tracks.length) return null;
  const track = p.tracks[at];
  if (track.locked) return null;
  const ops: EditOp[] = [
    { op: "removeTrack", trackId },
    { op: "addTrack", track, index: to },
  ];
  // Taking a track out drops a rhythm that was waiting on it; put that back too.
  if (p.pending?.trackId === trackId) ops.push({ op: "setPending", pending: p.pending });
  return { ops, label: `Move ${track.name} ${direction < 0 ? "up" : "down"}` };
}

export function removeTrack(p: Project, trackId: string): TrackEdit | null {
  const track = p.tracks.find((t) => t.id === trackId);
  if (!track || track.locked) return null;
  return { ops: [{ op: "removeTrack", trackId }], label: `Delete track ${track.name}` };
}

/** Whether a track has anything in it that deleting would lose. */
export function isEmptyTrack(t: Track): boolean {
  return t.kind === "notes" ? t.notes.length === 0 : t.hits.length === 0 && t.clips.length === 0;
}
