/**
 * Gestures, as a pure state machine: pointer, wheel and time events in, *intents* out — select,
 * move by so much, resize, add, erase, scroll, zoom. It touches no canvas and no store, so every
 * gesture is a table in `interaction.test.ts`. The canvas controller feeds it and carries out what
 * it asks for.
 *
 * Explicit tools decide what a touch means, rather than guessing from the gesture:
 *  - Select: tap a note to select it, drag it to move it, drag its top edge to resize it; a mouse
 *    drags a box across empty space, a finger scrolls (and long-presses, then drags, for a box).
 *  - Draw: as Select on notes; a tap on empty space adds a note there.
 *  - Erase: tap or sweep across notes.
 * Two fingers always pinch to zoom; the gutters always scroll; the keyboard always plays.
 */
import { BLACK_KEY_HEIGHT } from "../components/stage-draw";
import { MAX_PITCH, MIN_PITCH } from "../song/ids";
import type { DragPreview } from "./layers";
import type { Tool } from "./ui-store";
import {
  frame,
  hitNote,
  notesInBox,
  pitchAtX,
  tickAtY,
  zoneAt,
  type NoteBox,
  type NoteHit,
  type View,
  type Zone,
} from "./view";

export type PointerKind = "mouse" | "touch" | "pen";

export type Input =
  | {
      kind: "down" | "move" | "up" | "cancel";
      id: number;
      x: number;
      y: number;
      /** Milliseconds, from any clock that only goes forward. */
      t: number;
      pointer: PointerKind;
      shift?: boolean;
      alt?: boolean;
    }
  | { kind: "wheel"; x: number; y: number; dy: number; zoom: boolean }
  /** Time passing with a finger held still: what turns a press into a long press. */
  | { kind: "time"; t: number }
  | { kind: "escape" };

export interface Env {
  view: View;
  tool: Tool;
  readOnly: boolean;
  /** The notes that may be taken hold of, in the order they are drawn. */
  notes: readonly NoteBox[];
  selection: ReadonlySet<number>;
  /** The grid, in ticks, that moves and new notes snap to. */
  snap: number;
  /** Taps add to the selection, as Shift does. */
  addToSelection: boolean;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type Intent =
  | { type: "scroll"; px: number }
  | { type: "scrollEnd" }
  | { type: "zoom"; factor: number; y: number }
  | { type: "cursor"; tick: number }
  | { type: "chord"; tick: number }
  | { type: "select"; ids: number[]; mode: "replace" | "add" | "toggle" }
  /** A selection box being drawn (`box` null once it is finished or abandoned). */
  | { type: "box"; box: Box | null }
  /** Show where a drag would land, or that a sweep is erasing; null clears it. */
  | { type: "preview"; drag: DragPreview | null }
  | { type: "move"; ids: number[]; dTick: number; dPitch: number; copy: boolean }
  | { type: "resize"; ids: number[]; dDur: number }
  | { type: "add"; pitch: number; tick: number }
  | { type: "erase"; ids: number[] }
  /** Sound a pitch: a note tapped, or dragged onto a new key. */
  | { type: "audition"; pitch: number }
  | { type: "keyDown"; id: number; pitch: number; velocity: number }
  | { type: "keyUp"; id: number };

type Gesture =
  | { g: "idle" }
  | {
      g: "press";
      id: number;
      x0: number;
      y0: number;
      t0: number;
      lastY: number;
      zone: Zone;
      hit: NoteHit | null;
      pointer: PointerKind;
      shift: boolean;
      alt: boolean;
    }
  | { g: "scroll"; id: number; lastY: number }
  | { g: "box"; id: number; x0: number; y0: number; add: boolean }
  | {
      g: "move";
      id: number;
      x0: number;
      y0: number;
      ids: number[];
      /** The note under the finger, for auditioning, and the limits the group may move within. */
      grabbed: NoteBox;
      minTick: number;
      lowest: number;
      highest: number;
      copy: boolean;
      dTick: number;
      dPitch: number;
    }
  | { g: "resize"; id: number; y0: number; ids: number[]; shortest: number; dDur: number }
  | { g: "erase"; id: number; ids: number[] }
  | { g: "pinch"; spread: number };

export interface State {
  gesture: Gesture;
  /** Fingers on the waterfall, for pinching. */
  touches: ReadonlyMap<number, { x: number; y: number }>;
  /** Pointers holding keys of the keyboard down, and which key each holds. */
  keys: ReadonlyMap<number, number>;
}

export const initialState = (): State => ({ gesture: { g: "idle" }, touches: new Map(), keys: new Map() });

export const SLOP = { mouse: 4, pen: 6, touch: 10 } as const;
export const LONG_PRESS_MS = 450;

const idle: Gesture = { g: "idle" };

/** How hard a key was struck, from how far down it was touched: near its tip is loudest. */
export function keyVelocity(v: View, pitch: number, y: number): number {
  const f = frame(v);
  const top = f.bottom + 3;
  const full = v.kbH - 3;
  const black = [1, 3, 6, 8, 10].includes(pitch % 12);
  const length = black ? full * BLACK_KEY_HEIGHT : full;
  const along = Math.min(1, Math.max(0, (y - top) / length));
  return Math.round((0.35 + 0.6 * along) * 100) / 100;
}

const snapTo = (tick: number, snap: number) => Math.round(tick / snap) * snap;

export function step(state: State, input: Input, env: Env): { state: State; intents: Intent[] } {
  const intents: Intent[] = [];
  const v = env.view;
  let gesture = state.gesture;
  let touches = state.touches;
  let keys = state.keys;
  const done = () => ({ state: { gesture, touches, keys }, intents });
  const noteOf = (id: number) => env.notes.find((n) => n.id === id);

  if (input.kind === "escape") {
    if (gesture.g === "move" || gesture.g === "resize" || gesture.g === "erase")
      intents.push({ type: "preview", drag: null });
    if (gesture.g === "box") intents.push({ type: "box", box: null });
    if (gesture.g === "scroll") intents.push({ type: "scrollEnd" });
    gesture = idle;
    return done();
  }

  if (input.kind === "wheel") {
    if (input.zoom) intents.push({ type: "zoom", factor: Math.exp(input.dy / 240), y: input.y });
    else intents.push({ type: "scroll", px: -input.dy });
    return done();
  }

  if (input.kind === "time") {
    // A finger held still on empty space, with the Select tool: the start of a box.
    if (
      gesture.g === "press" &&
      gesture.pointer === "touch" &&
      gesture.zone === "waterfall" &&
      !gesture.hit &&
      env.tool === "select" &&
      !env.readOnly &&
      input.t - gesture.t0 >= LONG_PRESS_MS
    ) {
      const box = { x0: gesture.x0, y0: gesture.y0, x1: gesture.x0, y1: gesture.y0 };
      gesture = { g: "box", id: gesture.id, x0: gesture.x0, y0: gesture.y0, add: gesture.shift || env.addToSelection };
      intents.push({ type: "box", box });
    }
    return done();
  }

  const { id, x, y } = input;

  // ── The keyboard: every pointer on it plays, whatever else is going on. ──
  if (input.kind === "down" && zoneAt(v, x, y) === "keys") {
    const pitch = pitchAtX(v, x, { y });
    if (pitch !== null) {
      keys = new Map(keys).set(id, pitch);
      intents.push({ type: "keyDown", id, pitch, velocity: keyVelocity(v, pitch, y) });
    }
    return done();
  }
  if (keys.has(id)) {
    if (input.kind === "move") {
      // Sliding along the keyboard plays each key the finger reaches.
      const pitch = zoneAt(v, x, y) === "keys" ? pitchAtX(v, x, { y }) : null;
      if (pitch !== null && pitch !== keys.get(id)) {
        keys = new Map(keys).set(id, pitch);
        intents.push({ type: "keyUp", id }, { type: "keyDown", id, pitch, velocity: keyVelocity(v, pitch, y) });
      }
    } else {
      const next = new Map(keys);
      next.delete(id);
      keys = next;
      intents.push({ type: "keyUp", id });
    }
    return done();
  }

  // ── Fingers on the waterfall: two of them pinch. ──
  if (input.pointer === "touch") {
    const next = new Map(touches);
    if (input.kind === "down" || (input.kind === "move" && next.has(id))) next.set(id, { x, y });
    else if (input.kind === "up" || input.kind === "cancel") next.delete(id);
    touches = next;
    if (touches.size >= 2) {
      const [a, b] = [...touches.values()];
      const spread = Math.max(24, Math.hypot(a.x - b.x, a.y - b.y));
      if (gesture.g !== "pinch") {
        // Whatever one finger had begun is abandoned.
        if (gesture.g === "move" || gesture.g === "resize" || gesture.g === "erase")
          intents.push({ type: "preview", drag: null });
        if (gesture.g === "box") intents.push({ type: "box", box: null });
        gesture = { g: "pinch", spread };
      } else {
        intents.push({ type: "zoom", factor: gesture.spread / spread, y: (a.y + b.y) / 2 });
        gesture = { g: "pinch", spread };
      }
      return done();
    }
    if (gesture.g === "pinch") {
      // One finger is left: the pinch is over, and that finger does nothing more.
      if (touches.size === 0) {
        gesture = idle;
        intents.push({ type: "scrollEnd" });
      }
      return done();
    }
  }

  if (input.kind === "down") {
    if (gesture.g !== "idle") return done(); // a second mouse button, or a stray pointer
    const zone = zoneAt(v, x, y);
    const touch = input.pointer === "touch";
    const hit =
      zone === "waterfall" && !env.readOnly
        ? hitNote(v, env.notes, x, y, { touch, handles: env.tool !== "erase" })
        : null;
    if (zone === "waterfall" && env.tool === "erase" && !env.readOnly) {
      const ids = hit ? [hit.id] : [];
      gesture = { g: "erase", id, ids };
      if (ids.length) intents.push({ type: "preview", drag: eraseDrag(ids) });
      return done();
    }
    gesture = {
      g: "press",
      id,
      x0: x,
      y0: y,
      t0: input.t,
      lastY: y,
      zone,
      hit,
      pointer: input.pointer,
      shift: !!input.shift,
      alt: !!input.alt,
    };
    return done();
  }

  if (gesture.g === "idle" || !("id" in gesture) || gesture.id !== id) return done();

  if (input.kind === "cancel") {
    if (gesture.g === "move" || gesture.g === "resize" || gesture.g === "erase")
      intents.push({ type: "preview", drag: null });
    if (gesture.g === "box") intents.push({ type: "box", box: null });
    if (gesture.g === "scroll") intents.push({ type: "scrollEnd" });
    gesture = idle;
    return done();
  }

  switch (gesture.g) {
    case "press": {
      if (input.kind === "up") {
        tap(gesture, env, intents);
        gesture = idle;
        return done();
      }
      if (Math.hypot(x - gesture.x0, y - gesture.y0) <= SLOP[gesture.pointer]) return done();
      // The press has become a drag: of what?
      const hit = gesture.hit;
      if (hit && gesture.zone === "waterfall") {
        const grabbed = noteOf(hit.id)!;
        const ids = env.selection.has(hit.id) ? [...env.selection].filter((i) => noteOf(i)) : [hit.id];
        if (!env.selection.has(hit.id)) intents.push({ type: "select", ids, mode: "replace" });
        const held = ids.map((i) => noteOf(i)!);
        if (hit.part === "top") {
          gesture = { g: "resize", id, y0: gesture.y0, ids, shortest: Math.min(...held.map((n) => n.dur)), dDur: 0 };
        } else {
          gesture = {
            g: "move",
            id,
            x0: gesture.x0,
            y0: gesture.y0,
            ids,
            grabbed,
            minTick: Math.min(...held.map((n) => n.tick)),
            lowest: Math.min(...held.map((n) => n.pitch)),
            highest: Math.max(...held.map((n) => n.pitch)),
            copy: !!input.alt || gesture.alt,
            dTick: 0,
            dPitch: 0,
          };
        }
        return merge(intents, step({ gesture, touches, keys }, input, env));
      }
      if (gesture.zone === "waterfall" && gesture.pointer !== "touch" && env.tool === "select" && !env.readOnly) {
        gesture = { g: "box", id, x0: gesture.x0, y0: gesture.y0, add: gesture.shift || env.addToSelection };
        return merge(intents, step({ gesture, touches, keys }, input, env));
      }
      intents.push({ type: "scroll", px: y - gesture.lastY });
      gesture = { g: "scroll", id, lastY: y };
      return done();
    }

    case "scroll": {
      if (input.kind === "up") {
        intents.push({ type: "scrollEnd" });
        gesture = idle;
      } else {
        intents.push({ type: "scroll", px: y - gesture.lastY });
        gesture = { ...gesture, lastY: y };
      }
      return done();
    }

    case "box": {
      const box = { x0: gesture.x0, y0: gesture.y0, x1: x, y1: y };
      if (input.kind === "up") {
        const ids = notesInBox(v, env.notes, { x: box.x0, y: box.y0 }, { x, y });
        intents.push({ type: "box", box: null }, { type: "select", ids, mode: gesture.add ? "add" : "replace" });
        gesture = idle;
      } else intents.push({ type: "box", box });
      return done();
    }

    case "move": {
      // Up the screen is later; across it, from the column the drag began in to the one it is in now.
      const rawTicks = (gesture.y0 - y) * v.ticksPerPx;
      const dTick = Math.max(-gesture.minTick, snapTo(rawTicks, env.snap));
      const from = pitchAtX(v, clampX(v, gesture.x0)) ?? gesture.grabbed.pitch;
      const to = pitchAtX(v, clampX(v, x)) ?? from;
      const dPitch = Math.min(MAX_PITCH - gesture.highest, Math.max(MIN_PITCH - gesture.lowest, to - from));
      if (input.kind === "up") {
        intents.push({ type: "preview", drag: null });
        if (dTick !== 0 || dPitch !== 0 || gesture.copy) {
          intents.push({ type: "move", ids: gesture.ids, dTick, dPitch, copy: gesture.copy });
        }
        gesture = idle;
        return done();
      }
      if (dPitch !== gesture.dPitch) intents.push({ type: "audition", pitch: gesture.grabbed.pitch + dPitch });
      intents.push({
        type: "preview",
        drag: { ids: new Set(gesture.ids), dTick, dPitch, dDur: 0, copy: gesture.copy },
      });
      gesture = { ...gesture, dTick, dPitch };
      return done();
    }

    case "resize": {
      const rawTicks = (gesture.y0 - y) * v.ticksPerPx;
      // No note may end up shorter than a grid step (or than it already is, if it is shorter still).
      const floor = Math.min(env.snap, gesture.shortest);
      const dDur = Math.max(floor - gesture.shortest, snapTo(rawTicks, env.snap));
      if (input.kind === "up") {
        intents.push({ type: "preview", drag: null });
        if (dDur !== 0) intents.push({ type: "resize", ids: gesture.ids, dDur });
        gesture = idle;
        return done();
      }
      intents.push({ type: "preview", drag: { ids: new Set(gesture.ids), dTick: 0, dPitch: 0, dDur, copy: false } });
      gesture = { ...gesture, dDur };
      return done();
    }

    case "erase": {
      const hit =
        zoneAt(v, x, y) === "waterfall"
          ? hitNote(v, env.notes, x, y, { handles: false, touch: input.pointer === "touch" })
          : null;
      let ids = gesture.ids;
      if (hit && !ids.includes(hit.id)) ids = [...ids, hit.id];
      if (input.kind === "up") {
        intents.push({ type: "preview", drag: null });
        if (ids.length) intents.push({ type: "erase", ids });
        gesture = idle;
        return done();
      }
      if (ids !== gesture.ids) intents.push({ type: "preview", drag: eraseDrag(ids) });
      gesture = { ...gesture, ids };
      return done();
    }

    default:
      return done();
  }
}

/** A press that ended where it began. */
function tap(g: Extract<Gesture, { g: "press" }>, env: Env, out: Intent[]) {
  const v = env.view;
  const tick = Math.max(0, tickAtY(v, g.y0));
  if (g.zone === "bars") out.push({ type: "cursor", tick: Math.max(0, snapTo(tick, env.snap)) });
  else if (g.zone === "chords") out.push({ type: "chord", tick });
  else if (g.zone === "waterfall" && !env.readOnly) {
    if (g.hit) {
      const add = g.shift || env.addToSelection;
      out.push({ type: "select", ids: [g.hit.id], mode: add ? "toggle" : "replace" });
      const note = env.notes.find((n) => n.id === g.hit!.id);
      if (note) out.push({ type: "audition", pitch: note.pitch });
    } else if (env.tool === "draw") {
      const pitch = pitchAtX(v, g.x0);
      // A new note fills the grid cell that was touched.
      if (pitch !== null) out.push({ type: "add", pitch, tick: Math.floor(tick / env.snap) * env.snap });
    } else if (env.selection.size) out.push({ type: "select", ids: [], mode: "replace" });
  }
}

const eraseDrag = (ids: number[]): DragPreview => ({
  ids: new Set(ids),
  dTick: 0,
  dPitch: 0,
  dDur: 0,
  copy: false,
  erase: true,
});

function clampX(v: View, x: number): number {
  const f = frame(v);
  return Math.min(f.right - 0.5, Math.max(f.left + 0.5, x));
}

function merge(before: Intent[], next: { state: State; intents: Intent[] }) {
  return { state: next.state, intents: [...before, ...next.intents] };
}
