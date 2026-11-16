/**
 * The Studio's sound: the Stage 2 player playing the project as compiled, recompiled and swapped
 * in after every edit, and the engine's live notes for keys, auditioning and whatever is dragged.
 */
import { sharedEngine, type Engine } from "../audio/engine";
import { Player } from "../audio/player";
import type { Channel } from "../audio/types";
import { makeTimeMap, type TimeMap } from "../music/time";
import { compileProject } from "../project/compile";
import type { NoteTrack, Project } from "../project/types";
import type { ProjectStoreHandle } from "../project/store";
import type { UiStore } from "./ui-store";

export interface Playback {
  player: Player;
  engine: Engine;
  /** The project's time map, kept in step with its tempo and meter. */
  time(): TimeMap;
  /** Where playback is, in ticks. */
  tick(): number;
  /** Play from the cursor, or from the loop's start when the cursor is outside it. */
  play(opts?: { countIn?: boolean }): Promise<void>;
  stop(): void;
  toggle(): void;
  /** A key goes down or comes up, on a track's sound. */
  noteOn(pitch: number, velocity: number, trackId: string): void;
  noteOff(pitch: number, trackId: string): void;
  /** Sound a note briefly: one just written, selected, or moved to a new pitch. */
  audition(pitches: readonly number[], trackId: string, velocity?: number): void;
  /** Let playback run this many bars past the end of the song: room to record into. 0 puts it back. */
  extend(bars: number): void;
  /** Make ready to be played by hand: called from the first touch, which the browser needs. */
  wake(): void;
  dispose(): void;
}

const AUDITION_SECONDS = 0.28;

export function createPlayback(
  session: { store: ProjectStoreHandle; ui: UiStore },
  opts: { engine?: Engine } = {},
): Playback {
  const { store, ui } = session;
  const engine = opts.engine ?? sharedEngine();
  let project = store.getState().project;
  let time = makeTimeMap(project.tempo, project.meter);
  /** Bars of silence after the song's end that playback may run into (while recording). */
  let tailBars = 0;
  const compiled = () => {
    const song = compileProject(project);
    if (!tailBars) return song;
    const end = project.lengthTicks;
    const tail = time.secondsAt(end + tailBars * time.ticksPerBarAt(Math.max(0, end - 1))) - time.secondsAt(end);
    return { ...song, duration: (song.duration ?? 0) + tail };
  };
  const player = new Player(compileProject(project), { sound: "clear" }, { engine });

  const trackOf = (id: string): NoteTrack | undefined =>
    store.getState().project.tracks.find((t): t is NoteTrack => t.kind === "notes" && t.id === id);
  const channelOf = (id: string): Channel => {
    const t = trackOf(id);
    return t ? { hand: t.hand, track: t.id, sound: t.sound } : { hand: "R" };
  };

  /** The loop in the editor's state, in ticks, handed to the player in seconds. */
  const applyLoop = () => {
    const loop = ui.getState().loop;
    if (!loop || loop.end <= loop.start) player.setLoop({ enabled: false, start: 0, end: player.duration });
    else player.setLoop({ enabled: true, start: time.secondsAt(loop.start), end: time.secondsAt(loop.end) });
  };

  // Recompile once per burst of edits, and swap the song under the transport without a gap.
  let queued = false;
  const recompile = () => {
    queued = false;
    const next = store.getState().project;
    if (next === project) return;
    const timing = next.tempo !== project.tempo || next.meter !== project.meter;
    // Where the playhead is, in ticks, before the tempo under it changes.
    const at = timing ? time.tickAt(player.currentTime()) : 0;
    project = next;
    if (timing) time = makeTimeMap(project.tempo, project.meter);
    player.setSong(compiled(), { keepPosition: true });
    if (timing && !player.state.playing) player.seek(time.secondsAt(at));
    applyLoop();
  };
  const offStore = store.subscribe(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(recompile);
  });

  let lastLoop = ui.getState().loop;
  let lastMetronome = ui.getState().metronome;
  player.setMetronome(lastMetronome);
  applyLoop();
  const offUi = ui.subscribe((s) => {
    if (s.loop !== lastLoop) {
      lastLoop = s.loop;
      applyLoop();
    }
    if (s.metronome !== lastMetronome) {
      lastMetronome = s.metronome;
      player.setMetronome(s.metronome);
    }
  });
  const offPlayer = player.subscribe(() => {
    if (player.state.playing !== ui.getState().playing) ui.setState({ playing: player.state.playing });
  });

  let awake = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const wake = () => {
    if (awake) return;
    awake = true;
    void engine.start();
    // Build the active track's instrument now, so its first note does not wait on that.
    try {
      engine.prepare(channelOf(ui.getState().activeTrack));
    } catch {
      /* the first note will build it instead */
    }
  };

  const api: Playback = {
    player,
    engine,
    time: () => {
      if (queued) recompile();
      return time;
    },
    tick: () => time.tickAt(player.currentTime()),

    async play(o = {}) {
      if (queued) recompile();
      wake();
      const { cursor, loop } = ui.getState();
      const from = loop && (cursor < loop.start || cursor >= loop.end) ? loop.start : cursor;
      player.seek(Math.min(time.secondsAt(from), Math.max(0, player.duration - 0.01)));
      await player.play({ countInBars: o.countIn ? 1 : 0 });
    },
    stop() {
      if (player.state.playing) player.pause();
    },
    toggle() {
      if (player.state.playing) api.stop();
      else void api.play();
    },

    noteOn(pitch, velocity, trackId) {
      wake();
      engine.noteOn(pitch, velocity, channelOf(trackId));
    },
    noteOff(pitch, trackId) {
      engine.noteOff(pitch, channelOf(trackId));
    },
    audition(pitches, trackId, velocity = 0.7) {
      wake();
      const ch = channelOf(trackId);
      for (const p of pitches) engine.noteOn(p, velocity, ch);
      const timer = setTimeout(() => {
        timers.delete(timer);
        for (const p of pitches) engine.noteOff(p, ch);
      }, AUDITION_SECONDS * 1000);
      timers.add(timer);
    },
    wake,
    extend(bars) {
      if (queued) recompile();
      if (bars === tailBars) return;
      tailBars = bars;
      player.setSong(compiled(), { keepPosition: true });
      applyLoop();
    },

    dispose() {
      offStore();
      offUi();
      offPlayer();
      for (const t of timers) clearTimeout(t);
      player.pause();
      engine.releaseAll();
      player.dispose();
    },
  };
  return api;
}

/** A project's time map without a playback: for drawing a project nothing is playing. */
export const timeMapOf = (p: Project) => makeTimeMap(p.tempo, p.meter);
