import * as Tone from "tone";
import type { Hand, SoundId } from "../song/types";
import { defaultMix, gainOf, type Mix } from "./mix";
import type { Channel, HandMix, Sink } from "./types";

/** Seconds over which a volume or mute change is smoothed, so it never clicks. */
const MIX_RAMP = 0.04;
/** Where limiting starts, dBFS: sound below this passes untouched. */
const CEILING_DB = -3;
/** Above the ceiling, 20 dB more going in is 1 dB more coming out. */
const LIMIT_RATIO = 20;
/**
 * A browser's compressor always adds "makeup gain", fixed by its settings alone (Web Audio spec,
 * DynamicsCompressorNode): the gain it would apply to a full-scale signal, inverted, to the power 0.6.
 * Taking exactly that back out is what lets quiet sound through at its own level.
 */
const MAKEUP_GAIN = (() => {
  const fullScaleOutDb = CEILING_DB * (1 - 1 / LIMIT_RATIO);
  return Math.pow(10, -fullScaleOutDb / 20) ** 0.6;
})();

const SAMPLE_NOTES = [
  "A0",
  "C1",
  "D#1",
  "F#1",
  "A1",
  "C2",
  "D#2",
  "F#2",
  "A2",
  "C3",
  "D#3",
  "F#3",
  "A3",
  "C4",
  "D#4",
  "F#4",
  "A4",
  "C5",
  "D#5",
  "F#5",
  "A5",
  "C6",
  "D#6",
  "F#6",
  "A6",
  "C7",
  "D#7",
  "F#7",
  "A7",
  "C8",
];

// ---- sustain ---------------------------------------------------------------------------------

/**
 * With the pedal down a released note rings on and dies away like a string: 60 dB in this many
 * seconds. Real time, whatever the playback speed.
 */
const RING_T60 = 6;
/** How long a ringing voice is held before it may be reused: the ring, plus a little. */
const RING_BUSY = RING_T60 + 0.5;
/**
 * The release time that gives Tone that decay. Tone's "exponential" release approaches zero with a
 * time constant of ln(release + 1) / ln(200), far quicker than the name suggests: a 4 s release is
 * 40 dB down after 1.5 s. Working backwards from the decay wanted gives a nominal release of about
 * 100 s, of which only the first few seconds are audible.
 */
const RING_RELEASE = Math.pow(200, RING_T60 / Math.log(1000)) - 1;
/** How long a sampled note may ring under the pedal before it is faded out completely, seconds. */
const SAMPLE_RING = 7;
/** Most voices one hand may have ringing. Past this the oldest ring is cut short to make room. */
const MAX_RING_VOICES = 48;
/** Seconds to silence when the pedal lifts. */
const DAMP = 0.12;

export type PianoStatus = "idle" | "loading" | "ready" | "failed";

interface Instrument {
  triggerAttackRelease(note: string, duration: number, time: number, velocity: number): unknown;
  releaseAll(): unknown;
  dispose(): unknown;
}

type SynthSound = Exclude<SoundId, "piano">;

/** The synthesized sounds: which kind of voice, and its settings. */
const SYNTHS = {
  clear: {
    fm: false,
    options: {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.005, decay: 0.3, sustain: 0.25, release: 0.6 },
      volume: -12,
    },
  },
  soft: {
    fm: false,
    options: {
      oscillator: { type: "sine" },
      envelope: { attack: 0.01, decay: 0.6, sustain: 0.3, release: 0.9 },
      volume: -9,
    },
  },
  bright: {
    fm: false,
    options: {
      oscillator: { type: "square6" },
      envelope: { attack: 0.003, decay: 0.25, sustain: 0.2, release: 0.4 },
      volume: -19,
    },
  },
  epiano: {
    fm: true,
    options: {
      harmonicity: 3,
      modulationIndex: 9,
      oscillator: { type: "sine" },
      modulation: { type: "sine" },
      envelope: { attack: 0.002, decay: 1.4, sustain: 0.15, release: 1 },
      modulationEnvelope: { attack: 0.002, decay: 0.25, sustain: 0, release: 0.2 },
      volume: -14,
    },
  },
} as const;

type AnySynthOptions = ConstructorParameters<typeof Tone.Synth>[0] & ConstructorParameters<typeof Tone.FMSynth>[0];

/** One voice of a synthesized sound, with its release stretched into a ring. */
function ringingVoice(sound: SynthSound): Tone.Synth | Tone.FMSynth {
  const { fm, options } = SYNTHS[sound];
  const stretched = { ...options, envelope: { ...options.envelope, release: RING_RELEASE } } as AnySynthOptions;
  return fm ? new Tone.FMSynth(stretched) : new Tone.Synth(stretched);
}

/**
 * The notes one hand has ringing under the pedal. Tone's own PolySynth drops notes once it runs out
 * of voices and cannot cut a ring short, so the pedal keeps its own small pool: a key struck again
 * takes over its own ring, and when every voice is busy the one nearest silence is reused.
 */
class RingBank {
  /** Everything in the bank passes through here, so lifting the pedal can silence it at once. */
  readonly bus: Tone.Gain;
  private pool: { synth: Tone.Synth | Tone.FMSynth; sound: SynthSound; pitch: number; busyUntil: number }[] = [];
  private sampler: Tone.Sampler | null = null;

  constructor(destination: Tone.ToneAudioNode) {
    this.bus = new Tone.Gain(1).connect(destination);
  }

  play(sound: SynthSound, pitch: number, duration: number, velocity: number, when: number) {
    const mine = this.pool.filter((v) => v.sound === sound);
    let voice =
      mine.find((v) => v.pitch === pitch && v.busyUntil > when) ?? // the same key again
      mine.find((v) => v.busyUntil <= when); // one that has gone quiet
    if (!voice && this.pool.length < MAX_RING_VOICES) {
      voice = { synth: ringingVoice(sound).connect(this.bus), sound, pitch, busyUntil: 0 };
      this.pool.push(voice);
    }
    // Every voice is ringing: take the one that has been ringing longest, which is the quietest.
    voice ??= mine.length ? mine.reduce((a, b) => (a.busyUntil <= b.busyUntil ? a : b)) : undefined;
    if (!voice) return false;
    voice.pitch = pitch;
    voice.busyUntil = when + duration + RING_BUSY;
    voice.synth.triggerAttackRelease(Tone.Frequency(pitch, "midi").toNote(), duration, when, velocity);
    return true;
  }

  /**
   * The sampled piano needs no pool: each note is its own player, and a recorded string dies away by
   * itself. So the pedal only has to stay out of the way: a slow, straight fade that ends the note
   * for certain after `SAMPLE_RING` seconds.
   */
  playSampled(buffers: Tone.ToneAudioBuffers, pitch: number, duration: number, velocity: number, when: number) {
    this.sampler ??= new Tone.Sampler({ urls: sampleUrls(buffers), release: SAMPLE_RING, curve: "linear" }).connect(
      this.bus,
    );
    this.sampler.triggerAttackRelease(Tone.Frequency(pitch, "midi").toNote(), duration, when, velocity);
  }

  /** Lift the dampers back onto the strings: silence within a tenth of a second or so. */
  damp(when?: number) {
    this.bus.gain.rampTo(0, DAMP, when);
  }

  dispose() {
    this.pool.forEach((v) => v.synth.dispose());
    this.sampler?.dispose();
    this.bus.dispose();
  }
}

const sampleUrls = (buffers: Tone.ToneAudioBuffers) =>
  Object.fromEntries(SAMPLE_NOTES.map((n) => [n, buffers.get(n)])) as Record<string, Tone.ToneAudioBuffer>;

export interface VoicesOptions {
  sound: SoundId;
  stereo: boolean;
  mix?: Mix;
  sustain?: boolean;
  /** Called as the sampled grand piano loads, is ready, or fails. */
  onPiano?: (status: PianoStatus) => void;
}

/**
 * The instruments and the mixer: everything that makes a sound. The player schedules; this plays.
 *
 *   instrument ─► hand gain ─► hand pan ─┐
 *   instrument ─► hand gain ─► hand pan ─┼─► master ─► limiter ─► output
 *   click ───────────────────────────────┘
 *
 * The limiter only acts on peaks that would otherwise clip, such as a full two-handed chord at top
 * volume. (Tone's own `Limiter` has a 30 dB soft knee and lets such a chord through 3 dB over full
 * scale, so this is a hard-knee compressor with its makeup gain taken back out.) Built on whichever Tone context is current when it is constructed, so it works the same
 * live and inside `Tone.Offline`.
 */
export class Voices implements Sink {
  piano: PianoStatus = "idle";

  private sound: SoundId;
  private channels: Record<Hand, { gain: Tone.Gain; pan: Tone.Panner }>;
  private instruments: Partial<Record<`${Hand}:${SoundId}`, Instrument>> = {};
  private pianoBuffers: Tone.ToneAudioBuffers | null = null;
  private clickSynth: Tone.Synth | null = null;
  private sustain: boolean;
  /** Ringing notes per hand while the pedal is down; replaced each time it lifts. */
  private ringing: Partial<Record<Hand, RingBank>> = {};
  /** Banks that have been damped and are waiting to be thrown away once they are silent. */
  private damped: { bank: RingBank; at: number }[] = [];
  private master: Tone.Gain;
  private limiter: Tone.Compressor;
  private output: Tone.Gain;
  private onPiano: (status: PianoStatus) => void;

  constructor(opts: VoicesOptions) {
    this.sound = opts.sound;
    this.sustain = opts.sustain ?? false;
    this.onPiano = opts.onPiano ?? (() => {});
    this.output = new Tone.Gain(1 / MAKEUP_GAIN).toDestination();
    this.limiter = new Tone.Compressor({
      threshold: CEILING_DB,
      ratio: LIMIT_RATIO,
      knee: 0,
      attack: 0.003,
      release: 0.1,
    }).connect(this.output);
    this.master = new Tone.Gain(1).connect(this.limiter);
    const mix = opts.mix ?? defaultMix();
    const mk = (hand: Hand) => {
      const p = new Tone.Panner(0).connect(this.master);
      return { gain: new Tone.Gain(gainOf(mix[hand])).connect(p), pan: p };
    };
    this.channels = { L: mk("L"), R: mk("R") };
    this.setStereo(opts.stereo);
    if (this.sound === "piano") this.loadPiano();
  }

  // ---- Sink ------------------------------------------------------------------

  play(pitch: number, duration: number, velocity: number, ch: Channel, when: number) {
    if (this.sustain && this.ring(pitch, duration, velocity, ch.hand, when)) return;
    this.instrument(ch.hand).triggerAttackRelease(Tone.Frequency(pitch, "midi").toNote(), duration, when, velocity);
  }

  /** Play a note that rings on after its key is released. False if it could not be done. */
  private ring(pitch: number, duration: number, velocity: number, hand: Hand, when: number): boolean {
    this.sweep();
    const sound = this.resolved();
    const bank = (this.ringing[hand] ??= new RingBank(this.channels[hand].gain));
    if (sound !== "piano") return bank.play(sound, pitch, duration, velocity, when);
    bank.playSampled(this.pianoBuffers!, pitch, duration, velocity, when);
    return true;
  }

  /**
   * Silence whatever is ringing on under the pedal, at `when` (an audio-clock time) or now. The pedal
   * stays where it is: notes played afterwards ring again. A loop coming round uses this, so the end
   * of the loop does not sound over its start.
   */
  damp(when?: number) {
    const at = when ?? Tone.getContext().currentTime;
    for (const hand of ["L", "R"] as Hand[]) {
      const bank = this.ringing[hand];
      if (!bank) continue;
      bank.damp(at);
      this.damped.push({ bank, at });
      delete this.ringing[hand];
    }
  }

  /** Throw away banks that were damped long enough ago to be silent. */
  private sweep() {
    const now = Tone.getContext().currentTime;
    this.damped = this.damped.filter(({ bank, at }) => {
      if (now < at + DAMP + 0.1) return true;
      bank.dispose();
      return false;
    });
  }

  click(accent: boolean, when: number) {
    this.clickSynth ??= new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
      volume: -8,
    }).connect(this.master);
    this.clickSynth.triggerAttackRelease(accent ? 1760 : 1175, 0.03, when, accent ? 1 : 0.6);
  }

  releaseAll() {
    Object.values(this.instruments).forEach((i) => i?.releaseAll());
    this.damp();
  }

  // ---- settings --------------------------------------------------------------

  setSound(sound: SoundId) {
    this.sound = sound;
    if (sound === "piano") this.loadPiano();
  }

  /** Press or lift the sustain pedal. Lifting it silences what was ringing. */
  setSustain(down: boolean) {
    if (down === this.sustain) return;
    this.sustain = down;
    if (!down) this.damp();
  }

  /**
   * Set one hand's volume and mute. The change is smoothed over a few hundredths of a second.
   * `when` is an audio-clock time, for changes scheduled ahead (offline renders use it).
   */
  setHandMix(hand: Hand, mix: HandMix, when?: number) {
    this.channels[hand].gain.gain.rampTo(gainOf(mix), MIX_RAMP, when);
  }

  setStereo(stereo: boolean) {
    for (const h of ["L", "R"] as Hand[]) {
      this.channels[h].pan.pan.rampTo(stereo ? (h === "L" ? -0.7 : 0.7) : 0, 0.05);
    }
  }

  /** Resolves once the grand piano has loaded or failed; at once for the other sounds. */
  ready(): Promise<PianoStatus> {
    if (this.piano !== "loading") return Promise.resolve(this.piano);
    return new Promise((resolve) => this.waiting.push(resolve));
  }
  private waiting: ((status: PianoStatus) => void)[] = [];

  dispose() {
    Object.values(this.instruments).forEach((i) => i?.dispose());
    this.pianoBuffers?.dispose();
    this.clickSynth?.dispose();
    Object.values(this.ringing).forEach((bank) => bank?.dispose());
    this.damped.forEach(({ bank }) => bank.dispose());
    for (const c of Object.values(this.channels)) {
      c.gain.dispose();
      c.pan.dispose();
    }
    this.master.dispose();
    this.limiter.dispose();
    this.output.dispose();
  }

  // ---- internals -------------------------------------------------------------

  private setPiano(status: PianoStatus) {
    this.piano = status;
    this.onPiano(status);
    if (status !== "loading") this.waiting.splice(0).forEach((resolve) => resolve(status));
  }

  private loadPiano() {
    if (this.piano === "ready" || this.piano === "loading") return;
    this.setPiano("loading");
    this.pianoBuffers = new Tone.ToneAudioBuffers({
      urls: Object.fromEntries(SAMPLE_NOTES.map((n) => [n, `${n.replace("#", "s")}.mp3`])),
      baseUrl: "https://tonejs.github.io/audio/salamander/",
      onload: () => this.setPiano("ready"),
      onerror: () => this.setPiano("failed"),
    });
  }

  /** The sound in use: the grand piano plays as Clear until its samples arrive, or if they never do. */
  private resolved(): SoundId {
    return this.sound === "piano" && this.piano !== "ready" ? "clear" : this.sound;
  }

  private instrument(hand: Hand): Instrument {
    const sound = this.resolved();
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
    if (sound === "piano") return new Tone.Sampler({ urls: sampleUrls(this.pianoBuffers!), release: 1 });
    const { fm, options } = SYNTHS[sound];
    return fm
      ? new Tone.PolySynth(Tone.FMSynth, options as ConstructorParameters<typeof Tone.FMSynth>[0])
      : new Tone.PolySynth(Tone.Synth, options as ConstructorParameters<typeof Tone.Synth>[0]);
  }
}
