/**
 * Arranging by section, as edit operations: add, rename, resize, duplicate, move and delete. The
 * music moves with its section — these are built on the three range operations (`insertTime`,
 * `deleteTime`, `copyRange`), which act on every track, the chords and the drum clips alike.
 */
import { makeTimeMap, type TimeMap } from "../../music/time";
import type { EditOp, PSection, Project } from "../../project/types";

export const SECTION_NAMES = ["Intro", "Verse", "Chorus", "Bridge", "Solo", "Outro"];
export const SECTION_COLORS = ["#5fd38d", "#5aa8f8", "#f0a35e", "#b78cf0", "#f08bc0", "#5ed0d8"];
export const DEFAULT_BARS = 4;

export interface SectionEdit {
  ops: EditOp[];
  label: string;
}

const timeOf = (p: Project) => makeTimeMap(p.tempo, p.meter);

/** Whole bars a section covers, counting a part-bar as one. */
export function barsOf(section: Pick<PSection, "tick" | "dur">, time: TimeMap): number {
  const first = time.positionAt(section.tick).bar;
  const last = time.positionAt(Math.max(section.tick, section.tick + section.dur - 1)).bar;
  return last - first + 1;
}

/** The tick `bars` bars after a bar line. */
const barsAfter = (time: TimeMap, tick: number, bars: number) => time.tickOfBar(time.positionAt(tick).bar + bars);

function freshId(p: Project): string {
  const used = new Set(p.sections.map((s) => s.id));
  for (let n = p.sections.length + 1; ; n++) if (!used.has(`s${n}`)) return `s${n}`;
}

/** A name not yet used: the usual ones in order, then "Section 7". */
function freshName(p: Project): string {
  const used = new Set(p.sections.map((s) => s.name));
  return SECTION_NAMES.find((n) => !used.has(n)) ?? `Section ${p.sections.length + 1}`;
}

/**
 * A new section: `at` "end" puts it after the last section (or at the start of an unsectioned
 * song); a tick puts it on that tick's bar line. It is four bars long unless the next section is
 * nearer than that.
 */
export function addSection(p: Project, at: "end" | number): SectionEdit {
  const time = timeOf(p);
  const lastEnd = p.sections.reduce((end, s) => Math.max(end, s.tick + s.dur), 0);
  const start =
    at === "end"
      ? barsAfter(time, lastEnd, lastEnd > time.tickOfBar(time.positionAt(lastEnd).bar) ? 1 : 0)
      : time.tickOfBar(time.positionAt(at).bar);
  let end = barsAfter(time, start, DEFAULT_BARS);
  const next = p.sections.find((s) => s.tick > start);
  if (next && next.tick < end) end = Math.max(barsAfter(time, start, 1), next.tick);
  const section: PSection = {
    id: freshId(p),
    name: freshName(p),
    tick: start,
    dur: end - start,
    color: SECTION_COLORS[p.sections.length % SECTION_COLORS.length],
  };
  return {
    ops: [{ op: "setSections", sections: sorted([...p.sections, section]) }],
    label: `Add section ${section.name}`,
  };
}

const sorted = (sections: PSection[]) => [...sections].sort((a, b) => a.tick - b.tick);

export function patchSection(
  p: Project,
  id: string,
  patch: Partial<Pick<PSection, "name" | "color">>,
): SectionEdit | null {
  if (!p.sections.some((s) => s.id === id)) return null;
  return {
    ops: [{ op: "setSections", sections: p.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) }],
    label: patch.name !== undefined ? "Rename section" : "Recolour section",
  };
}

/** Change how many bars a section's label covers. The music does not move. */
export function resizeSection(p: Project, id: string, bars: number): SectionEdit | null {
  const section = p.sections.find((s) => s.id === id);
  if (!section || bars < 1) return null;
  const end = barsAfter(timeOf(p), section.tick, Math.round(bars));
  return {
    ops: [{ op: "setSections", sections: p.sections.map((s) => (s.id === id ? { ...s, dur: end - s.tick } : s)) }],
    label: "Resize section",
  };
}

/** A copy of the section, straight after it: everything on every track in its range. */
export function duplicateSection(p: Project, id: string): SectionEdit | null {
  const s = p.sections.find((x) => x.id === id);
  if (!s) return null;
  return {
    ops: [{ op: "copyRange", from: { start: s.tick, end: s.tick + s.dur }, to: s.tick + s.dur }],
    label: `Duplicate ${s.name}`,
  };
}

/**
 * Swap a section with the one before it (`-1`) or after it (`1`). Its notes, chords and drum clips
 * go with it: the later of the two is copied in ahead of the earlier, and then removed from where
 * it was. One step.
 */
export function moveSection(p: Project, id: string, direction: 1 | -1): SectionEdit | null {
  const order = sorted(p.sections);
  const at = order.findIndex((s) => s.id === id);
  const first = direction < 0 ? order[at - 1] : order[at];
  const second = direction < 0 ? order[at] : order[at + 1];
  if (at < 0 || !first || !second) return null;
  // They must not overlap, or "the music of each" has no meaning.
  if (second.tick < first.tick + first.dur) return null;
  const moved = p.sections.find((s) => s.id === id)!;
  return {
    ops: [
      { op: "copyRange", from: { start: second.tick, end: second.tick + second.dur }, to: first.tick },
      // The original has been pushed later by the copy's length; take it out from there.
      { op: "deleteTime", tick: second.tick + second.dur, dur: second.dur },
    ],
    label: `Move ${moved.name} ${direction < 0 ? "earlier" : "later"}`,
  };
}

export type DeleteHow = "close" | "empty" | "label";

/**
 * Delete a section: with its music, closing the gap; or its music only, leaving its bars empty;
 * or just the label, leaving the music as it is.
 */
export function deleteSection(p: Project, id: string, how: DeleteHow): SectionEdit | null {
  const s = p.sections.find((x) => x.id === id);
  if (!s) return null;
  if (how === "label") {
    return {
      ops: [{ op: "setSections", sections: p.sections.filter((x) => x.id !== id) }],
      label: `Remove the name ${s.name}`,
    };
  }
  const ops: EditOp[] = [{ op: "deleteTime", tick: s.tick, dur: s.dur }];
  // Leaving the bars empty: take the range out, then put the same length of silence back.
  if (how === "empty") ops.push({ op: "insertTime", tick: s.tick, dur: s.dur });
  return { ops, label: `Delete ${s.name}` };
}
