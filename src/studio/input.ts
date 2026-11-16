/**
 * One path for every key press, wherever it came from — the keys on screen, the computer keyboard
 * ("musical typing"), a MIDI keyboard. A press always makes its sound; then step entry writes it at
 * the cursor, or a recording captures it with its timing, or (in Listen) nothing more happens.
 */
import { inputLatencyMs } from "../audio/latency";
import { midiSupported, openMidi, type MidiConnection } from "../audio/midi-in";
import type { NoteColor } from "../components/stage-draw";
import type { ProjectStoreHandle } from "../project/store";
import type { NoteTrack } from "../project/types";
import { MAX_PITCH, MIN_PITCH } from "../song/ids";
import { trackColor } from "./layers";
import type { Playback } from "./playback";
import { takeToNotes, type Played } from "./record";
import * as stepper from "./step";
import { lengthTicks, type UiStore } from "./ui-store";
import type { EditOp } from "../project/types";

export type KeySource = "screen" | "typing" | "midi";

/** When a key event happened, if the caller knows better than "now": tests script a performance. */
export interface KeyTime {
  /** Song seconds, for a recording. */
  song?: number;
  /** Milliseconds on any forward clock, for telling a chord from a run in step entry. */
  now?: number;
}

export interface NoteInput {
  down(pitch: number, velocity: number, source: KeySource, at?: KeyTime): void;
  up(pitch: number, source: KeySource, at?: KeyTime): void;
  /** Step entry: move on without writing; hold the last note longer; take back the last step. */
  rest(): void;
  tie(): void;
  backspace(): boolean;
  /** Start recording (after a count-in, if that is on), or stop and keep the take. */
  toggleRecord(): void;
  stopRecording(): void;
  /** A computer-keyboard event while musical typing is on. True if the key was a note or an octave shift. */
  typing(e: Pick<KeyboardEvent, "key" | "repeat">, down: boolean): boolean;
  connectMidi(): Promise<void>;
  disconnectMidi(): void;
  /** Tell the canvas which keys are down. */
  onHeld(fn: (held: ReadonlyMap<number, NoteColor>) => void): () => void;
  dispose(): void;
}

/** `A S D F G H J K` are the white keys from C; `W E T Y U` the black keys between them. */
export const TYPING_KEYS: Record<string, number> = {
  a: 0,
  w: 1,
  s: 2,
  e: 3,
  d: 4,
  f: 5,
  t: 6,
  g: 7,
  y: 8,
  h: 9,
  u: 10,
  j: 11,
  k: 12,
};

/** Bars a recording may run past the end of the song before it stops by itself. */
const RECORD_TAIL_BARS = 64;

export interface InputDeps {
  store: ProjectStoreHandle;
  ui: UiStore;
  playback: Playback;
  readOnly: boolean;
  /** Apply an edit as one undo step; false if it was refused. */
  edit(ops: EditOp[], label: string): boolean;
  say(text: string): void;
  describeNote(id: number): string;
}

export function createInput(deps: InputDeps): NoteInput {
  const { store, ui, playback } = deps;
  let step = stepper.initialStep();
  const held = new Map<number, { count: number; track: string }>();
  const heldListeners = new Set<(held: ReadonlyMap<number, NoteColor>) => void>();

  const activeNotes = (): NoteTrack | null => {
    const t = store.getState().project.tracks.find((x) => x.id === ui.getState().activeTrack);
    return t?.kind === "notes" ? t : null;
  };
  const showHeld = () => {
    const p = store.getState().project;
    const lit = new Map<number, NoteColor>();
    for (const [pitch, h] of held) lit.set(pitch, trackColor(p, h.track));
    heldListeners.forEach((fn) => fn(lit));
  };

  // ── Recording ──
  let playing: Map<number, { on: number; velocity: number }> = new Map();
  let taken: Played[] = [];
  let recordingTrack: string | null = null;
  let metronomeBefore = false;
  let started = false;
  let offWrap = () => {};

  const songNow = () => playback.player.currentTime();
  const counting = () => playback.player.state.countIn;

  /** Turn what has been played so far into notes, as one undo step. `until` ends a loop pass. */
  const commit = (until?: number) => {
    const end = until ?? songNow();
    for (const [pitch, n] of playing) taken.push({ pitch, velocity: n.velocity, on: n.on, off: Math.max(n.on, end) });
    // Keys still down at a loop's end carry on into the next pass, from its start.
    const loop = ui.getState().loop;
    const time = playback.time();
    if (until !== undefined && loop) {
      const restart = time.secondsAt(loop.start);
      for (const n of playing.values()) n.on = restart;
    } else playing = new Map();
    const track = recordingTrack && store.getState().project.tracks.find((t) => t.id === recordingTrack);
    if (!taken.length || !track || track.kind !== "notes") {
      taken = [];
      return 0;
    }
    const s = ui.getState();
    const notes = takeToNotes(taken, time, {
      grid: s.snap,
      latencyMs: inputLatencyMs(),
      until: until !== undefined ? Math.round(time.tickAt(until)) : undefined,
    });
    taken = [];
    if (!notes.length) return 0;
    const ops: EditOp[] = [{ op: "addNotes", trackId: track.id, notes }];
    // "Keep my timing": whether the played feel is heard, or the take plays exactly on the grid.
    const feel = s.keepTiming ? 1 : 0;
    if (track.feel !== feel) ops.push({ op: "patchTrack", trackId: track.id, patch: { feel } });
    return deps.edit(ops, `Record ${notes.length} ${notes.length === 1 ? "note" : "notes"}`) ? notes.length : 0;
  };

  const finish = () => {
    if (!ui.getState().recording) return;
    const count = commit();
    offWrap();
    offWrap = () => {};
    recordingTrack = null;
    started = false;
    playback.extend(0);
    ui.setState({ recording: false, metronome: metronomeBefore });
    deps.say(count ? `Recorded ${count} ${count === 1 ? "note" : "notes"}` : "Recording stopped");
  };

  // A recording ends when the transport stops, however it was stopped.
  const offUi = ui.subscribe((s) => {
    if (!s.recording) return;
    if (s.playing) started = true;
    else if (started) finish();
  });

  const startRecording = async () => {
    const track = activeNotes();
    if (deps.readOnly) return;
    if (!track) return deps.say("Choose a note track to record onto");
    if (track.locked) return deps.say(`The ${track.name} track is locked`);
    if (ui.getState().playing) playback.stop();
    recordingTrack = track.id;
    taken = [];
    playing = new Map();
    started = false;
    metronomeBefore = ui.getState().metronome;
    step = stepper.initialStep();
    // Room to play past the end of what is written; the song grows to fit what is recorded.
    if (!ui.getState().loop) playback.extend(RECORD_TAIL_BARS);
    ui.setState({ recording: true, metronome: true, selection: [] });
    offWrap = playback.player.onLoopWrap(() => {
      const loop = ui.getState().loop;
      if (loop) commit(playback.time().secondsAt(loop.end));
    });
    deps.say(ui.getState().countIn ? "Recording after one bar" : "Recording");
    await playback.play({ countIn: ui.getState().countIn });
  };

  // ── Musical typing ──
  const typed = new Map<string, number>();

  // ── MIDI ──
  let midi: MidiConnection | null = null;

  const api: NoteInput = {
    down(pitch, velocity, _source, at) {
      if (pitch < MIN_PITCH || pitch > MAX_PITCH) return;
      const s = ui.getState();
      const track = activeNotes();
      const vel = Math.min(1, Math.max(0.05, velocity));
      if (track) playback.noteOn(pitch, vel, track.id);
      const h = held.get(pitch);
      held.set(pitch, { count: (h?.count ?? 0) + 1, track: s.activeTrack });
      showHeld();
      if (deps.readOnly || !track) return;

      if (s.recording) {
        if (counting() && at?.song === undefined) return; // played during the count-in: not part of the take
        playing.set(pitch, { on: at?.song ?? songNow(), velocity: vel });
        return;
      }
      if (s.input !== "step" || s.playing) return;
      if (track.locked) return deps.say(`The ${track.name} track is locked`);
      const project = store.getState().project;
      const id = project.seq;
      const out = stepper.keyDown(step, project, track.id, s.cursor, lengthTicks(s.length), {
        pitch,
        velocity: vel,
        now: at?.now ?? performance.now(),
      });
      if (!deps.edit(out.ops, out.label)) return;
      step = out.state;
      if (out.cursor !== undefined) ui.setState({ cursor: out.cursor, selection: [] });
      deps.say(deps.describeNote(id));
    },

    up(pitch, _source, at) {
      const h = held.get(pitch);
      if (!h) return;
      if (h.count <= 1) {
        held.delete(pitch);
        playback.noteOff(pitch, h.track);
      } else held.set(pitch, { ...h, count: h.count - 1 });
      showHeld();
      const n = playing.get(pitch);
      if (n && ui.getState().recording) {
        playing.delete(pitch);
        taken.push({ pitch, velocity: n.velocity, on: n.on, off: Math.max(n.on, at?.song ?? songNow()) });
      }
      step = stepper.keyUp(step);
    },

    rest() {
      const s = ui.getState();
      if (deps.readOnly || s.recording || s.playing) return;
      const out = stepper.rest(step, s.cursor, lengthTicks(s.length));
      step = out.state;
      ui.setState({ cursor: out.cursor! });
      deps.say("Rest");
    },

    tie() {
      const s = ui.getState();
      const track = activeNotes();
      if (deps.readOnly || !track || s.recording || s.playing) return;
      const out = stepper.tie(step, store.getState().project, track.id, s.cursor, lengthTicks(s.length));
      if (!out) return deps.say("Nothing to tie: write a note first");
      if (!deps.edit(out.ops, out.label)) return;
      step = out.state;
      ui.setState({ cursor: out.cursor! });
      deps.say("Tied");
    },

    backspace() {
      const track = activeNotes();
      if (deps.readOnly || !track || ui.getState().recording) return false;
      const out = stepper.backspace(step, store.getState().project, track.id);
      if (!out) return false;
      if (out.ops.length && !deps.edit(out.ops, out.label)) return false;
      step = out.state;
      if (out.cursor !== undefined) ui.setState({ cursor: Math.max(0, out.cursor) });
      deps.say("Taken back");
      return true;
    },

    toggleRecord() {
      if (ui.getState().recording) api.stopRecording();
      else void startRecording();
    },
    stopRecording() {
      if (!ui.getState().recording) return;
      // Stopping the transport ends the recording (see the subscription above); if it never
      // started — stopped during the count-in — end it here.
      const wasPlaying = ui.getState().playing;
      playback.stop();
      if (!wasPlaying || ui.getState().recording) finish();
    },

    typing(e, down) {
      const key = e.key.toLowerCase();
      if (down && (key === "z" || key === "x")) {
        if (e.repeat) return true;
        const octave = Math.min(7, Math.max(0, ui.getState().typingOctave + (key === "x" ? 1 : -1)));
        ui.setState({ typingOctave: octave });
        deps.say(`Octave ${octave}`);
        return true;
      }
      if (!(key in TYPING_KEYS)) return false;
      if (down) {
        if (e.repeat || typed.has(key)) return true;
        const pitch = 12 * (ui.getState().typingOctave + 1) + TYPING_KEYS[key];
        typed.set(key, pitch);
        api.down(pitch, 0.8, "typing");
      } else {
        const pitch = typed.get(key);
        if (pitch === undefined) return false;
        typed.delete(key);
        api.up(pitch, "typing");
      }
      return true;
    },

    async connectMidi() {
      if (!midiSupported())
        return void ui.setState({ midi: { on: false, devices: [], error: "This browser has no MIDI." } });
      try {
        midi?.close();
        midi = await openMidi({
          noteOn: (pitch, velocity) => api.down(pitch, velocity, "midi"),
          noteOff: (pitch) => api.up(pitch, "midi"),
          pedal: (down) => playback.engine.setSustain(down),
          devices: (devices) => ui.setState({ midi: { on: true, devices, error: null } }),
        });
        playback.wake();
      } catch (err) {
        ui.setState({
          midi: {
            on: false,
            devices: [],
            error: `MIDI was not allowed (${err instanceof Error ? err.message : String(err)}).`,
          },
        });
      }
    },
    disconnectMidi() {
      midi?.close();
      midi = null;
      playback.engine.setSustain(false);
      ui.setState({ midi: { on: false, devices: [], error: null } });
    },

    onHeld(fn) {
      heldListeners.add(fn);
      return () => heldListeners.delete(fn);
    },

    dispose() {
      offUi();
      offWrap();
      midi?.close();
      for (const [pitch, h] of held) playback.noteOff(pitch, h.track);
      held.clear();
      heldListeners.clear();
    },
  };
  return api;
}
