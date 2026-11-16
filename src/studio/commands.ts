/**
 * The Studio's keyboard commands (docs/plan/03-studio-manual.md, "Editing"). One listener, so every
 * editing action is reachable without a pointer; what each key did is spoken by the live region.
 *
 * Tab is left alone — it moves focus, and taking it would trap keyboard users on the canvas — so
 * the next and previous track are on `]` and `[`.
 */
import {
  announce,
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  nudge,
  paste,
  quantizeSelection,
  select,
  selectAll,
  setCursor,
  stepCursor,
  transpose,
} from "./actions";
import { describeNote, lengthName } from "./describe";
import type { Session } from "./session";
import { lengthTicks, type StepLength } from "./ui-store";

export interface Shortcut {
  keys: string;
  does: string;
}

/** The list shown under "Keyboard shortcuts". */
export const SHORTCUTS: Shortcut[] = [
  { keys: "Space", does: "Play or stop, from the cursor" },
  { keys: "Enter", does: "Record" },
  { keys: "↑ ↓", does: "Cursor later or earlier by one step (Shift: one bar). With notes selected: move them" },
  { keys: "← →", does: "Selected notes down or up a semitone (Shift: an octave)" },
  { keys: "Alt + ↑ ↓", does: "Cursor to the next or previous note" },
  { keys: "S", does: "Select the notes at the cursor (Shift: add them to the selection)" },
  { keys: "1 – 6", does: "Note length: whole, half, quarter, eighth, sixteenth, thirty-second" },
  { keys: ". and T", does: "Dotted, triplet" },
  { keys: "0", does: "Rest: move on without writing" },
  { keys: "Backspace", does: "Delete the selection, or the last step" },
  { keys: "Ctrl/⌘ + Z, Shift + Z", does: "Undo, redo" },
  { keys: "Ctrl/⌘ + C, X, V, D, A", does: "Copy, cut, paste, duplicate, select all" },
  { keys: "Q", does: "Quantize the selection" },
  { keys: "[ and ]", does: "Previous and next track" },
  { keys: "Esc", does: "Clear the selection, or abandon a drag" },
  {
    keys: "Letters, with Musical typing on",
    does: "A S D F G H J K are the white keys from C; W E T Y U the black keys; Z and X shift the octave. Hold Alt for the commands above",
  },
];

const BASES: StepLength["base"][] = [1, 2, 4, 8, 16, 32];

/** True when the key belongs to whatever has focus: a text field, a slider, a menu. */
function busy(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el || !("tagName" in el)) return false;
  if (document.querySelector("dialog[open]")) return true;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable) return true;
  if (el.closest('[role="menu"]')) return true;
  // Space and Enter press the button or link that has focus.
  if ((e.key === " " || e.key === "Enter") && (tag === "BUTTON" || tag === "A" || tag === "SUMMARY")) return true;
  return false;
}

/** What other packages hang on the keyboard: note input takes letters; record takes Enter. */
export interface CommandHooks {
  /** Return true if the key was a note (musical typing) and has been dealt with. */
  typing?(e: KeyboardEvent, down: boolean): boolean;
  record?(): void;
  /** Step entry: a rest, and taking back the last step. Return true if there was one to take back. */
  rest?(): void;
  backspace?(): boolean;
}

export function installCommands(session: Session, hooks: CommandHooks = {}): () => void {
  const { ui, store, playback } = session;

  const setLength = (patch: Partial<StepLength>) => {
    const length = { ...ui.getState().length, ...patch };
    ui.setState({ length });
    announce(session, lengthName(lengthTicks(length)));
  };
  const nextTrack = (by: 1 | -1) => {
    const tracks = store.getState().project.tracks;
    const at = tracks.findIndex((t) => t.id === ui.getState().activeTrack);
    const next = tracks[(at + by + tracks.length) % tracks.length];
    if (!next) return;
    ui.setState({ activeTrack: next.id, selection: [] });
    announce(session, `${next.name} track`);
  };
  /** The notes of the active track that start at the cursor, or failing that, sound across it. */
  const notesAtCursor = () => {
    const { cursor, activeTrack } = ui.getState();
    const track = store.getState().project.tracks.find((t) => t.id === activeTrack);
    if (track?.kind !== "notes") return [];
    const starting = track.notes.filter((n) => n.tick === cursor);
    return starting.length ? starting : track.notes.filter((n) => n.tick < cursor && n.tick + n.dur > cursor);
  };
  const toNote = (direction: 1 | -1) => {
    const { cursor, activeTrack } = ui.getState();
    const project = store.getState().project;
    const track = project.tracks.find((t) => t.id === activeTrack);
    if (track?.kind !== "notes") return;
    const starts = track.notes.map((n) => n.tick);
    const to = direction > 0 ? starts.find((t) => t > cursor) : [...starts].reverse().find((t) => t < cursor);
    if (to === undefined) return announce(session, direction > 0 ? "No later note" : "No earlier note");
    setCursor(session, to, false);
    const here = track.notes.filter((n) => n.tick === to);
    announce(session, here.map((n) => describeNote(project, n)).join("; "));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (busy(e)) return;
    const s = ui.getState();
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const done = () => e.preventDefault();

    // Musical typing: plain letters are notes. Alt (or Ctrl/⌘) turns a letter back into a command.
    if (s.typing && !mod && !e.altKey && hooks.typing?.(e, true)) return done();

    if (mod) {
      if (session.readOnly && key !== "a" && key !== "c") return;
      switch (key) {
        case "z":
          if (e.shiftKey) store.redo();
          else store.undo();
          return done();
        case "y":
          store.redo();
          return done();
        case "c":
          if (copySelection(session)) done();
          return;
        case "x":
          cutSelection(session);
          return done();
        case "v":
          paste(session);
          return done();
        case "d":
          duplicateSelection(session);
          return done();
        case "a":
          selectAll(session);
          return done();
      }
      return;
    }

    const has = s.selection.length > 0;
    switch (key) {
      case " ":
        playback.toggle();
        return done();
      case "Enter":
        hooks.record?.();
        return done();
      case "ArrowUp":
      case "ArrowDown": {
        const dir = key === "ArrowUp" ? 1 : -1;
        if (e.altKey) toNote(dir);
        else if (has && !session.readOnly) nudge(session, dir, e.shiftKey ? "bar" : "step");
        else stepCursor(session, dir, e.shiftKey ? "bar" : "step");
        return done();
      }
      case "ArrowLeft":
      case "ArrowRight":
        if (!has || session.readOnly) return;
        transpose(session, (key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 12 : 1));
        return done();
      case "Home":
        setCursor(session, 0);
        return done();
      case "End":
        setCursor(session, store.getState().project.lengthTicks);
        return done();
      case "Escape":
        session.editor?.cancel();
        if (has) select(session, []);
        return;
      case "[":
        nextTrack(-1);
        return done();
      case "]":
        nextTrack(1);
        return done();
      case "s": {
        const ids = notesAtCursor().map((n) => n.id);
        if (!ids.length) announce(session, "No note at the cursor");
        else select(session, ids, e.shiftKey ? "add" : "replace");
        return done();
      }
    }
    if (session.readOnly) return;
    switch (key) {
      case "Backspace":
      case "Delete":
        if (has) deleteSelection(session);
        else if (!hooks.backspace?.()) announce(session, "Nothing to delete");
        return done();
      case "q":
        quantizeSelection(session);
        return done();
      case ".":
        setLength({ dotted: !s.length.dotted });
        return done();
      case "t":
        setLength({ triplet: !s.length.triplet });
        return done();
      case "0":
        hooks.rest?.();
        return done();
      default:
        if (/^[1-6]$/.test(key)) {
          setLength({ base: BASES[Number(key) - 1] });
          return done();
        }
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (ui.getState().typing) hooks.typing?.(e, false);
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
  };
}
