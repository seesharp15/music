import type { DrumPadId, Hand, Note, Song, SoundId } from "../song/types";
import { sharedEngine, type Engine, type PianoStatus } from "./engine";
import { defaultMix, FULL, sanitizeMix, type Mix } from "./mix";
import { clamp, MIN_LOOP, playRange, type LoopRange, type TimeRange } from "./range";
import type { Channel, HandMix, Sink } from "./types";

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
  /** Each track's volume and mute, by track id. Empty for a song with no tracks. */
  trackMix: Record<string, HandMix>;
  drumMix: HandMix;
  /** The one track being heard alone, or null. */
  solo: string | null;
  /** Clicking before the music starts; see `play({ countInBars })`. */
  countIn: boolean;
}

type Listener = () => void;

/** The audio clock and the scheduler's heartbeat. Real in the app; tests drive their own. */
export interface Clock {
  /** Audio-context seconds. */
  now(): number;
  /** Call `fn` every `ms` milliseconds; returns how to stop. */
  every(ms: number, fn: () => void): () => void;
}

export interface PlayerOptions {
  /** The engine to play through. The page's shared one unless a test supplies its own. */
  engine?: Engine;
  clock?: Clock;
}

type DrumHit = { pad: DrumPadId; time: number; velocity?: number };

/**
 * Plays a Song with a Web Audio lookahead scheduler. Song time advances at
 * `rate` × real time, so slowing down changes tempo but never pitch.
 */
export class Player {
  private song: Song;
  private anchorSong = 0; // song time at anchorCtx
  private anchorCtx = 0; // audio-context time when anchorSong was true
  private scheduledUpTo = 0;
  private timer: (() => void) | null = null;
  private listeners = new Set<Listener>();
  private wrapListeners = new Set<Listener>();
  private _state: PlayerState;

  private engine: Engine;
  private clock: Clock;
  private stopListeningToPiano: () => void;
  /** The song's drum hits in time order, and the sound each of its tracks plays. */
  private hits: DrumHit[] = [];
  private trackSound = new Map<string, SoundId | undefined>();
  /** A count-in under way: clicks from `start`, `beat` seconds apart, `next` of `total` still to ask for. */
  private counting: { start: number; beat: number; perBar: number; total: number; next: number } | null = null;
  /**
   * What the player asks to sound every note and click. Normally the engine; tests put a recorder in
   * its place to see exactly what was scheduled and when (docs/plan/contracts.md §6).
   */
  sink: Sink;

  constructor(
    song: Song,
    prefs: Partial<Pick<PlayerState, "sound" | "stereo" | "sustain">> = {},
    opts: PlayerOptions = {},
  ) {
    this.song = song;
    const engine = (this.engine = opts.engine ?? sharedEngine());
    this.clock = opts.clock ?? {
      now: () => engine.now(),
      every(ms, fn) {
        const id = setInterval(fn, ms);
        return () => clearInterval(id);
      },
    };
    const sound = prefs.sound ?? "clear";
    const mix = defaultMix();
    // The engine outlives any one song: put it the way this song's listener left things.
    engine.setSound(sound);
    engine.setStereoSplit(prefs.stereo ?? false);
    engine.setSustain(prefs.sustain ?? false);
    engine.setHandMix("L", mix.L);
    engine.setHandMix("R", mix.R);
    this._state = {
      playing: false,
      stepping: false,
      rate: 1,
      loop: { enabled: false, start: 0, end: this.duration },
      window: null,
      mix,
      sound,
      piano: engine.piano,
      stereo: prefs.stereo ?? false,
      sustain: prefs.sustain ?? false,
      metronome: false,
      trackMix: {},
      drumMix: { ...FULL },
      solo: null,
      countIn: false,
    };
    this.stopListeningToPiano = engine.onPiano((piano) => this.update({ piano }));
    this.sink = engine;
    this._state = { ...this._state, ...this.adopt(song) };
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
    return this.clock.now();
  }

  /** Current position in song seconds. */
  currentTime(): number {
    if (!this._state.playing) return this.anchorSong;
    // During a count-in the music has not started: the position waits where it will begin.
    if (this.counting && this.now() < this.anchorCtx) return this.anchorSong;
    return this.anchorSong + (this.now() - this.anchorCtx) * this._state.rate;
  }

  /**
   * Start playing. With `countInBars`, the metronome clicks that many bars first, at the tempo of the
   * place playback starts from and at the current speed; a song with no tempo has nothing to count,
   * and starts at once.
   */
  async play(opts: { countInBars?: number } = {}) {
    if (this._state.playing) return;
    await this.engine.start();
    const r = this.range();
    let t = this.anchorSong;
    if (this.repeating && (t < r.start || t >= r.end)) t = r.start;
    if (!this.repeating && t >= this.duration) t = 0;
    this.anchorSong = t;
    this.anchorCtx = this.now();
    this.scheduledUpTo = t;
    this.counting = null;
    const bars = Math.max(0, Math.floor(opts.countInBars ?? 0));
    if (bars > 0 && this.song.bpm) {
      const perBar = this.song.timeSignature?.[0] ?? 4;
      const beat = 60 / this.song.bpm / this._state.rate;
      this.counting = { start: this.anchorCtx, beat, perBar, total: bars * perBar, next: 0 };
      this.anchorCtx += bars * perBar * beat;
    }
    this.update({ playing: true, stepping: false, countIn: !!this.counting });
    this.timer = this.clock.every(TICK_MS, () => this.tick());
    this.tick();
  }

  pause() {
    if (!this._state.playing) return;
    this.anchorSong = this.currentTime();
    this.counting = null;
    this.stopTimer();
    this.releaseAll();
    this.update({ playing: false, countIn: false });
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
    if (this.counting) {
      // Moving the playhead mid count-in abandons the count.
      this.counting = null;
      this.update({ countIn: false });
      return;
    }
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
    // Mid count-in the start stays where it was promised; the new speed applies from there.
    if (!(this.counting && this.now() < this.anchorCtx)) {
      this.anchorSong = this.currentTime();
      this.anchorCtx = this.now();
    }
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
    this.engine.setHandMix("L", clean.L);
    this.engine.setHandMix("R", clean.R);
  }

  private setHand(hand: Hand, m: HandMix) {
    const now = this._state.mix[hand];
    if (now.volume === m.volume && now.muted === m.muted) return;
    this.update({ mix: { ...this._state.mix, [hand]: m } });
    this.engine.setHandMix(hand, m);
  }

  // ---- tracks and drums ------------------------------------------------------

  /** Change one track's volume or mute. Unknown track ids are ignored. */
  setTrackMix(trackId: string, patch: Partial<HandMix>) {
    const now = this._state.trackMix[trackId];
    if (!now) return;
    const next = clean({ ...now, ...patch });
    if (next.volume === now.volume && next.muted === now.muted) return;
    this.update({ trackMix: { ...this._state.trackMix, [trackId]: next } });
    this.applyMix();
  }

  setDrumMix(patch: Partial<HandMix>) {
    const now = this._state.drumMix;
    const next = clean({ ...now, ...patch });
    if (next.volume === now.volume && next.muted === now.muted) return;
    this.update({ drumMix: next });
    this.applyMix();
  }

  /** Hear one track alone — the others and the drums fall silent — or with null, everything again. */
  solo(trackId: string | null) {
    const solo = trackId !== null && trackId in this._state.trackMix ? trackId : null;
    if (solo === this._state.solo) return;
    this.update({ solo });
    this.applyMix();
  }

  /** Tell the engine how loud each track and the drums are, the solo taken into account. */
  private applyMix() {
    const { trackMix, drumMix, solo } = this._state;
    const heard = (id: string | null, m: HandMix): HandMix =>
      solo !== null && solo !== id ? { ...m, muted: true } : m;
    for (const [id, m] of Object.entries(trackMix)) this.engine.setTrackMix(id, heard(id, m));
    this.engine.setDrumMix(heard(null, drumMix));
  }

  /**
   * Take a song's tracks and drums as this player's own: what each track sounds like, how loud it
   * starts, the drum hits in order. Returns the mixer state that goes with it. A track that was
   * already here keeps its mute; its volume is the song's, which is where the Studio sets it.
   */
  private adopt(song: Song): Pick<PlayerState, "trackMix" | "drumMix" | "solo"> {
    const before = this._state.trackMix;
    const trackMix: Record<string, HandMix> = {};
    this.trackSound.clear();
    for (const t of song.tracks ?? []) {
      this.trackSound.set(t.id, t.sound);
      trackMix[t.id] = clean({ volume: t.volume ?? 1, muted: before[t.id]?.muted ?? false });
    }
    this.hits = [...(song.drums?.hits ?? [])].sort((a, b) => a.time - b.time);
    const drumMix = clean({
      volume: song.drums?.volume ?? this._state.drumMix.volume,
      muted: this._state.drumMix.muted,
    });
    const solo = this._state.solo !== null && this._state.solo in trackMix ? this._state.solo : null;
    this.engine.keepTracks(Object.keys(trackMix));
    const state = { trackMix, drumMix, solo };
    this._state = { ...this._state, ...state };
    this.applyMix();
    return state;
  }

  /**
   * Put another song under the player. With `keepPosition`, playback carries on from where it is,
   * without a gap: what was already asked for still sounds, and from the next moment on the new
   * song's notes are the ones scheduled — so a note is never played twice. This is how the Studio
   * lets an edit be heard while the music plays. Without it, the new song starts from its beginning.
   */
  setSong(song: Song, opts: { keepPosition?: boolean } = {}) {
    const was = this.duration;
    this.song = song;
    const state = this.adopt(song);
    const duration = this.duration;
    // The loop and the zoomed-in window must still fit; a loop that was "the whole song" still is.
    let loop = this._state.loop;
    if (!loop.enabled && loop.start === 0 && loop.end >= was - 1e-6) loop = { ...loop, end: duration };
    else {
      const start = clamp(loop.start, 0, Math.max(0, duration - MIN_LOOP));
      loop = { ...loop, start, end: clamp(loop.end, start + MIN_LOOP, Math.max(duration, start + MIN_LOOP)) };
    }
    let window = this._state.window;
    if (window && (window.start >= duration || window.end > duration)) window = null;
    this.update({ ...state, loop, window });
    if (!opts.keepPosition) this.seek(0);
    else if (this.currentTime() > duration) this.seek(duration);
  }

  setSound(sound: SoundId) {
    this.releaseAll();
    this.update({ sound });
    this.engine.setSound(sound);
  }

  setStereo(stereo: boolean) {
    this.update({ stereo });
    this.engine.setStereoSplit(stereo);
  }

  /** Press or lift the sustain pedal. Lifting it silences what was ringing. */
  setSustain(sustain: boolean) {
    this.update({ sustain });
    this.engine.setSustain(sustain);
  }

  setMetronome(metronome: boolean) {
    this.update({ metronome });
  }

  /** Pause, move to `t`, and sound every note that starts at that moment. */
  async strikeAt(t: number) {
    await this.engine.start();
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

  /** Stop, fall silent and let go of the engine, which carries on for the next song. */
  dispose() {
    this.stopTimer();
    this.counting = null;
    this.stopListeningToPiano();
    this.sink.releaseAll();
    this.engine.keepTracks([]);
    this.listeners.clear();
    this.wrapListeners.clear();
  }

  // ---- internals -----------------------------------------------------------

  private trigger(n: Note, dur: number, when: number) {
    // A muted hand is still scheduled; only its gain is zero. Un-muting mid-note brings it straight back.
    this.sink.play(n.pitch, Math.max(dur, 0.05), n.velocity ?? 0.7, this.channel(n), when);
  }

  /** Where a note is played: its hand, and for a song with tracks, its track and that track's sound. */
  private channel(n: Note): Channel {
    if (n.track === undefined) return { hand: n.hand };
    const sound = this.trackSound.get(n.track);
    return sound ? { hand: n.hand, track: n.track, sound } : { hand: n.hand, track: n.track };
  }

  private releaseAll() {
    this.sink.releaseAll();
  }

  private stopTimer() {
    this.timer?.();
    this.timer = null;
  }

  /** Ask for the count-in's clicks as they come due. True while the music itself must still wait. */
  private countIn(): boolean {
    const c = this.counting;
    if (!c) return false;
    const now = this.now();
    while (c.next < c.total && c.start + c.next * c.beat < now + LOOKAHEAD) {
      this.sink.click(c.next % c.perBar === 0, Math.max(c.start + c.next * c.beat, now));
      c.next++;
    }
    if (now >= this.anchorCtx) {
      this.counting = null;
      this.update({ countIn: false });
      return false;
    }
    // Notes are not asked for until the usual look-ahead before the start, so a pause during the
    // count leaves nothing waiting to sound.
    return now < this.anchorCtx - LOOKAHEAD;
  }

  private tick() {
    if (this.countIn()) return;
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

    const hits = this.hits;
    if (hits.length) {
      const kit = this.song.drums?.kit;
      for (let i = lowerBound(hits, this.scheduledUpTo); i < hits.length; i++) {
        const h = hits[i];
        if (h.time >= windowEnd) break;
        this.sink.drum?.(h.pad, h.velocity ?? 0.7, toCtx(h.time), kit);
      }
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

/** A mix made safe: a volume between 0 and 1, a mute that is a boolean. */
const clean = (m: HandMix): HandMix => ({
  volume: clamp(Number.isFinite(m.volume) ? m.volume : 1, 0, 1),
  muted: !!m.muted,
});

/** Index of the first note (or hit) with time >= t. */
function lowerBound(notes: readonly { time: number }[], t: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].time < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
