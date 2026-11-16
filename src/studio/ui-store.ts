/**
 * The editor's own state: where the cursor is, what is selected, which tool is in hand. None of it
 * is part of the song and none of it is undoable (docs/plan/03-studio-manual.md, Internals).
 * Cursor, zoom, active track and tool are remembered per project.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import { gridTicks, type Grid } from "../music/quantize";
import { PPQ } from "../music/time";

export type Tool = "select" | "draw" | "erase";
/** What a key press does: write a note at the cursor, or only make its sound. */
export type InputMode = "step" | "listen";
export type SheetId = "tracks" | "chords" | "sections" | "settings" | "inspector";
export type KeysMode = "fit" | "song" | "all";

/** The length a step-entered or drawn note gets. */
export interface StepLength {
  /** 1 = whole, 2 = half … 32 = thirty-second. */
  base: 1 | 2 | 4 | 8 | 16 | 32;
  dotted: boolean;
  triplet: boolean;
}

export interface UiState {
  /** Where the next note goes, in ticks. The cursor line is drawn here. */
  cursor: number;
  /** Selected note ids. A project's note ids are unique across its tracks. */
  selection: number[];
  tool: Tool;
  input: InputMode;
  activeTrack: string;
  /** Zoom: ticks of music per CSS pixel of waterfall. */
  ticksPerPx: number;
  /** Which keys the keyboard shows, and how many octaves it has been shifted from there. */
  keys: KeysMode;
  keyShift: number;
  length: StepLength;
  /** The grid that moves, draws and quantizes snap to. */
  snap: Grid;
  /** Other tracks can be selected and edited, not only the active one. */
  editAll: boolean;
  /** A tap adds to the selection, as Shift does on a keyboard. */
  addToSelection: boolean;
  /** Colour notes by the hand that will play them in Practice, not by track. */
  colourByHand: boolean;
  /** Letter keys play notes ("musical typing") instead of being commands. */
  typing: boolean;
  /** The octave musical typing starts from: 4 puts `A` on middle C. */
  typingOctave: number;
  sheet: SheetId | null;
  /** The tick the chord picker is working at. */
  chordTick: number | null;
  metronome: boolean;
  countIn: boolean;
  /** After recording, play the take back as it was played and not exactly on the grid. */
  keepTiming: boolean;
  /** The stretch that plays on repeat, in ticks; null plays on to the end. */
  loop: { start: number; end: number } | null;
  playing: boolean;
  recording: boolean;
  /** The first-run choices have been answered or dismissed. */
  started: boolean;
  /** What the live region last said. */
  announcement: string;
  /** MIDI keyboards: whether they are being listened to, which are connected, and why not if not. */
  midi: { on: boolean; devices: string[]; error: string | null };
}

/** The part of the state remembered for each project (contracts §10, `studio:<projectId>`). */
export type SavedUi = Pick<
  UiState,
  "cursor" | "tool" | "activeTrack" | "ticksPerPx" | "keys" | "keyShift" | "length" | "snap" | "colourByHand"
>;
const SAVED: (keyof SavedUi)[] = [
  "cursor",
  "tool",
  "activeTrack",
  "ticksPerPx",
  "keys",
  "keyShift",
  "length",
  "snap",
  "colourByHand",
];

/** Zoom limits are set by the canvas, which knows its height; these only keep stored values sane. */
export const MIN_TICKS_PER_PX = 0.5;
export const MAX_TICKS_PER_PX = 200;
export const DEFAULT_TICKS_PER_PX = (4 * PPQ * 4) / 520; // about four bars of 4/4 on a phone

export const initialUi = (activeTrack: string): UiState => ({
  cursor: 0,
  selection: [],
  tool: "select",
  input: "step",
  activeTrack,
  ticksPerPx: DEFAULT_TICKS_PER_PX,
  keys: "fit",
  keyShift: 0,
  length: { base: 4, dotted: false, triplet: false },
  snap: 16,
  editAll: false,
  addToSelection: false,
  colourByHand: false,
  typing: false,
  typingOctave: 4,
  sheet: null,
  chordTick: null,
  metronome: false,
  countIn: true,
  keepTiming: true,
  loop: null,
  playing: false,
  recording: false,
  started: false,
  announcement: "",
  midi: { on: false, devices: [], error: null },
});

export type UiStore = StoreApi<UiState>;

const GRIDS: Grid[] = [4, 8, 16, 32, "8t", "16t"];
const BASES = [1, 2, 4, 8, 16, 32];

/** Whatever was stored, made safe: unknown or damaged values fall back to the defaults. */
export function sanitizeSavedUi(raw: unknown, trackIds: readonly string[]): Partial<SavedUi> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<SavedUi> = {};
  const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  if (num(r.cursor) && r.cursor >= 0) out.cursor = Math.round(r.cursor);
  if (r.tool === "select" || r.tool === "draw" || r.tool === "erase") out.tool = r.tool;
  if (typeof r.activeTrack === "string" && trackIds.includes(r.activeTrack)) out.activeTrack = r.activeTrack;
  if (num(r.ticksPerPx)) out.ticksPerPx = Math.min(MAX_TICKS_PER_PX, Math.max(MIN_TICKS_PER_PX, r.ticksPerPx));
  if (r.keys === "fit" || r.keys === "song" || r.keys === "all") out.keys = r.keys;
  if (num(r.keyShift)) out.keyShift = Math.max(-4, Math.min(4, Math.round(r.keyShift)));
  if (GRIDS.includes(r.snap as Grid)) out.snap = r.snap as Grid;
  if (typeof r.colourByHand === "boolean") out.colourByHand = r.colourByHand;
  const len = r.length as Partial<StepLength> | undefined;
  if (len && BASES.includes(len.base as number)) {
    out.length = { base: len.base as StepLength["base"], dotted: !!len.dotted, triplet: !!len.triplet };
  }
  return out;
}

export function savedUiOf(s: UiState): SavedUi {
  return Object.fromEntries(SAVED.map((k) => [k, s[k]])) as SavedUi;
}

export function createUiStore(activeTrack: string, saved: Partial<SavedUi> = {}): UiStore {
  return createStore<UiState>(() => ({ ...initialUi(activeTrack), ...saved }));
}

/** Ticks a step length lasts. A dotted note is half as long again; a triplet is two thirds. */
export function lengthTicks(len: StepLength): number {
  let t = (PPQ * 4) / len.base;
  if (len.dotted) t = (t * 3) / 2;
  if (len.triplet) t = (t * 2) / 3;
  return Math.max(1, Math.round(t));
}

/** The snap step in ticks. */
export const snapTicks = (s: Pick<UiState, "snap">) => gridTicks(s.snap);
