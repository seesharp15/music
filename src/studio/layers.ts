/**
 * What the editor draws, as an ordered list of layers. Each layer is a small module with a `draw`;
 * later stages register theirs (the drum grid, key hints, ghost notes for options, origin tints)
 * with `registerLayer`, without touching the canvas component.
 */
import { HAND_COLORS } from "../components/colors";
import type { KeyboardLayout } from "../components/keyboard";
import {
  BACKGROUND,
  drawKeyboard,
  drawLaneGuides,
  drawLineGlow,
  drawNote,
  roundRect,
  type NoteColor,
} from "../components/stage-draw";
import { gridTicks } from "../music/quantize";
import { ticksPerBeat, type TimeMap } from "../music/time";
import { expandDrums } from "../project/compile";
import type { DrumTrack, NoteTrack, PNote, Project } from "../project/types";
import type { UiState } from "./ui-store";
import { frame, keyRect, visibleTicks, yAtTick, type View } from "./view";

/** A drag in progress: where the notes it holds would land, shown before anything is changed. */
export interface DragPreview {
  ids: ReadonlySet<number>;
  dTick: number;
  dPitch: number;
  dDur: number;
  /** The originals stay where they are: this is a copy being placed. */
  copy: boolean;
}

export interface DrawState {
  project: Project;
  ui: UiState;
  time: TimeMap;
  view: View;
  layout: KeyboardLayout & { whiteW: number };
  /** Where playback is, in ticks; null when stopped. */
  playTick: number | null;
  drag: DragPreview | null;
  /** A selection box being drawn, in canvas pixels. */
  box: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Keys held down by hand right now. */
  held: ReadonlyMap<number, NoteColor>;
  readOnly: boolean;
}

export interface Layer {
  id: string;
  /** Lower is drawn first. Gaps are left between the built-in layers for later stages. */
  order: number;
  draw(ctx: CanvasRenderingContext2D, s: DrawState): void;
}

const layers: Layer[] = [];

/** Add a layer (replacing one with the same id). Returns how to remove it. */
export function registerLayer(layer: Layer): () => void {
  const at = layers.findIndex((l) => l.id === layer.id);
  if (at >= 0) layers.splice(at, 1);
  layers.push(layer);
  layers.sort((a, b) => a.order - b.order);
  return () => {
    const i = layers.indexOf(layer);
    if (i >= 0) layers.splice(i, 1);
  };
}

export const layerIds = () => layers.map((l) => l.id);

export function drawLayers(ctx: CanvasRenderingContext2D, s: DrawState) {
  for (const layer of layers) {
    ctx.save();
    layer.draw(ctx, s);
    ctx.restore();
  }
}

// ── Colours ──────────────────────────────────────────────────────────────────

const BASS: NoteColor = { fill: "#7b7ff0", dark: "#4d50b8" };
const EXTRA: NoteColor[] = [
  { fill: "#f08bc0", dark: "#b8508a" },
  { fill: "#f0a35e", dark: "#b86f2c" },
  { fill: "#5ed0d8", dark: "#2c98a0" },
  { fill: "#b78cf0", dark: "#7f55b8" },
];
export const DRUM_COLOR = "#ffb84d";
export const ACCENT = "#ffcc00";
const SECTION_COLORS = ["#5fd38d", "#5aa8f8", "#f0a35e", "#b78cf0", "#f08bc0", "#5ed0d8"];

/** A track's colour: melody green and chords blue (the hands' colours), bass indigo, then a palette. */
export function trackColor(project: Project, trackId: string): NoteColor {
  let extra = 0;
  for (const t of project.tracks) {
    if (t.kind !== "notes") continue;
    const own = t.role === "melody" || t.role === "chords" || t.role === "bass";
    // Only the first track of a role gets that role's colour; a second melody is an extra.
    const first = own && project.tracks.find((x) => x.kind === "notes" && x.role === t.role) === t;
    const c = first
      ? t.role === "melody"
        ? HAND_COLORS.R
        : t.role === "chords"
          ? HAND_COLORS.L
          : BASS
      : EXTRA[extra++ % EXTRA.length];
    if (t.id === trackId) return c;
  }
  return HAND_COLORS.R;
}

export function noteColor(project: Project, track: NoteTrack, note: Pick<PNote, "hand">, byHand: boolean): NoteColor {
  return byHand ? HAND_COLORS[note.hand ?? track.hand] : trackColor(project, track.id);
}

export const sectionColor = (project: Project, index: number) =>
  project.sections[index]?.color ?? SECTION_COLORS[index % SECTION_COLORS.length];

/** The notes that can be taken hold of: the active track's, or every unlocked track's. */
export function editableTracks(project: Project, ui: Pick<UiState, "activeTrack" | "editAll">): NoteTrack[] {
  return project.tracks.filter(
    (t): t is NoteTrack => t.kind === "notes" && (ui.editAll ? !t.locked : t.id === ui.activeTrack),
  );
}

// ── The built-in layers ──────────────────────────────────────────────────────

const clipToWaterfall = (ctx: CanvasRenderingContext2D, v: View) => {
  const f = frame(v);
  ctx.beginPath();
  ctx.rect(f.left, 0, f.right - f.left, f.bottom);
  ctx.clip();
};

registerLayer({
  id: "background",
  order: 0,
  draw(ctx, { view: v, layout }) {
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, v.width, v.height);
    clipToWaterfall(ctx, v);
    drawLaneGuides(ctx, layout, frame(v).bottom);
  },
});

registerLayer({
  id: "grid",
  order: 10,
  draw(ctx, { view: v, time, ui, project }) {
    const f = frame(v);
    const { start, end } = visibleTicks(v);
    const from = Math.max(0, start);
    const snap = gridTicks(ui.snap);
    const snapPx = snap / v.ticksPerPx;
    let bar = time.positionAt(Math.floor(from)).bar;
    // Past the end of the song the grid is drawn fainter: there is nothing there yet.
    const line = (tick: number, alpha: number) => {
      const y = Math.round(yAtTick(v, tick));
      if (y < 0 || y > f.bottom) return;
      ctx.fillStyle = `rgba(255,255,255,${tick > project.lengthTicks ? alpha * 0.45 : alpha})`;
      ctx.fillRect(f.left, y, f.right - f.left, 1);
    };
    for (let guard = 0; guard < 400; guard++, bar++) {
      const barTick = time.tickOfBar(bar);
      if (barTick > end) break;
      const meter = time.meterAt(barTick);
      const beat = ticksPerBeat(meter);
      const barLen = time.ticksPerBarAt(barTick);
      if (snapPx >= 7) {
        for (let t = barTick; t < barTick + barLen; t += snap) {
          if ((t - barTick) % beat !== 0) line(t, 0.035);
        }
      }
      if (beat / v.ticksPerPx >= 7) {
        for (let b = 1; b < meter.numerator; b++) line(barTick + b * beat, 0.07);
      }
      line(barTick, 0.2);
    }
    if (start < 0) {
      // Before the song begins.
      const y0 = yAtTick(v, 0);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(f.left, y0, f.right - f.left, f.bottom - y0);
    }
  },
});

registerLayer({
  id: "notes",
  order: 30,
  draw(ctx, { view: v, project, ui, drag, layout }) {
    clipToWaterfall(ctx, v);
    const f = frame(v);
    const { start, end } = visibleTicks(v);
    const selected = new Set(ui.selection);
    const editable = new Set(editableTracks(project, ui).map((t) => t.id));

    const paint = (track: NoteTrack, n: PNote, alpha: number, outline: boolean) => {
      if (n.tick > end || n.tick + n.dur < start) return;
      const k = keyRect(v, n.pitch);
      if (k.x + k.w < f.left || k.x > f.right) return;
      const bottom = yAtTick(v, n.tick);
      const top = yAtTick(v, n.tick + n.dur);
      const h = bottom - top;
      const color = noteColor(project, track, n, ui.colourByHand);
      // Leave a hair between a note and the one that follows it, so repeated notes read as two.
      drawNote(ctx, k, layout.whiteW, top + (h > 6 ? 1 : 0), h - (h > 6 ? 1 : 0), color, alpha, n.pitch, bottom - 5);
      if (outline) {
        const pad = k.black ? 0 : Math.max(1, layout.whiteW * 0.08);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        roundRect(ctx, k.x + pad + 1, top + 1, k.w - pad * 2 - 2, Math.max(h - 2, 2), Math.min(6, k.w / 3));
        ctx.stroke();
      }
    };

    // Other tracks first and fainter, then the one being written.
    const order = [...project.tracks].sort((a, b) => Number(a.id === ui.activeTrack) - Number(b.id === ui.activeTrack));
    for (const track of order) {
      if (track.kind !== "notes") continue;
      const base = track.muted ? 0.18 : editable.has(track.id) ? (track.id === ui.activeTrack ? 1 : 0.8) : 0.32;
      for (const n of track.notes) {
        const held = drag?.ids.has(n.id);
        if (held && !drag!.copy) continue; // drawn where it is being dragged to, below
        paint(track, n, base, selected.has(n.id) && !held);
      }
    }
    if (drag) {
      for (const track of project.tracks) {
        if (track.kind !== "notes") continue;
        for (const n of track.notes) {
          if (!drag.ids.has(n.id)) continue;
          const moved: PNote = {
            ...n,
            tick: Math.max(0, n.tick + drag.dTick),
            pitch: Math.min(108, Math.max(21, n.pitch + drag.dPitch)),
            dur: Math.max(1, n.dur + drag.dDur),
          };
          paint(track, moved, 0.9, true);
        }
      }
    }
  },
});

registerLayer({
  id: "pending",
  order: 35,
  draw(ctx, { view: v, project }) {
    const pending = project.pending;
    if (!pending?.slots.length) return;
    clipToWaterfall(ctx, v);
    const f = frame(v);
    const color = trackColor(project, pending.trackId);
    ctx.strokeStyle = color.fill;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    for (const slot of pending.slots) {
      const bottom = yAtTick(v, slot.tick);
      const top = yAtTick(v, slot.tick + slot.dur);
      if (bottom < 0 || top > f.bottom) continue;
      roundRect(ctx, f.left + 4, top + 1, f.right - f.left - 8, Math.max(3, bottom - top - 2), 5);
      ctx.stroke();
    }
  },
});

const drumCache = new WeakMap<DrumTrack, { time: TimeMap; hits: { tick: number; vel: number }[] }>();

registerLayer({
  id: "drums",
  order: 40,
  draw(ctx, { view: v, project, time }) {
    if (!v.lane) return;
    const f = frame(v);
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    ctx.fillRect(f.right, 0, v.lane, f.bottom);
    const { start, end } = visibleTicks(v);
    ctx.fillStyle = DRUM_COLOR;
    for (const track of project.tracks) {
      if (track.kind !== "drums") continue;
      let cached = drumCache.get(track);
      if (!cached || cached.time !== time) {
        cached = { time, hits: expandDrums(track, time) };
        drumCache.set(track, cached);
      }
      ctx.globalAlpha = track.muted ? 0.25 : 1;
      for (const h of cached.hits) {
        if (h.tick < start || h.tick > end) continue;
        ctx.beginPath();
        ctx.arc(f.right + v.lane / 2, yAtTick(v, h.tick), 1.5 + 2.5 * h.vel, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },
});

registerLayer({
  id: "line",
  order: 50,
  draw(ctx, { view: v, playTick }) {
    const f = frame(v);
    ctx.beginPath();
    ctx.rect(f.left, 0, v.width - f.left, f.bottom);
    ctx.clip();
    drawLineGlow(ctx, f.lineY, v.width);
    ctx.fillStyle = playTick === null ? ACCENT : "#ffffff";
    ctx.fillRect(f.left, f.lineY - 1, v.width - f.left, 2);
  },
});

registerLayer({
  id: "gutters",
  order: 60,
  draw(ctx, { view: v, project, time, ui }) {
    const f = frame(v);
    const { start, end } = visibleTicks(v);
    ctx.beginPath();
    ctx.rect(0, 0, f.left, f.bottom);
    ctx.clip();
    ctx.fillStyle = "#12141a";
    ctx.fillRect(0, 0, f.left, f.bottom);

    // Sections: a coloured strip down the bar gutter, with the name where the section starts.
    project.sections.forEach((s, i) => {
      if (s.tick > end || s.tick + s.dur < start) return;
      const bottom = yAtTick(v, s.tick);
      const top = yAtTick(v, s.tick + s.dur);
      ctx.fillStyle = sectionColor(project, i);
      ctx.globalAlpha = 0.85;
      ctx.fillRect(0, top + 1, 4, bottom - top - 2);
      ctx.globalAlpha = 1;
    });

    // Bar numbers, each just above its bar line (a bar runs upwards from its line).
    ctx.font = "600 10px system-ui, sans-serif";
    ctx.textAlign = "center";
    const barPx = time.ticksPerBarAt(Math.max(0, start)) / v.ticksPerPx;
    const every = barPx >= 16 ? 1 : barPx >= 8 ? 2 : 4;
    let bar = time.positionAt(Math.max(0, Math.floor(start))).bar;
    for (let guard = 0; guard < 400; guard++, bar++) {
      const tick = time.tickOfBar(bar);
      if (tick > end) break;
      const y = yAtTick(v, tick);
      ctx.fillStyle = "rgba(255,255,255,0.14)";
      ctx.fillRect(0, Math.round(y), f.left, 1);
      if ((bar - 1) % every === 0) {
        ctx.fillStyle = tick >= project.lengthTicks ? "rgba(138,146,163,0.5)" : "#8a92a3";
        ctx.fillText(String(bar), 4 + (v.barGutter - 4) / 2, y - 4);
      }
    }

    // Chords: a block for as long as each lasts, its symbol at its start.
    ctx.textAlign = "left";
    for (const c of project.chords) {
      if (c.tick > end || c.tick + c.dur < start) continue;
      const bottom = yAtTick(v, c.tick);
      const top = yAtTick(v, c.tick + c.dur);
      const at =
        ui.sheet === "chords" && ui.chordTick !== null && ui.chordTick >= c.tick && ui.chordTick < c.tick + c.dur;
      ctx.fillStyle = at ? "rgba(255,204,0,0.22)" : "rgba(90,168,248,0.16)";
      roundRect(ctx, v.barGutter + 2, top + 1, v.chordGutter - 4, Math.max(2, bottom - top - 2), 4);
      ctx.fill();
      if (bottom - top >= 13) {
        ctx.fillStyle = "#eceef2";
        ctx.font = `600 ${c.symbol.length > 5 ? 9 : c.symbol.length > 3 ? 10.5 : 12}px system-ui, sans-serif`;
        ctx.fillText(c.symbol, v.barGutter + 5, bottom - 5, v.chordGutter - 8);
      }
    }
    // Where the chord picker is working.
    if (ui.sheet === "chords" && ui.chordTick !== null) {
      const y = yAtTick(v, ui.chordTick);
      ctx.fillStyle = ACCENT;
      ctx.fillRect(v.barGutter, Math.round(y) - 1, v.chordGutter, 2);
    }
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(f.left - 1, 0, 1, f.bottom);
    ctx.fillRect(v.barGutter, 0, 1, f.bottom);
  },
});

registerLayer({
  id: "keyboard",
  order: 70,
  draw(ctx, { view: v, layout, project, ui, playTick, held }) {
    const f = frame(v);
    // Light the keys of whatever sounds at the line: what is playing, or what the cursor rests on.
    const at = playTick ?? ui.cursor;
    const lit = new Map<number, NoteColor>();
    for (const track of project.tracks) {
      if (track.kind !== "notes" || track.muted) continue;
      for (const n of track.notes) {
        if (n.tick > at) break;
        if (n.tick + n.dur > at) lit.set(n.pitch, noteColor(project, track, n, ui.colourByHand));
      }
    }
    for (const [pitch, color] of held) lit.set(pitch, color);
    ctx.beginPath();
    ctx.rect(f.left, f.bottom, f.right - f.left, v.kbH);
    ctx.clip();
    drawKeyboard(ctx, layout, f.bottom, v.kbH, lit, layout.whiteW);
  },
});

registerLayer({
  id: "box",
  order: 80,
  draw(ctx, { box }) {
    if (!box) return;
    const x = Math.min(box.x0, box.x1);
    const y = Math.min(box.y0, box.y1);
    const w = Math.abs(box.x1 - box.x0);
    const h = Math.abs(box.y1 - box.y0);
    ctx.fillStyle = "rgba(255,204,0,0.12)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  },
});
