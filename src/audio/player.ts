import * as Tone from "tone";
import type { Hand, Note, Song, SoundId } from "../song/types";
import { defaultMix, sanitizeMix, type Mix } from "./mix";
import { clamp, MIN_LOOP, playRange, type LoopRange, type TimeRange } from "./range";
import type { HandMix, Sink } from "./types";
import { Voices, type PianoStatus } from "./voices";

export { clamp, playRange };
export type { HandMix, LoopRange, Mix, SoundId, TimeRange };

const LOOKAHEAD = 0.15; // seconds of real time scheduled ahead
const TICK_MS = 25;
const SKIP_LISTEN_SECONDS = 5;

export const SOUNDS: { id: SoundId; label: string }[] = [
  { id: "clear", label: "Clear" },
  { id: "soft", label: "Soft" },
  { id: "epiano", label: "Electric piano" },
  { id: "bright", label: "Bright" },
  { id: "piano", label: "Grand piano" },
];

export interface PlayerState {
  playing: boolean;
  /** Paused on a moment by stepping (or tapping the rhythm map); play resumes from it. */
  stepping: boolean;
  rate: number;
  loop: LoopRange;
  /** The visible part of the timeline while zoomed in; it loops too. */
  window: TimeRange | null;
  /** Each hand's volume and mute. */
  mix: Mix;
  sound: SoundId;
  /** Status of the sampled grand piano, which needs a download. */
  piano: PianoStatus;
  stereo: boolean;
  /** The sustain pedal is held down: notes ring on after their keys are released. */
  sustain: boolean;
  metronome: boolean;
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

  private voices: Voices;
  /**
   * What the player asks to sound every note and click. Normally the voices; tests put a recorder in
   * its place to see exactly what was scheduled and when (docs/plan/contracts.md §6).
   */
  sink: Sink;

  constructor(song: Song, prefs: Partial<Pick<PlayerState, "sound" | "stereo" | "sustain">> = {}) {
    this.song = song;
    this._state = {
      playing: false,
      stepping: false,
      rate: 1,
      loop: { enabled: false, start: 0, end: this.duration },
      window: null,
      mix: defaultMix(),
      sound: prefs.sound ?? "clear",
      piano: "idle",
      stereo: prefs.stereo ?? false,
      sustain: prefs.sustain ?? false,
      metronome: false,
    };
    this.voices = new Voices({
      sound: this._state.sound,
      stereo: this._state.stereo,
      mix: this._state.mix,
      sustain: this._state.sustain,
      onPiano: (piano) => this.update({ piano }),
    });
    this.sink = this.voices;
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

  /** What plays on repeat right now; see `playRange`. */
  range(): TimeRange {
    return playRange(this._state.loop, this._state.window, this.duration);
  }

  /** Whether playback wraps at the end of `range()` rather than stopping. */
  private get repeating(): boolean {
    return this._state.loop.enabled || this._state.window !== null;
  }

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
    const r = this.range();
    let t = this.anchorSong;
    if (this.repeating && (t < r.start || t >= r.end)) t = r.start;
    if (!this.repeating && t >= this.duration) t = 0;
    this.anchorSong = t;
    this.anchorCtx = this.now();
    this.scheduledUpTo = t;
    this.update({ playing: true, stepping: false });
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
    const { rate } = this._state;
    const r = this.range();
    let t = this.currentTime() + direction * SKIP_LISTEN_SECONDS * rate;
    if (this.repeating) t = clamp(t, r.start, r.end - 0.05);
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
    if (loop.enabled) this.keepInRange();
  }

  /** Set (or clear) the visible window. A playhead left outside it jumps to its start. */
  setWindow(visible: TimeRange | null) {
    const w = this._state.window;
    if (w === visible || (w && visible && w.start === visible.start && w.end === visible.end)) return;
    this.update({ window: visible });
    if (visible) this.keepInRange();
  }

  /** Back to the start of whatever plays on repeat (or of the song). */
  restart() {
    this.seek(this.range().start);
  }

  private keepInRange() {
    const t = this.currentTime();
    const r = this.range();
    if (t < r.start || t >= r.end) this.seek(r.start);
  }

  /** Set a hand's volume, 0 to 1 on the slider. Moving the slider un-mutes the hand. */
  setVolume(hand: Hand, volume: number) {
    this.setHand(hand, { volume: clamp(volume, 0, 1), muted: false });
  }

  /** Mute or un-mute a hand. Its volume is remembered. */
  setMuted(hand: Hand, muted: boolean) {
    this.setHand(hand, { ...this._state.mix[hand], muted });
  }

  toggleMute(hand: Hand) {
    this.setMuted(hand, !this._state.mix[hand].muted);
  }

  setMix(mix: Mix) {
    const clean = sanitizeMix(mix);
    if (!clean) return;
    this.update({ mix: clean });
    this.voices.setHandMix("L", clean.L);
    this.voices.setHandMix("R", clean.R);
  }

  private setHand(hand: Hand, m: HandMix) {
    const now = this._state.mix[hand];
    if (now.volume === m.volume && now.muted === m.muted) return;
    this.update({ mix: { ...this._state.mix, [hand]: m } });
    this.voices.setHandMix(hand, m);
  }

  setSound(sound: SoundId) {
    this.releaseAll();
    this.update({ sound });
    this.voices.setSound(sound);
  }

  setStereo(stereo: boolean) {
    this.update({ stereo });
    this.voices.setStereo(stereo);
  }

  /** Press or lift the sustain pedal. Lifting it silences what was ringing. */
  setSustain(sustain: boolean) {
    this.update({ sustain });
    this.voices.setSustain(sustain);
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
    if (!this._state.stepping) this.update({ stepping: true });
    const now = this.now() + 0.01;
    for (let i = lowerBound(this.song.notes, t - 0.03); i < this.song.notes.length; i++) {
      const n = this.song.notes[i];
      if (n.time > t + 0.03) break;
      this.trigger(n, Math.min(n.duration, 1.5) / Math.max(this._state.rate, 0.5), now);
    }
  }

  dispose() {
    this.stopTimer();
    this.voices.dispose();
    this.listeners.clear();
    this.wrapListeners.clear();
  }

  // ---- internals -----------------------------------------------------------

  private trigger(n: Note, dur: number, when: number) {
    // A muted hand is still scheduled; only its gain is zero. Un-muting mid-note brings it straight back.
    this.sink.play(n.pitch, Math.max(dur, 0.05), n.velocity ?? 0.7, { hand: n.hand }, when);
  }

  private releaseAll() {
    this.sink.releaseAll();
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick() {
    const { rate } = this._state;
    const range = this.range();
    let t = this.currentTime();
    const end = range.end;

    if (t >= end) {
      if (!this.repeating) {
        this.anchorSong = this.duration;
        this.stopTimer();
        this.update({ playing: false });
        return;
      }
      // Wrap seamlessly: re-anchor at the exact moment the loop end was reached.
      this.anchorCtx += (end - this.anchorSong) / rate;
      this.anchorSong = range.start;
      this.scheduledUpTo = range.start;
      t = this.currentTime();
      // Without the pedal, notes are cut to end with the loop. With it they ring past the end, so the
      // dampers come down for a moment or the end of the loop would sound over its start.
      this.sink.damp?.();
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
      for (let b = Math.ceil(this.scheduledUpTo / beat - 1e-6); b * beat < windowEnd; b++) {
        this.sink.click(b % perBar === 0, toCtx(b * beat));
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
