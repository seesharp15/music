/**
 * The audio test harness (docs/plan/00-foundations.md). Two tools:
 *
 * - `recordSink` answers "what did the player schedule, and when?" by standing in for its sink.
 * - `renderOffline` answers "what does it sound like?" by rendering a song to samples, which the
 *   measuring helpers below turn into numbers a test can assert on.
 *
 * Loaded on demand through `window.__app.testing()`; never part of the app's own bundles.
 */
import * as Tone from "tone";
import type { Hand, Song, SoundId } from "../song/types";
import type { Player } from "./player";
import type { Mix } from "./mix";
import type { Channel, HandMix, Sink } from "./types";
import { Voices } from "./voices";

/** The audio clock, in seconds: the clock every `when` is measured on. */
export const audioNow = () => Tone.getContext().currentTime;

// ---- what was scheduled ------------------------------------------------------

export interface SinkCall {
  kind: "note" | "click" | "release";
  /** Audio-context time the sound was asked for. */
  when: number;
  /** Audio-context time the call was made. */
  at: number;
  pitch?: number;
  duration?: number;
  velocity?: number;
  hand?: Hand;
  accent?: boolean;
}

export interface Recording {
  calls: SinkCall[];
  /** Puts the player's own sink back. */
  stop(): void;
}

/** Record every call the player makes to its sink. With `silent`, nothing is passed on to be heard. */
export function recordSink(player: Player, opts: { silent?: boolean } = {}): Recording {
  const inner = player.sink;
  const calls: SinkCall[] = [];
  const now = () => Tone.getContext().currentTime;
  const recorder: Sink = {
    play(pitch: number, duration: number, velocity: number, ch: Channel, when: number) {
      calls.push({ kind: "note", when, at: now(), pitch, duration, velocity, hand: ch.hand });
      if (!opts.silent) inner.play(pitch, duration, velocity, ch, when);
    },
    click(accent: boolean, when: number) {
      calls.push({ kind: "click", when, at: now(), accent });
      if (!opts.silent) inner.click(accent, when);
    },
    releaseAll() {
      calls.push({ kind: "release", when: now(), at: now() });
      inner.releaseAll();
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
  /** Volume and mute changes part-way through, at times in seconds. */
  changes?: { time: number; hand: Hand; mix: HandMix }[];
  sampleRate?: number;
}

export interface Rendered {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
}

/**
 * Render a song to samples, faster than real time and with no sound card involved. Every note goes
 * straight to the voices at its written time: the player's real-time loop cannot run offline, and
 * `recordSink` is what tests that loop.
 */
export async function renderOffline(song: Song, opts: RenderOptions = {}): Promise<Rendered> {
  const seconds = opts.seconds ?? (song.duration ?? 0) + 2;
  const sampleRate = opts.sampleRate ?? 44100;
  const buffer = await Tone.Offline(
    async () => {
      const voices = new Voices({
        sound: opts.sound ?? "clear",
        stereo: opts.stereo ?? false,
        mix: opts.mix,
      });
      if ((await voices.ready()) === "failed") throw new Error("The grand piano samples could not be loaded");
      for (const c of opts.changes ?? []) voices.setHandMix(c.hand, c.mix, c.time);
      for (const n of song.notes) {
        voices.play(n.pitch, Math.max(n.duration, 0.05), n.velocity ?? 0.7, { hand: n.hand }, n.time);
      }
    },
    seconds,
    2,
    sampleRate,
  );
  return { sampleRate, left: buffer.getChannelData(0), right: buffer.getChannelData(1) };
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
