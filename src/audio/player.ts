import * as Tone from "tone";
import type { Hand, Note, Song } from "../song/types";

const LOOKAHEAD = 0.15; // seconds of real time scheduled ahead
const TICK_MS = 25;
const MIN_LOOP = 0.25;

const SAMPLE_NOTES = ["A0", "C1", "D#1", "F#1", "A1", "C2", "D#2", "F#2", "A2", "C3", "D#3", "F#3",
  "A3", "C4", "D#4", "F#4", "A4", "C5", "D#5", "F#5", "A5", "C6", "D#6", "F#6", "A6", "C7", "D#7",
  "F#7", "A7", "C8"];

export interface LoopRange {
  enabled: boolean;
  start: number;
  end: number;
}

export interface PlayerState {
  playing: boolean;
  rate: number;
  loop: LoopRange;
  muted: Record<Hand, boolean>;
  /** "loading" plays a basic synth until the piano samples arrive. */
  instrument: "loading" | "piano" | "synth";
}

type Listener = () => void;

/**
 * Plays a Song with a Web Audio lookahead scheduler. Song time advances at
 * `rate` × real time, so slowing down changes tempo but never pitch.
 */
export class Player {
  private song: Song;
  private sampler: Tone.Sampler;
  private synth: Tone.PolySynth;
  private anchorSong = 0; // song time at anchorCtx
  private anchorCtx = 0; // audio-context time when anchorSong was true
  private scheduledUpTo = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<Listener>();
  private _state: PlayerState;

  constructor(song: Song) {
    this.song = song;
    this._state = {
      playing: false,
      rate: 1,
      loop: { enabled: false, start: 0, end: this.duration },
      muted: { L: false, R: false },
      instrument: "loading",
    };
    this.synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.005, decay: 0.3, sustain: 0.25, release: 0.6 },
      volume: -12,
    }).toDestination();
    this.sampler = new Tone.Sampler({
      urls: Object.fromEntries(SAMPLE_NOTES.map((n) => [n, `${n.replace("#", "s")}.mp3`])),
      baseUrl: "https://tonejs.github.io/audio/salamander/",
      release: 1,
      onload: () => this.update({ instrument: "piano" }),
      onerror: () => this.update({ instrument: "synth" }),
    }).toDestination();
  }

  get state(): PlayerState {
    return this._state;
  }

  get duration(): number {
    return this.song.duration ?? 0;
  }

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = (): PlayerState => this._state;

  private update(patch: Partial<PlayerState>) {
    this._state = { ...this._state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  private now(): number {
    return Tone.getContext().currentTime;
  }

  /** Current position in song seconds. */
  currentTime(): number {
    if (!this._state.playing) return this.anchorSong;
    return this.anchorSong + (this.now() - this.anchorCtx) * this._state.rate;
  }

  async play() {
    if (this._state.playing) return;
    await Tone.start();
    const { loop } = this._state;
    let t = this.anchorSong;
    if (loop.enabled && (t < loop.start || t >= loop.end)) t = loop.start;
    if (!loop.enabled && t >= this.duration) t = 0;
    this.anchorSong = t;
    this.anchorCtx = this.now();
    this.scheduledUpTo = t;
    this.update({ playing: true });
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  pause() {
    if (!this._state.playing) return;
    this.anchorSong = this.currentTime();
    this.stopTimer();
    this.releaseAll();
    this.update({ playing: false });
  }

  toggle() {
    if (this._state.playing) this.pause();
    else void this.play();
  }

  seek(t: number) {
    t = clamp(t, 0, this.duration);
    this.anchorSong = t;
    this.anchorCtx = this.now();
    this.scheduledUpTo = t;
    if (this._state.playing) this.releaseAll();
    this.listeners.forEach((fn) => fn());
  }

  setRate(rate: number) {
    this.anchorSong = this.currentTime();
    this.anchorCtx = this.now();
    this.update({ rate });
  }

  setLoop(patch: Partial<LoopRange>) {
    const loop = { ...this._state.loop, ...patch };
    loop.start = clamp(loop.start, 0, this.duration - MIN_LOOP);
    loop.end = clamp(loop.end, loop.start + MIN_LOOP, this.duration);
    this.update({ loop });
    if (loop.enabled) {
      const t = this.currentTime();
      if (t < loop.start || t >= loop.end) this.seek(loop.start);
    }
  }

  setMuted(hand: Hand, muted: boolean) {
    this.update({ muted: { ...this._state.muted, [hand]: muted } });
  }

  dispose() {
    this.stopTimer();
    this.sampler.dispose();
    this.synth.dispose();
    this.listeners.clear();
  }

  private releaseAll() {
    if (this.sampler.loaded) this.sampler.releaseAll();
    this.synth.releaseAll();
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick() {
    const { loop, rate, muted } = this._state;
    let t = this.currentTime();
    const end = loop.enabled ? loop.end : this.duration;

    if (t >= end) {
      if (!loop.enabled) {
        this.anchorSong = this.duration;
        this.stopTimer();
        this.update({ playing: false });
        return;
      }
      // Wrap seamlessly: re-anchor at the exact moment the loop end was reached.
      this.anchorCtx += (loop.end - this.anchorSong) / rate;
      this.anchorSong = loop.start;
      this.scheduledUpTo = loop.start;
      t = this.currentTime();
    }

    const windowEnd = Math.min(t + LOOKAHEAD * rate, end);
    if (windowEnd <= this.scheduledUpTo) return;
    const notes = this.song.notes;
    const now = this.now();
    const inst = this._state.instrument === "piano" ? this.sampler : this.synth;
    for (let i = lowerBound(notes, this.scheduledUpTo); i < notes.length; i++) {
      const n = notes[i];
      if (n.time >= windowEnd) break;
      if (muted[n.hand]) continue;
      const when = this.anchorCtx + (n.time - this.anchorSong) / rate;
      const dur = Math.min(n.duration, end - n.time) / rate;
      inst.triggerAttackRelease(
        Tone.Frequency(n.pitch, "midi").toNote(),
        Math.max(dur, 0.05),
        Math.max(when, now),
        n.velocity ?? 0.7,
      );
    }
    this.scheduledUpTo = windowEnd;
  }
}

/** Index of the first note with time >= t. */
function lowerBound(notes: Note[], t: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].time < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}
