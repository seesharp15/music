/**
 * The editor canvas's controller: it owns the view (what is on screen), redraws when something
 * changed, and turns scrolls and pinches into movement. No React in here; `EditorCanvas.tsx`
 * mounts it on a canvas.
 */
import type { NoteColor } from "../components/stage-draw";
import { gridTicks, quantize } from "../music/quantize";
import type { NoteTrack, Project } from "../project/types";
import { drawLayers, type DragPreview, type DrawState } from "./layers";
import type { Session } from "./session";
import type { UiState } from "./ui-store";
import {
  BAR_GUTTER,
  CHORD_GUTTER,
  chooseKeys,
  clampZoom,
  DRUM_LANE,
  frame,
  keyboardHeight,
  keyboardOf,
  keyRect,
  yAtTick,
  zoneAt,
  zoomAbout,
  type View,
} from "./view";

export interface Editor {
  /** The view as last laid out; null before the canvas has a size. */
  view(): View | null;
  /** Client coordinates of the middle of a note position, and of a key on the keyboard: for tests. */
  pointOf(pitch: number, tick: number): { x: number; y: number } | null;
  keyPoint(pitch: number): { x: number; y: number } | null;
  /** Show a drag in progress, a selection box, or the keys held down. */
  setDrag(drag: DragPreview | null): void;
  setBox(box: DrawState["box"]): void;
  setHeld(held: ReadonlyMap<number, NoteColor>): void;
  /** Move the music under the line by `px` (down is later), as a finger dragging it would. */
  scrollBy(px: number): void;
  /** The scroll has ended: the cursor settles on the nearest grid line. */
  scrollEnd(): void;
  /** Zoom by `factor` (above 1 shows more), keeping the music at canvas height `y` where it is. */
  zoomBy(factor: number, y?: number): void;
  /** Frames drawn so far, and how long the last ones took: for the performance check. */
  stats(): { frames: number; lastMs: number };
  dispose(): void;
}

const MOVE_TAU = 0.09; // seconds: the music gliding to a new cursor position
const KEYS_TAU = 0.16;
const NEAR_BARS = 2; // bars either side of the cursor that "fit" looks at
const TAIL_BARS = 4; // how far past the end of the song the view may go

export function createEditor(canvas: HTMLCanvasElement, session: Session): Editor {
  const { store, ui, playback } = session;
  const ctx = canvas.getContext("2d")!;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  let width = 0;
  let height = 0;
  let view: View | null = null;
  /** The tick under the line: follows the cursor, a scroll in progress, or playback. */
  let tick = ui.getState().cursor;
  let scrolling = false;
  let keyLo = NaN;
  let keyHi = NaN;
  let drag: DragPreview | null = null;
  let box: DrawState["box"] = null;
  let held: ReadonlyMap<number, NoteColor> = new Map();
  let dirty = true;
  let raf = 0;
  let last = performance.now();
  let frames = 0;
  let lastMs = 0;
  let drawn: unknown[] = [];

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dirty = true;
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  const offStore = store.subscribe(() => (dirty = true));
  const offUi = ui.subscribe(() => (dirty = true));

  const hasDrums = (p: Project) =>
    p.tracks.some((t) => t.kind === "drums" && (t.hits.length > 0 || t.clips.length > 0));

  // Which keys to show changes only with the notes, the mode and the width: remember the answer.
  let keysKey: unknown[] = [];
  let keysTarget = { keyLo: 23, keyHi: 37 };
  const targetKeys = (p: Project, s: UiState, keysWidth: number, barTicks: number) => {
    const track = p.tracks.find((t): t is NoteTrack => t.kind === "notes" && t.id === s.activeTrack);
    const region = Math.floor(s.cursor / Math.max(1, barTicks));
    const key = [
      s.keys === "song" ? p.tracks : track?.notes,
      s.keys,
      s.keyShift,
      Math.round(keysWidth),
      region,
      track?.id,
    ];
    if (key.every((k, i) => k === keysKey[i])) return keysTarget;
    keysKey = key;
    const all = (t: NoteTrack) => t.notes.map((n) => n.pitch);
    const pitches =
      s.keys === "song" ? p.tracks.flatMap((t) => (t.kind === "notes" ? all(t) : [])) : track ? all(track) : [];
    const reach = NEAR_BARS * barTicks;
    const near = track?.notes.filter((n) => Math.abs(n.tick - s.cursor) <= reach).map((n) => n.pitch);
    keysTarget = chooseKeys({ mode: s.keys, pitches, near, role: track?.role, shift: s.keyShift, width: keysWidth });
    return keysTarget;
  };

  const layout = (now: number): View => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const s = ui.getState();
    const p = store.getState().project;
    const time = playback.time();
    const ease = (x: number, to: number, tau: number) =>
      reduced || Number.isNaN(x) || Math.abs(to - x) < 1e-3 ? to : x + (to - x) * (1 - Math.exp(-dt / tau));

    const base = {
      width,
      height,
      barGutter: BAR_GUTTER,
      chordGutter: CHORD_GUTTER,
      lane: hasDrums(p) ? DRUM_LANE : 0,
      kbH: keyboardHeight(height),
    };
    const barTicks = time.ticksPerBarAt(s.cursor);
    const ticksPerPx = clampZoom(s.ticksPerPx, base, barTicks);
    const keys = targetKeys(p, s, frame(base).keysWidth, barTicks);
    keyLo = ease(keyLo, keys.keyLo, KEYS_TAU);
    keyHi = ease(keyHi, keys.keyHi, KEYS_TAU);

    if (s.playing) tick = playback.tick();
    else if (!scrolling) tick = ease(tick, s.cursor, MOVE_TAU);

    return { ...base, tick, ticksPerPx, keyLo, keyHi };
  };

  const draw = (now: number) => {
    raf = requestAnimationFrame(draw);
    if (width === 0 || height === 0) return;
    const v = layout(now);
    view = v;
    const s = ui.getState();
    const p = store.getState().project;
    // Draw only when something that is drawn has changed.
    const sig = [p, s, v.width, v.height, v.tick, v.ticksPerPx, v.keyLo, v.keyHi, v.lane, drag, box, held];
    if (!dirty && sig.every((x, i) => x === drawn[i])) return;
    dirty = false;
    drawn = sig;
    const t0 = performance.now();
    drawLayers(ctx, {
      project: p,
      ui: s,
      time: playback.time(),
      view: v,
      layout: keyboardOf(v),
      playTick: s.playing ? v.tick : null,
      drag,
      box,
      held,
      readOnly: session.readOnly,
    });
    lastMs = performance.now() - t0;
    frames++;
  };
  raf = requestAnimationFrame(draw);

  const maxTick = () => {
    const p = store.getState().project;
    return p.lengthTicks + TAIL_BARS * playback.time().ticksPerBarAt(Math.max(0, p.lengthTicks - 1));
  };
  const barTicksNow = () => playback.time().ticksPerBarAt(ui.getState().cursor);

  const api: Editor = {
    view: () => view,
    pointOf(pitch, t) {
      if (!view) return null;
      const r = canvas.getBoundingClientRect();
      const k = keyRect(view, pitch);
      return { x: r.left + k.x + k.w / 2, y: r.top + yAtTick(view, t) };
    },
    keyPoint(pitch) {
      if (!view) return null;
      const r = canvas.getBoundingClientRect();
      const k = keyRect(view, pitch);
      const f = frame(view);
      // Black keys are played near their top; white keys below where the black keys end.
      return { x: r.left + k.x + k.w / 2, y: r.top + f.bottom + (k.black ? view.kbH * 0.3 : view.kbH * 0.8) };
    },
    setDrag(d) {
      drag = d;
      dirty = true;
    },
    setBox(b) {
      box = b;
      dirty = true;
    },
    setHeld(h) {
      held = h;
      dirty = true;
    },
    scrollBy(px) {
      if (!view) return;
      if (ui.getState().playing) playback.stop();
      scrolling = true;
      tick = Math.min(maxTick(), Math.max(0, tick + px * view.ticksPerPx));
      dirty = true;
    },
    scrollEnd() {
      if (!scrolling) return;
      scrolling = false;
      const snapped = Math.max(0, quantize(Math.round(tick), ui.getState().snap));
      if (snapped !== ui.getState().cursor) ui.setState({ cursor: snapped });
      dirty = true;
    },
    zoomBy(factor, y) {
      if (!view) return;
      const z = zoomAbout(view, factor, y ?? frame(view).lineY, barTicksNow());
      // The line's tick moves so that the music under the fingers stays put.
      tick = Math.min(maxTick(), Math.max(0, z.tick));
      ui.setState({ ticksPerPx: z.ticksPerPx, cursor: Math.max(0, quantize(Math.round(tick), ui.getState().snap)) });
    },
    stats: () => ({ frames, lastMs }),
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      offStore();
      offUi();
    },
  };

  // ── Scrolling and zooming. Tools and note gestures are S3.3's. ──
  const pointers = new Map<number, { x: number; y: number }>();
  let moved = 0;
  let pinch = 0;
  const local = (e: PointerEvent | WheelEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    playback.wake();
    const at = local(e);
    if (view && zoneAt(view, at.x, at.y) === "keys") return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, at);
    moved = 0;
    pinch = 0;
  };
  const onMove = (e: PointerEvent) => {
    const was = pointers.get(e.pointerId);
    if (!was) return;
    const at = local(e);
    pointers.set(e.pointerId, at);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const spread = Math.max(20, Math.abs(a.y - b.y));
      if (pinch) api.zoomBy(pinch / spread, (a.y + b.y) / 2);
      pinch = spread;
      moved = Infinity;
      return;
    }
    moved += Math.abs(at.y - was.y) + Math.abs(at.x - was.x);
    if (moved > 8) api.scrollBy(at.y - was.y);
  };
  const onUp = (e: PointerEvent) => {
    const at = pointers.get(e.pointerId);
    if (!at) return;
    pointers.delete(e.pointerId);
    pinch = 0;
    if (pointers.size > 0) return;
    if (moved <= 8 && view && zoneAt(view, at.x, at.y) === "bars") {
      // A tap on the bar gutter puts the cursor there.
      const t = view.tick + (frame(view).lineY - at.y) * view.ticksPerPx;
      ui.setState({ cursor: Math.max(0, quantize(Math.round(t), ui.getState().snap)) });
    }
    api.scrollEnd();
  };
  let wheelEnd = 0;
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1;
    if (e.ctrlKey || e.metaKey) api.zoomBy(Math.exp((e.deltaY * unit) / 240), local(e).y);
    else {
      api.scrollBy(-e.deltaY * unit);
      clearTimeout(wheelEnd);
      wheelEnd = window.setTimeout(() => api.scrollEnd(), 140);
    }
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  const dispose = api.dispose;
  api.dispose = () => {
    dispose();
    clearTimeout(wheelEnd);
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", onUp);
    canvas.removeEventListener("pointercancel", onUp);
    canvas.removeEventListener("wheel", onWheel);
  };
  return api;
}

/** The snap step in ticks. */
export const snapTicks = (s: Pick<UiState, "snap">) => gridTicks(s.snap);
