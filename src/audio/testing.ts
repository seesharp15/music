/**
 * The audio test harness (docs/plan/00-foundations.md). Three tools:
 *
 * - `recordSink` answers "what did the player schedule, and when?" by standing in for its sink.
 * - `renderOffline` answers "what does it sound like?" by rendering a song to samples, which the
 *   measuring helpers below turn into numbers a test can assert on.
 * - `renderPlayed` does both at once for the real player: its scheduler is run against an offline
 *   engine on a clock the harness steps, so what the player does part-way through (swap the song,
 *   solo a track) can be heard in the samples.
 *
 * Loaded on demand through `window.__app.testing()`; never part of the app's own bundles.
 */
import * as Tone from "tone";
import type { DrumPadId, Hand, Song, SoundId } from "../song/types";
import { Engine, sharedEngine } from "./engine";
import { Player, type Clock } from "./player";
import type { Mix } from "./mix";
import type { Channel, HandMix, Sink } from "./types";

export { Engine, Player, sharedEngine };
export { inputLatencyMs, setInputLatencyMs } from "./latency";

/** The audio clock, in seconds: the clock every `when` is measured on. */
export const audioNow = () => Tone.getContext().currentTime;

// ---- what was scheduled ------------------------------------------------------

export interface SinkCall {
  kind: "note" | "click" | "release" | "damp" | "drum";
  /** Audio-context time the sound was asked for. */
  when: number;
  /** Audio-context time the call was made. */
  at: number;
  pitch?: number;
  duration?: number;
  velocity?: number;
  hand?: Hand;
  track?: string;
  sound?: SoundId;
  accent?: boolean;
  pad?: DrumPadId;
}

export interface Recording {
  calls: SinkCall[];
  /** Puts the player's own sink back. */
  stop(): void;
}

/** Record every call the player makes to its sink. With `silent`, nothing is passed on to be heard. */
export function recordSink(player: Player, opts: { silent?: boolean; now?: () => number } = {}): Recording {
  const inner = player.sink;
  const calls: SinkCall[] = [];
  const now = opts.now ?? (() => Tone.getContext().currentTime);
  const recorder: Sink = {
    play(pitch: number, duration: number, velocity: number, ch: Channel, when: number) {
      const call: SinkCall = { kind: "note", when, at: now(), pitch, duration, velocity, hand: ch.hand };
      if (ch.track !== undefined) call.track = ch.track;
      if (ch.sound !== undefined) call.sound = ch.sound;
      calls.push(call);
      if (!opts.silent) inner.play(pitch, duration, velocity, ch, when);
    },
    click(accent: boolean, when: number) {
      calls.push({ kind: "click", when, at: now(), accent });
      if (!opts.silent) inner.click(accent, when);
    },
    drum(pad: DrumPadId, velocity: number, when: number, kit?: string) {
      calls.push({ kind: "drum", when, at: now(), pad, velocity });
      if (!opts.silent) inner.drum?.(pad, velocity, when, kit);
    },
    releaseAll() {
      calls.push({ kind: "release", when: now(), at: now() });
      inner.releaseAll();
    },
    damp(when?: number) {
      calls.push({ kind: "damp", when: when ?? now(), at: now() });
      inner.damp?.(when);
    },
  };
  player.sink = recorder;
  return { calls, stop: () => void (player.sink = inner) };
}

// ---- what it sounds like -----------------------------------------------------

export interface RenderOptions {
  sound?: SoundId;
  /** Length of the render. Defaults to the song plus two seconds for tails. */
  seconds?: number;
  stereo?: boolean;
  mix?: Mix;
  /** Hold the sustain pedal down throughout. */
  sustain?: boolean;
  /** Times at which whatever is ringing is silenced: the pedal lifting, or a loop coming round. */
  dampAt?: number[];
  /** Volume and mute changes part-way through, at times in seconds. */
  changes?: { time: number; hand: Hand; mix: HandMix }[];
  /** Track volumes and mutes, by track id; tracks not named play at the volume the song gives them. */
  trackMix?: Record<string, HandMix>;
  drumMix?: HandMix;
  sampleRate?: number;
}

export interface Rendered {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
}

/**
 * Render a song to samples, faster than real time and with no sound card involved. Every note and
 * drum hit goes straight to the engine at its written time: no player is involved (`renderPlayed`
 * is the one that runs the player).
 */
export async function renderOffline(song: Song, opts: RenderOptions = {}): Promise<Rendered> {
  const seconds = opts.seconds ?? (song.duration ?? 0) + 2;
  const sampleRate = opts.sampleRate ?? 44100;
  const buffer = await Tone.Offline(
    async () => {
      const engine = new Engine({
        sound: opts.sound ?? "clear",
        stereo: opts.stereo ?? false,
        mix: opts.mix,
        sustain: opts.sustain,
      });
      const sounds = new Map((song.tracks ?? []).map((t) => [t.id, t.sound]));
      for (const t of song.tracks ?? [])
        engine.setTrackMix(t.id, opts.trackMix?.[t.id] ?? { volume: t.volume ?? 1, muted: false }, 0);
      if (song.drums) engine.setDrumMix(opts.drumMix ?? { volume: song.drums.volume ?? 1, muted: false }, 0);
      if ((await engine.ready()) === "failed") throw new Error("The grand piano samples could not be loaded");
      for (const c of opts.changes ?? []) engine.setHandMix(c.hand, c.mix, c.time);
      // Notes and damps go in time order, as they would live: a damp silences what came before it.
      const damps = [...(opts.dampAt ?? [])].sort((a, b) => a - b);
      for (const n of song.notes) {
        while (damps.length && damps[0] <= n.time) engine.damp(damps.shift());
        const ch: Channel =
          n.track === undefined ? { hand: n.hand } : { hand: n.hand, track: n.track, sound: sounds.get(n.track) };
        engine.play(n.pitch, Math.max(n.duration, 0.05), n.velocity ?? 0.7, ch, n.time);
      }
      damps.forEach((t) => engine.damp(t));
      for (const h of [...(song.drums?.hits ?? [])].sort((a, b) => a.time - b.time)) {
        engine.drum(h.pad, h.velocity ?? 0.7, h.time, song.drums?.kit);
      }
    },
    seconds,
    2,
    sampleRate,
  );
  return { sampleRate, left: buffer.getChannelData(0), right: buffer.getChannelData(1) };
}

/**
 * Render whatever `build` asks of a fresh engine: live notes, drum hits, mix changes — each given its
 * own `when`, since an offline render's "now" is always zero.
 */
export async function renderEngine(
  seconds: number,
  build: (engine: Engine) => void | Promise<void>,
  opts: { sound?: SoundId; sustain?: boolean; sampleRate?: number } = {},
): Promise<Rendered> {
  const sampleRate = opts.sampleRate ?? 44100;
  const buffer = await Tone.Offline(
    async () => {
      const engine = new Engine({ sound: opts.sound ?? "clear", sustain: opts.sustain });
      if ((await engine.ready()) === "failed") throw new Error("The grand piano samples could not be loaded");
      await build(engine);
    },
    seconds,
    2,
    sampleRate,
  );
  return { sampleRate, left: buffer.getChannelData(0), right: buffer.getChannelData(1) };
}

export interface PlayedOptions {
  sound?: SoundId;
  /** Length of the render, in seconds of listening. Defaults to the song plus two seconds. */
  seconds?: number;
  sustain?: boolean;
  rate?: number;
  /** Song position to start from. */
  from?: number;
  loop?: [number, number];
  metronome?: boolean;
  countInBars?: number;
  /** Things to do to the player part-way through, at times in seconds of listening. */
  steps?: { at: number; do: (player: Player) => void }[];
  sampleRate?: number;
}

/**
 * Run the real player, offline. Its scheduler ticks on a clock stepped 25 ms at a time, exactly as
 * it does live, against an engine that renders to samples; every call it makes is recorded too.
 *
 * Steps may do anything that takes effect through what is scheduled next — `setSong`, the loop, the
 * metronome. Anything that acts on the engine "now" (pause, seek, mute) happens at time zero of an
 * offline render, so do those before the start, in a step at 0.
 */
export async function renderPlayed(song: Song, opts: PlayedOptions = {}): Promise<Rendered & { calls: SinkCall[] }> {
  const seconds = opts.seconds ?? (song.duration ?? 0) + 2;
  const sampleRate = opts.sampleRate ?? 44100;
  const steps = [...(opts.steps ?? [])].sort((a, b) => a.at - b.at);
  let calls: SinkCall[] = [];
  const buffer = await Tone.Offline(
    async () => {
      const engine = new Engine({ sound: opts.sound ?? "clear", sustain: opts.sustain });
      if ((await engine.ready()) === "failed") throw new Error("The grand piano samples could not be loaded");
      engine.start = () => Promise.resolve(); // an offline context is not started by a gesture
      let now = 0;
      let beat: (() => void) | null = null;
      const clock: Clock = {
        now: () => now,
        every(_ms, fn) {
          beat = fn;
          return () => void (beat = null);
        },
      };
      const player = new Player(song, { sound: opts.sound ?? "clear", sustain: opts.sustain }, { engine, clock });
      calls = recordSink(player, { now: () => now }).calls;
      if (opts.rate) player.setRate(opts.rate);
      if (opts.metronome) player.setMetronome(true);
      if (opts.loop) player.setLoop({ enabled: true, start: opts.loop[0], end: opts.loop[1] });
      // Moving the playhead before the start must not be heard as a "release everything" at time 0.
      const quiet = player.sink;
      player.sink = { ...quiet, play: quiet.play, click: quiet.click, drum: quiet.drum, releaseAll() {}, damp() {} };
      player.seek(opts.from ?? opts.loop?.[0] ?? 0);
      while (steps.length && steps[0].at <= 0) steps.shift()!.do(player);
      player.sink = quiet;
      await player.play({ countInBars: opts.countInBars });
      for (let t = 0.025; t <= seconds; t += 0.025) {
        now = t;
        while (steps.length && steps[0].at <= t) steps.shift()!.do(player);
        (beat as (() => void) | null)?.();
      }
    },
    seconds,
    2,
    sampleRate,
  );
  return { sampleRate, left: buffer.getChannelData(0), right: buffer.getChannelData(1), calls };
}

/** The first time at or after `from` where two renders differ by more than `tolerance`, or null if they never do. */
export function firstDifference(a: Rendered, b: Rendered, from = 0, tolerance = 1e-4): number | null {
  const n = Math.min(a.left.length, b.left.length);
  for (let i = Math.max(0, Math.floor(from * a.sampleRate)); i < n; i++) {
    if (Math.abs(a.left[i] - b.left[i]) > tolerance || Math.abs(a.right[i] - b.right[i]) > tolerance)
      return i / a.sampleRate;
  }
  return null;
}

// ---- how soon it sounds ------------------------------------------------------

const TAP_PROCESSOR = `
registerProcessor("first-sound", class extends AudioWorkletProcessor {
  constructor() {
    super();
    this.armed = false;
    this.quiet = true;
    this.wasQuiet = true;
    this.heardAt = 0;
    // A message is handled between two render quanta: currentTime is then the start of the next
    // quantum to be rendered, the earliest one that anything asked for just now could sound in.
    this.port.onmessage = () => { this.armed = true; this.wasQuiet = this.quiet; this.heardAt = currentTime; };
  }
  process(inputs) {
    const input = inputs[0] || [];
    let first = -1;
    for (const channel of input) {
      for (let i = 0; i < channel.length; i++) {
        if (Math.abs(channel[i]) > 1e-5) { if (first < 0 || i < first) first = i; break; }
      }
    }
    this.quiet = first < 0;
    if (this.armed && first >= 0) {
      this.armed = false;
      this.port.postMessage({ time: currentTime + first / sampleRate, block: currentTime, heardAt: this.heardAt, wasQuiet: this.wasQuiet });
    }
    return true;
  }
});`;

export interface FirstSound {
  /** The page's audio clock (`currentTime`) when the call was made. It runs behind the audio thread. */
  calledAt: number;
  /** The start of the first render quantum the audio thread began after hearing of the call. */
  heardAt: number;
  /** The start of the render quantum the sound began in, and the moment within it. */
  blockAt: number;
  soundAt: number;
  /** One render quantum, in seconds: 128 samples. */
  quantum: number;
  /** Whether the output was silent when listening began. If not, the measurement means nothing. */
  wasQuiet: boolean;
}

export interface Listener {
  /** Run `make`, which should make a sound through the engine, and report when the sound began. */
  measure(make: () => void): Promise<FirstSound>;
  /** The same measurement of a bare Web Audio oscillator started "now": the browser's own floor. */
  measureNative(): Promise<FirstSound>;
}

/**
 * Listen at the engine's output, on the audio thread, for the first sample that is not silence —
 * and note, on the audio thread, the moment it heard that a sound was about to be asked for.
 */
export async function listenForFirstSound(engine: Engine = sharedEngine()): Promise<Listener> {
  const context = Tone.getContext();
  const url = URL.createObjectURL(new Blob([TAP_PROCESSOR], { type: "application/javascript" }));
  await context.addAudioWorkletModule(url);
  URL.revokeObjectURL(url);
  const node = context.createAudioWorkletNode("first-sound", { numberOfInputs: 1, numberOfOutputs: 0 });
  engine.tap(node);
  const measure = (make: () => void) =>
    new Promise<FirstSound>((resolve) => {
      node.port.onmessage = (e: MessageEvent<{ time: number; block: number; heardAt: number; wasQuiet: boolean }>) =>
        resolve({
          calledAt,
          heardAt: e.data.heardAt,
          blockAt: e.data.block,
          soundAt: e.data.time,
          quantum: 128 / context.sampleRate,
          wasQuiet: e.data.wasQuiet,
        });
      // The mark and the sound are sent to the audio thread together, mark first.
      node.port.postMessage("mark");
      const calledAt = context.currentTime;
      make();
    });
  return {
    measure,
    measureNative: () =>
      measure(() => {
        const osc = context.createOscillator();
        const gain = context.createGain();
        gain.gain.value = 0.05;
        osc.frequency.value = 880;
        osc.connect(gain);
        Tone.connect(gain, node);
        osc.start();
        osc.stop(context.currentTime + 0.05);
      }),
  };
}

const SILENCE_DB = -200;
const toDb = (x: number) => (x > 0 ? Math.max(SILENCE_DB, 20 * Math.log10(x)) : SILENCE_DB);

function span(r: Rendered, t0 = 0, t1 = Infinity): [number, number] {
  const a = Math.max(0, Math.floor(t0 * r.sampleRate));
  const b = Math.min(r.left.length, Math.ceil(t1 * r.sampleRate));
  return [a, Math.max(a, b)];
}

/** RMS level between two times, both channels together, in dBFS. Silence is −200. */
export function levelDb(r: Rendered, t0?: number, t1?: number): number {
  const [a, b] = span(r, t0, t1);
  if (b === a) return SILENCE_DB;
  let sum = 0;
  for (let i = a; i < b; i++) sum += r.left[i] * r.left[i] + r.right[i] * r.right[i];
  return toDb(Math.sqrt(sum / (2 * (b - a))));
}

/** Largest absolute sample between two times, in dBFS. 0 means full scale: at or above it is clipping. */
export function peakDb(r: Rendered, t0?: number, t1?: number): number {
  const [a, b] = span(r, t0, t1);
  let peak = 0;
  for (let i = a; i < b; i++) peak = Math.max(peak, Math.abs(r.left[i]), Math.abs(r.right[i]));
  return toDb(peak);
}

/** Largest jump between neighbouring samples, in full-scale units. A click shows up as a big one. */
export function maxJump(r: Rendered, t0?: number, t1?: number): number {
  const [a, b] = span(r, t0, t1);
  let jump = 0;
  for (let i = a + 1; i < b; i++) {
    jump = Math.max(jump, Math.abs(r.left[i] - r.left[i - 1]), Math.abs(r.right[i] - r.right[i - 1]));
  }
  return jump;
}
