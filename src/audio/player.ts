import * as Tone from "tone";
import type { Hand, Note, Song } from "../song/types";

const LOOKAHEAD = 0.15; // seconds of real time scheduled ahead
const TICK_MS = 25;
const MIN_LOOP = 0.25;
const SKIP_LISTEN_SECONDS = 5;
const SOFT_GAIN = 0.22;

const SAMPLE_NOTES = ["A0", "C1", "D#1", "F#1", "A1", "C2", "D#2", "F#2", "A2", "C3", "D#3", "F#3",
  "A3", "C4", "D#4", "F#4", "A4", "C5", "D#5", "F#5", "A5", "C6", "D#6", "F#6", "A6", "C7", "D#7",
  "F#7", "A7", "C8"];

export type SoundId = "clear" | "soft" | "epiano" | "bright" | "piano";
export type HandLevel = "on" | "soft" | "off";

export const SOUNDS: { id: SoundId; label: string }[] = [
  { id: "clear", label: "Clear" },
  { id: "soft", label: "Soft" },
  { id: "epiano", label: "Electric piano" },
  { id: "bright", label: "Bright" },
  { id: "piano", label: "Grand piano" },
];

export interface LoopRange {
  enabled: boolean;
  start: number;
  end: number;
}

export interface PlayerState {
  playing: boolean;
  rate: number;
  loop: LoopRange;
  levels: Record<Hand, HandLevel>;
  sound: SoundId;
  /** Status of the sampled grand piano, which needs a download. */
  piano: "idle" | "loading" | "ready" | "failed";
  stereo: boolean;
  metronome: boolean;
}

interface Instrument {
  triggerAttackRelease(note: string, duration: number, time: number, velocity: number): unknown;
  releaseAll(): unknown;
  dispose(): unknown;
}

type Listener = () => void;

/**
 * Plays a Song with a Web Audio lookahead scheduler. Song time advances at
 * `rate` × real time, so slowing down changes tempo but never pitch.
 */
export class Player {
  private song: Song;
  private anchorSong = 0; // song time at anchorCtx
  private anchorCtx = 0; // audio-context time when anchorSong was true
  private scheduledUpTo = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<Listener>();
  private wrapListeners = new Set<Listener>();
  private _state: PlayerState;

  private channels: Record<Hand, { gain: Tone.Gain; pan: Tone.Panner }>;
  private instruments: Partial<Record<`${Hand}:${SoundId}`, Instrument>> = {};
  private pianoBuffers: Tone.ToneAudioBuffers | null = null;
  private click: Tone.Synth | null = null;

  constructor(song: Song, prefs: Partial<Pick<PlayerState, "sound" | "stereo">> = {}) {
    this.song = song;
    this._state = {
      playing: false,
      rate: 1,
      loop: { enabled: false, start: 0, end: this.duration },
      levels: { L: "on", R: "on" },
      sound: prefs.sound ?? "clear",
      piano: "idle",
      stereo: prefs.stereo ?? false,
      metronome: false,
    };
    const mk = (pan: number) => {
      const p = new Tone.Panner(pan).toDestination();
      return { gain: new Tone.Gain(1).connect(p), pan: p };
    };
    this.channels = { L: mk(0), R: mk(0) };
    this.applyMix();
    if (this._state.sound === "piano") this.loadPiano();
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

  /** Called each time playback wraps from the loop end back to its start. */
  onLoopWrap = (fn: Listener): (() => void) => {
    this.wrapListeners.add(fn);
    return () => this.wrapListeners.delete(fn);
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

  /** Jump by 5 seconds of listening time, so slower speeds take smaller steps. */
  skip(direction: 1 | -1) {
    const { loop, rate } = this._state;
    let t = this.currentTime() + direction * SKIP_LISTEN_SECONDS * rate;
    if (loop.enabled) t = clamp(t, loop.start, loop.end - 0.05);
    this.seek(t);
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

  setLevel(hand: Hand, level: HandLevel) {
    this.update({ levels: { ...this._state.levels, [hand]: level } });
    this.applyMix();
  }

  setLevels(levels: Record<Hand, HandLevel>) {
    this.update({ levels });
    this.applyMix();
  }

  setSound(sound: SoundId) {
    this.releaseAll();
    this.update({ sound });
    if (sound === "piano") this.loadPiano();
  }

  setStereo(stereo: boolean) {
    this.update({ stereo });
    this.applyMix();
  }

  setMetronome(metronome: boolean) {
    this.update({ metronome });
  }

  /** Pause, move to `t`, and sound every note that starts at that moment. */
  async strikeAt(t: number) {
    await Tone.start();
    if (this._state.playing) this.pause();
    this.seek(t);
    this.releaseAll();
    const now = this.now() + 0.01;
    for (let i = lowerBound(this.song.notes, t - 0.03); i < this.song.notes.length; i++) {
      const n = this.song.notes[i];
      if (n.time > t + 0.03) break;
      this.trigger(n, Math.min(n.duration, 1.5) / Math.max(this._state.rate, 0.5), now);
    }
  }

  dispose() {
    this.stopTimer();
    Object.values(this.instruments).forEach((i) => i?.dispose());
    this.pianoBuffers?.dispose();
    this.click?.dispose();
    for (const c of Object.values(this.channels)) {
      c.gain.dispose();
      c.pan.dispose();
    }
    this.listeners.clear();
    this.wrapListeners.clear();
  }

  // ---- internals -----------------------------------------------------------

  private applyMix() {
    const { levels, stereo } = this._state;
    for (const h of ["L", "R"] as Hand[]) {
      this.channels[h].gain.gain.rampTo(levels[h] === "soft" ? SOFT_GAIN : 1, 0.05);
      this.channels[h].pan.pan.rampTo(stereo ? (h === "L" ? -0.7 : 0.7) : 0, 0.05);
    }
  }

  private loadPiano() {
    if (this._state.piano === "ready" || this._state.piano === "loading") return;
    this.update({ piano: "loading" });
    this.pianoBuffers = new Tone.ToneAudioBuffers({
      urls: Object.fromEntries(SAMPLE_NOTES.map((n) => [n, `${n.replace("#", "s")}.mp3`])),
      baseUrl: "https://tonejs.github.io/audio/salamander/",
      onload: () => this.update({ piano: "ready" }),
      onerror: () => this.update({ piano: "failed" }),
    });
  }

  private instrument(hand: Hand): Instrument {
    let sound = this._state.sound;
    if (sound === "piano" && this._state.piano !== "ready") sound = "clear";
    const key = `${hand}:${sound}` as const;
    let inst = this.instruments[key];
    if (!inst) {
      inst = this.createInstrument(sound);
      (inst as unknown as Tone.ToneAudioNode).connect(this.channels[hand].gain);
      this.instruments[key] = inst;
    }
    return inst;
  }

  private createInstrument(sound: SoundId): Instrument {
    switch (sound) {
      case "soft":
        return new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: "sine" },
          envelope: { attack: 0.01, decay: 0.6, sustain: 0.3, release: 0.9 },
          volume: -9,
        });
      case "epiano":
        return new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 3,
          modulationIndex: 9,
          oscillator: { type: "sine" },
          modulation: { type: "sine" },
          envelope: { attack: 0.002, decay: 1.4, sustain: 0.15, release: 1 },
          modulationEnvelope: { attack: 0.002, decay: 0.25, sustain: 0, release: 0.2 },
          volume: -14,
        });
      case "bright":
        return new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: "square6" },
          envelope: { attack: 0.003, decay: 0.25, sustain: 0.2, release: 0.4 },
          volume: -19,
        });
      case "piano": {
        const urls: Record<string, Tone.ToneAudioBuffer> = {};
        for (const n of SAMPLE_NOTES) urls[n] = this.pianoBuffers!.get(n);
        return new Tone.Sampler({ urls, release: 1 });
      }
      case "clear":
      default:
        return new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: "triangle" },
          envelope: { attack: 0.005, decay: 0.3, sustain: 0.25, release: 0.6 },
          volume: -12,
        });
    }
  }

  private trigger(n: Note, dur: number, when: number) {
    if (this._state.levels[n.hand] === "off") return;
    this.instrument(n.hand).triggerAttackRelease(
      Tone.Frequency(n.pitch, "midi").toNote(),
      Math.max(dur, 0.05),
      when,
      n.velocity ?? 0.7,
    );
  }

  private releaseAll() {
    Object.values(this.instruments).forEach((i) => i?.releaseAll());
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick() {
    const { loop, rate } = this._state;
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
      this.wrapListeners.forEach((fn) => fn());
      if (this._state.rate !== rate) return; // a listener changed the speed; next tick reschedules
    }

    const windowEnd = Math.min(t + LOOKAHEAD * rate, end);
    if (windowEnd <= this.scheduledUpTo) return;
    const now = this.now();
    const toCtx = (songTime: number) => Math.max(this.anchorCtx + (songTime - this.anchorSong) / rate, now);

    const notes = this.song.notes;
    for (let i = lowerBound(notes, this.scheduledUpTo); i < notes.length; i++) {
      const n = notes[i];
      if (n.time >= windowEnd) break;
      this.trigger(n, Math.min(n.duration, end - n.time) / rate, toCtx(n.time));
    }

    if (this._state.metronome && this.song.bpm) {
      const beat = 60 / this.song.bpm;
      const perBar = this.song.timeSignature?.[0] ?? 4;
      this.click ??= new Tone.Synth({
        oscillator: { type: "sine" },
        envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
        volume: -8,
      }).toDestination();
      for (let b = Math.ceil(this.scheduledUpTo / beat - 1e-6); b * beat < windowEnd; b++) {
        this.click.triggerAttackRelease(b % perBar === 0 ? 1760 : 1175, 0.03, toCtx(b * beat), b % perBar === 0 ? 1 : 0.6);
      }
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
