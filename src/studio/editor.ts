/**
 * The editor canvas's controller: it owns the view (what is on screen), redraws when something
 * changed, and turns scrolls and pinches into movement. No React in here; `EditorCanvas.tsx`
 * mounts it on a canvas.
 */
import type { NoteColor } from "../components/stage-draw";
import { gridTicks, quantize } from "../music/quantize";
import type { NoteTrack, Project } from "../project/types";
import { addNote, eraseNotes, grabbable, moveNotes, resizeNotes, select, setCursor } from "./actions";
import { initialState, LONG_PRESS_MS, step, type Input, type Intent } from "./interaction";
import { drawLayers, trackColor, type DragPreview, type DrawState } from "./layers";
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
  /** Abandon a drag or a box in progress (Escape). */
  cancel(): void;
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
      setCursor(session, Math.max(0, quantize(Math.round(tick), ui.getState().snap)));
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
    cancel() {},
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      offStore();
      offUi();
    },
  };

  // ── Gestures: DOM events into the state machine, its intents out to the actions. ──
  let machine = initialState();
  let pressTimer = 0;
  let wheelEnd = 0;
  const heldKeys = new Map<number, { pitch: number; track: string }>();

  const local = (e: PointerEvent | WheelEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const showHeld = () => {
    const p = store.getState().project;
    const lit = new Map<number, NoteColor>();
    for (const k of heldKeys.values()) lit.set(k.pitch, trackColor(p, k.track));
    api.setHeld(lit);
  };

  const carryOut = (intent: Intent) => {
    switch (intent.type) {
      case "scroll":
        return api.scrollBy(intent.px);
      case "scrollEnd":
        return api.scrollEnd();
      case "zoom":
        return api.zoomBy(intent.factor, intent.y);
      case "cursor":
        return setCursor(session, intent.tick);
      case "chord":
        return ui.setState({ sheet: "chords", chordTick: Math.max(0, Math.round(intent.tick)) });
      case "select":
        return select(session, intent.ids, intent.mode);
      case "box":
        return api.setBox(intent.box);
      case "preview":
        return api.setDrag(intent.drag);
      case "move":
        return moveNotes(session, intent.ids, intent.dTick, intent.dPitch, intent.copy);
      case "resize":
        return resizeNotes(session, intent.ids, intent.dDur);
      case "add":
        return void addNote(session, intent.pitch, intent.tick);
      case "erase":
        return eraseNotes(session, intent.ids);
      case "audition":
        return playback.audition([intent.pitch], ui.getState().activeTrack);
      case "keyDown": {
        const track = ui.getState().activeTrack;
        heldKeys.set(intent.id, { pitch: intent.pitch, track });
        session.keys.down(intent.pitch, intent.velocity, "screen");
        return showHeld();
      }
      case "keyUp": {
        const k = heldKeys.get(intent.id);
        if (!k) return;
        heldKeys.delete(intent.id);
        session.keys.up(k.pitch, "screen");
        return showHeld();
      }
    }
  };

  const feed = (input: Input) => {
    if (!view) return;
    const s = ui.getState();
    const p = store.getState().project;
    const out = step(machine, input, {
      view,
      tool: s.tool,
      readOnly: session.readOnly,
      notes: session.readOnly ? [] : grabbable(p, s),
      selection: new Set(s.selection),
      snap: gridTicks(s.snap),
      addToSelection: s.addToSelection,
    });
    machine = out.state;
    for (const intent of out.intents) carryOut(intent);
  };

  const pointerOf = (e: PointerEvent, kind: "down" | "move" | "up" | "cancel"): Input => ({
    kind,
    id: e.pointerId,
    ...local(e),
    t: e.timeStamp,
    pointer: e.pointerType === "touch" ? "touch" : e.pointerType === "pen" ? "pen" : "mouse",
    shift: e.shiftKey,
    alt: e.altKey,
  });
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    playback.wake();
    canvas.setPointerCapture(e.pointerId);
    feed(pointerOf(e, "down"));
    // A finger held still becomes a long press: the machine is told the time has passed.
    clearTimeout(pressTimer);
    const at = e.timeStamp;
    pressTimer = window.setTimeout(() => feed({ kind: "time", t: at + LONG_PRESS_MS }), LONG_PRESS_MS);
    e.preventDefault();
  };
  const onMove = (e: PointerEvent) => feed(pointerOf(e, "move"));
  const onUp = (e: PointerEvent) => {
    clearTimeout(pressTimer);
    feed(pointerOf(e, "up"));
  };
  const onCancel = (e: PointerEvent) => {
    clearTimeout(pressTimer);
    feed(pointerOf(e, "cancel"));
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1;
    const zoom = e.ctrlKey || e.metaKey;
    feed({ kind: "wheel", ...local(e), dy: e.deltaY * unit, zoom });
    if (!zoom) {
      clearTimeout(wheelEnd);
      wheelEnd = window.setTimeout(() => api.scrollEnd(), 140);
    }
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onCancel);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  const dispose = api.dispose;
  api.cancel = () => feed({ kind: "escape" });
  api.dispose = () => {
    dispose();
    clearTimeout(wheelEnd);
    clearTimeout(pressTimer);
    for (const k of heldKeys.values()) session.keys.up(k.pitch, "screen");
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", onUp);
    canvas.removeEventListener("pointercancel", onCancel);
    canvas.removeEventListener("wheel", onWheel);
  };
  return api;
}
