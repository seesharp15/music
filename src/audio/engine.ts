import * as Tone from "tone";
import type { DrumPadId, Hand, SoundId } from "../song/types";
import { SynthKit } from "./drums";
import { defaultMix, FULL, gainOf, type Mix } from "./mix";
import type { AudioEngine, Channel, HandMix, Sink } from "./types";

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
  /** Key down now, key up later: live playing. */
  triggerAttack(note: string, time: number, velocity: number): unknown;
  triggerRelease(note: string, time: number): unknown;
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
   * A key held down by hand under the pedal: it sounds until `release` lets it go, and then rings.
   * Returns how to let it go, or null when no voice could be had.
   */
  attack(sound: SynthSound, pitch: number, velocity: number, when: number): ((when: number) => void) | null {
    const mine = this.pool.filter((v) => v.sound === sound);
    let voice = mine.find((v) => v.pitch === pitch && v.busyUntil > when) ?? mine.find((v) => v.busyUntil <= when);
    if (!voice && this.pool.length < MAX_RING_VOICES) {
      voice = { synth: ringingVoice(sound).connect(this.bus), sound, pitch, busyUntil: 0 };
      this.pool.push(voice);
    }
    voice ??= mine.length ? mine.reduce((a, b) => (a.busyUntil <= b.busyUntil ? a : b)) : undefined;
    if (!voice) return null;
    const held = voice;
    held.pitch = pitch;
    held.busyUntil = Infinity; // until the key comes up
    held.synth.triggerAttack(Tone.Frequency(pitch, "midi").toNote(), when, velocity);
    return (at) => {
      // Another key may have taken the voice over since; then there is nothing of this note left.
      if (held.pitch !== pitch || held.busyUntil !== Infinity) return;
      held.busyUntil = at + RING_BUSY;
      held.synth.triggerRelease(at);
    };
  }

  /** The sampled piano, held by hand under the pedal. */
  attackSampled(buffers: Tone.ToneAudioBuffers, pitch: number, velocity: number, when: number): (when: number) => void {
    this.sampler ??= new Tone.Sampler({ urls: sampleUrls(buffers), release: SAMPLE_RING, curve: "linear" }).connect(
      this.bus,
    );
    const sampler = this.sampler;
    const note = Tone.Frequency(pitch, "midi").toNote();
    sampler.triggerAttack(note, when, velocity);
    return (at) => sampler.triggerRelease(note, at);
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

export interface EngineOptions {
  sound?: SoundId;
  stereo?: boolean;
  mix?: Mix;
  sustain?: boolean;
}

/** A track's strip, or with no track the hand itself: where a channel's instruments are plugged in. */
const stripKey = (ch: Channel) => `${ch.track ?? ""}:${ch.hand}`;
const HANDS: Hand[] = ["L", "R"];
const panOf = (hand: Hand, stereo: boolean) => (stereo ? (hand === "L" ? -0.7 : 0.7) : 0);

/**
 * How far over full scale the live path can be driven before its clipper runs out of curve: 12 dB.
 * Below the ceiling the curve is a straight line, so what is played quietly is not touched at all.
 */
const CLIP_RANGE = 4;
const CLIP_CEILING = Math.pow(10, CEILING_DB / 20);
const CLIP_LIMIT = 0.98;
const CLIP_CURVE = (() => {
  const curve = new Float32Array(8193);
  const room = CLIP_LIMIT - CLIP_CEILING;
  for (let i = 0; i < curve.length; i++) {
    const x = ((i / (curve.length - 1)) * 2 - 1) * CLIP_RANGE;
    const a = Math.abs(x);
    curve[i] = Math.sign(x) * (a <= CLIP_CEILING ? a : CLIP_CEILING + room * Math.tanh((a - CLIP_CEILING) / room));
  }
  return curve;
})();

/**
 * One path from instruments to a master: the two hands, each with a gain and a pan, the strips of
 * any tracks, the instruments plugged into them, and what is ringing under the pedal.
 *
 * The engine has two. Everything the player schedules goes through `main`, which ends in the
 * limiter. Everything played by hand goes through `live`, which does not — see `Engine`.
 */
class Bus {
  readonly master: Tone.Gain;
  private hands: Record<Hand, { gain: Tone.Gain; pan: Tone.Panner }>;
  /** Per track and hand, a gain between that track's instruments and the hand. */
  private strips = new Map<string, Tone.Gain>();
  /** Keyed by strip and sound. */
  private instruments = new Map<string, Instrument>();
  /** Ringing notes per strip while the pedal is down; replaced each time it lifts. */
  private ringing = new Map<string, RingBank>();
  /** Banks that have been damped and are waiting to be thrown away once they are silent. */
  private damped: { bank: RingBank; at: number }[] = [];

  constructor(
    mix: Mix,
    stereo: boolean,
    private trackMix: Map<string, HandMix>,
    private create: (sound: SoundId) => Instrument,
  ) {
    this.master = new Tone.Gain(1);
    const mk = (hand: Hand) => {
      const p = new Tone.Panner(0).connect(this.master);
      return { gain: new Tone.Gain(gainOf(mix[hand])).connect(p), pan: p };
    };
    this.hands = { L: mk("L"), R: mk("R") };
    this.setStereo(stereo);
  }

  /** Where a channel's instruments are plugged in: its track's strip, or straight into the hand. */
  destination(ch: Channel): Tone.Gain {
    if (!ch.track) return this.hands[ch.hand].gain;
    const key = stripKey(ch);
    let strip = this.strips.get(key);
    if (!strip) {
      strip = new Tone.Gain(gainOf(this.trackMix.get(ch.track) ?? FULL)).connect(this.hands[ch.hand].gain);
      this.strips.set(key, strip);
    }
    return strip;
  }

  instrument(ch: Channel, sound: SoundId): Instrument {
    const key = `${stripKey(ch)}:${sound}`;
    let inst = this.instruments.get(key);
    if (!inst) {
      inst = this.create(sound);
      (inst as unknown as Tone.ToneAudioNode).connect(this.destination(ch));
      this.instruments.set(key, inst);
    }
    return inst;
  }

  bank(ch: Channel): RingBank {
    this.sweep();
    const key = stripKey(ch);
    let bank = this.ringing.get(key);
    if (!bank) {
      bank = new RingBank(this.destination(ch));
      this.ringing.set(key, bank);
    }
    return bank;
  }

  damp(at: number) {
    for (const bank of this.ringing.values()) {
      bank.damp(at);
      this.damped.push({ bank, at });
    }
    this.ringing.clear();
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

  releaseAll() {
    for (const i of this.instruments.values()) i.releaseAll();
  }

  setHandMix(hand: Hand, mix: HandMix, when?: number) {
    this.hands[hand].gain.gain.rampTo(gainOf(mix), MIX_RAMP, when);
  }

  setTrackMix(trackId: string, mix: HandMix, when?: number) {
    for (const hand of HANDS) this.strips.get(`${trackId}:${hand}`)?.gain.rampTo(gainOf(mix), MIX_RAMP, when);
  }

  setStereo(stereo: boolean) {
    for (const h of HANDS) this.hands[h].pan.pan.rampTo(panOf(h, stereo), 0.05);
  }

  keepTracks(keep: Set<string>) {
    const trackOf = (key: string) => key.slice(0, key.indexOf(":"));
    const gone = (key: string) => trackOf(key) !== "" && !keep.has(trackOf(key));
    for (const [key, instrument] of this.instruments) {
      if (!gone(key)) continue;
      instrument.dispose();
      this.instruments.delete(key);
    }
    for (const [key, bank] of this.ringing) {
      if (!gone(key)) continue;
      bank.dispose();
      this.ringing.delete(key);
    }
    for (const [key, strip] of this.strips) {
      if (!gone(key)) continue;
      strip.dispose();
      this.strips.delete(key);
    }
  }

  inspect() {
    return { strips: [...this.strips.keys()].sort(), instruments: [...this.instruments.keys()].sort() };
  }

  dispose() {
    for (const i of this.instruments.values()) i.dispose();
    for (const bank of this.ringing.values()) bank.dispose();
    this.damped.forEach(({ bank }) => bank.dispose());
    for (const strip of this.strips.values()) strip.dispose();
    for (const c of Object.values(this.hands)) {
      c.gain.dispose();
      c.pan.dispose();
    }
    this.master.dispose();
  }
}

/**
 * The audio engine: everything that makes a sound. The player schedules; this plays — and it can be
 * played directly, with no look-ahead, from keys, pads and MIDI. See docs/plan/contracts.md §6.
 *
 *   scheduled:  instrument ─► [track strip] ─► hand gain ─► hand pan ─┐
 *               drum kit ───────────────────────────► drum bus ──────┼─► master ─► limiter ─► output
 *               click ─────────────────────────────► click bus ──────┘
 *
 *   by hand:    instrument ─► [track strip] ─► hand gain ─► hand pan ─► live master ─► clipper ─► output
 *
 * A bank song has no tracks, so its notes go straight to the hand gains: the path Practice has always
 * had. Track strips, the drum kit, the click and the whole live path exist only once something uses
 * them.
 *
 * The limiter only acts on peaks that would otherwise clip, such as a full two-handed chord at top
 * volume. (Tone's own `Limiter` has a 30 dB soft knee and lets such a chord through 3 dB over full
 * scale, so this is a hard-knee compressor with its makeup gain taken back out.)
 *
 * Why notes played by hand do not go through it: a browser's compressor looks 6 ms ahead, and so
 * delays everything by 6 ms. Nobody hears that in a song that is being played back; under a finger
 * it is two render quanta of lag for no reason. So the live path has the same hands, strips and mix,
 * and ends in a soft clipper with no memory and no delay — a straight line below the limiter's
 * ceiling, bending only the peaks that would have clipped.
 *
 * One engine serves the page (`sharedEngine`), so instruments and the piano's samples outlive any
 * one song. It is built on whichever Tone context is current when constructed, so the same class
 * renders offline in tests.
 */
export class Engine implements AudioEngine, Sink {
  piano: PianoStatus = "idle";

  private sound: SoundId;
  private sustain: boolean;
  private mix: Mix;
  private stereo: boolean;
  private trackMix = new Map<string, HandMix>();
  /** What the player schedules. */
  private main: Bus;
  /** What is played by hand; made when first needed. */
  private live: Bus | null = null;
  private clipper: Tone.WaveShaper | null = null;
  private clipperIn: Tone.Gain | null = null;
  private pianoBuffers: Tone.ToneAudioBuffers | null = null;
  private clickSynth: Tone.Synth | null = null;
  private clickBus: Tone.Gain | null = null;
  private drumBus: Tone.Gain | null = null;
  private drumMix: HandMix = { ...FULL };
  private kit: SynthKit | null = null;
  /** Keys held down by hand, and how to let each go. */
  private held = new Map<string, (when: number) => void>();
  private limiter: Tone.Compressor;
  private output: Tone.Gain;
  private taps: (AudioNode | Tone.ToneAudioNode)[] = [];
  private pianoListeners = new Set<(status: PianoStatus) => void>();
  private waiting: ((status: PianoStatus) => void)[] = [];

  constructor(opts: EngineOptions = {}) {
    this.sound = opts.sound ?? "clear";
    this.sustain = opts.sustain ?? false;
    this.mix = opts.mix ?? defaultMix();
    this.stereo = opts.stereo ?? false;
    this.output = new Tone.Gain(1 / MAKEUP_GAIN).toDestination();
    this.limiter = new Tone.Compressor({
      threshold: CEILING_DB,
      ratio: LIMIT_RATIO,
      knee: 0,
      attack: 0.003,
      release: 0.1,
    }).connect(this.output);
    this.main = new Bus(this.mix, this.stereo, this.trackMix, (sound) => this.createInstrument(sound));
    this.main.master.connect(this.limiter);
    if (this.sound === "piano") this.loadPiano();
  }

  /** The path for notes played by hand, built the first time one is. */
  private liveBus(): Bus {
    if (this.live) return this.live;
    this.clipper = new Tone.WaveShaper(CLIP_CURVE).toDestination();
    this.clipperIn = new Tone.Gain(1 / CLIP_RANGE).connect(this.clipper);
    for (const node of this.taps) Tone.connect(this.clipper, node);
    this.live = new Bus(this.mix, this.stereo, this.trackMix, (sound) => this.createInstrument(sound));
    this.live.master.connect(this.clipperIn);
    return this.live;
  }

  // ---- the clock ---------------------------------------------------------------

  /** Resumes the context; must be called from a user gesture. */
  start(): Promise<void> {
    return Tone.start();
  }

  /** Audio-context seconds: the clock every `when` is measured on. */
  now(): number {
    return Tone.getContext().currentTime;
  }

  /** Output latency in seconds, as far as the browser will say, for lining up recorded input. */
  latency(): number {
    const raw = Tone.getContext().rawContext as unknown as { outputLatency?: number; baseLatency?: number };
    return raw.outputLatency || raw.baseLatency || 0;
  }

  // ---- scheduled playing: the Sink ---------------------------------------------

  play(pitch: number, duration: number, velocity: number, ch: Channel, when: number) {
    const sound = this.resolve(ch.sound);
    if (this.sustain && this.ring(sound, pitch, duration, velocity, ch, when)) return;
    this.main
      .instrument(ch, sound)
      .triggerAttackRelease(Tone.Frequency(pitch, "midi").toNote(), duration, when, velocity);
  }

  /** Play a note that rings on after its key is released. False if it could not be done. */
  private ring(sound: SoundId, pitch: number, duration: number, velocity: number, ch: Channel, when: number): boolean {
    const bank = this.main.bank(ch);
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
    this.main.damp(at);
    this.live?.damp(at);
  }

  click(accent: boolean, when: number) {
    if (!this.clickSynth) {
      this.clickBus = new Tone.Gain(1).connect(this.main.master);
      this.clickSynth = new Tone.Synth({
        oscillator: { type: "sine" },
        envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
        volume: -8,
      }).connect(this.clickBus);
    }
    this.clickSynth.triggerAttackRelease(accent ? 1760 : 1175, 0.03, when, accent ? 1 : 0.6);
  }

  /**
   * One drum hit, at `when` or at once. Every pad is covered by a synthesized kit that needs no
   * download; `kit` names a sampled kit when one is installed (Stage 4), with this as its fallback.
   */
  drum(pad: DrumPadId, velocity: number, when?: number, _kit?: string) {
    if (!this.kit) {
      this.drumBus = new Tone.Gain(gainOf(this.drumMix)).connect(this.main.master);
      this.kit = new SynthKit(this.drumBus);
    }
    this.kit.hit(pad, velocity, when ?? Tone.immediate());
  }

  releaseAll() {
    this.held.clear();
    this.main.releaseAll();
    this.live?.releaseAll();
    this.damp();
  }

  // ---- live playing ------------------------------------------------------------

  /**
   * A key goes down, now: on-screen keys, MIDI, auditioning a dragged note. There is no look-ahead —
   * the note is asked for at the audio clock's present moment, on a path with no delay in it — so it
   * sounds in the next render quantum. With the pedal down it rings on after `noteOff`.
   */
  noteOn(pitch: number, velocity: number, ch: Channel, when?: number) {
    const at = when ?? Tone.immediate();
    const key = `${stripKey(ch)}:${pitch}`;
    this.held.get(key)?.(at); // the same key again: let the first go
    const sound = this.resolve(ch.sound);
    const note = Tone.Frequency(pitch, "midi").toNote();
    const bus = this.liveBus();
    if (this.sustain) {
      const bank = bus.bank(ch);
      const release =
        sound === "piano"
          ? bank.attackSampled(this.pianoBuffers!, pitch, velocity, at)
          : bank.attack(sound, pitch, velocity, at);
      if (release) {
        this.held.set(key, release);
        return;
      }
    }
    const instrument = bus.instrument(ch, sound);
    instrument.triggerAttack(note, at, velocity);
    this.held.set(key, (t) => instrument.triggerRelease(note, t));
  }

  noteOff(pitch: number, ch: Channel, when?: number) {
    const key = `${stripKey(ch)}:${pitch}`;
    const release = this.held.get(key);
    if (!release) return;
    this.held.delete(key);
    release(when ?? Tone.immediate());
  }

  /**
   * Get a channel ready to be played by hand: build its instrument and `voices` of its voices now,
   * so the first notes do not wait on that. Call it when something playable appears — a keyboard on
   * screen, a MIDI device — not at start-up: Practice, which only schedules, has no need of it.
   * Without it the first note of a sound is still played, some milliseconds late.
   */
  prepare(ch: Channel, voices = 6) {
    const sound = this.resolve(ch.sound);
    const instrument = this.liveBus().instrument(ch, sound);
    if (sound === "piano") return; // a sampler has no voices to build
    // A chord at no volume: every voice it takes is built, plays nothing, and goes back on the shelf.
    const notes = Array.from({ length: voices }, (_, i) => Tone.Frequency(60 + i, "midi").toNote());
    (instrument as unknown as Tone.PolySynth).triggerAttackRelease(notes, 0.01, Tone.immediate(), 0);
  }

  // ---- settings ----------------------------------------------------------------

  setSound(sound: SoundId) {
    this.sound = sound;
    if (sound === "piano") this.loadPiano();
  }

  /** Press or lift the sustain pedal. Lifting it silences what was ringing. */
  setSustain(down: boolean) {
    if (down === this.sustain) return;
    this.sustain = down;
    if (!down) {
      this.held.clear();
      this.damp();
    }
  }

  /**
   * Set one hand's volume and mute. The change is smoothed over a few hundredths of a second.
   * `when` is an audio-clock time, for changes scheduled ahead (offline renders use it).
   */
  setHandMix(hand: Hand, mix: HandMix, when?: number) {
    this.mix = { ...this.mix, [hand]: { ...mix } };
    this.main.setHandMix(hand, mix, when);
    this.live?.setHandMix(hand, mix, when);
  }

  /** Set one track's volume and mute, whichever hands its notes are in. */
  setTrackMix(trackId: string, mix: HandMix, when?: number) {
    this.trackMix.set(trackId, { ...mix });
    this.main.setTrackMix(trackId, mix, when);
    this.live?.setTrackMix(trackId, mix, when);
  }

  setDrumMix(mix: HandMix, when?: number) {
    this.drumMix = { ...mix };
    this.drumBus?.gain.rampTo(gainOf(mix), MIX_RAMP, when);
  }

  setStereoSplit(on: boolean) {
    this.stereo = on;
    this.main.setStereo(on);
    this.live?.setStereo(on);
  }

  /**
   * Forget every track but these: their strips, instruments and mix. The player calls it when its
   * song changes, so tracks that are gone do not pile up. Tracks that stay are not touched, and so
   * do not so much as click.
   */
  keepTracks(ids: readonly string[]) {
    const keep = new Set(ids);
    this.main.keepTracks(keep);
    this.live?.keepTracks(keep);
    for (const id of this.trackMix.keys()) if (!keep.has(id)) this.trackMix.delete(id);
  }

  /** What the engine is holding on to, by name: for tests that check nothing piles up. */
  inspect(): { strips: string[]; instruments: string[]; live: { strips: string[]; instruments: string[] } | null } {
    return { ...this.main.inspect(), live: this.live?.inspect() ?? null };
  }

  /** Send a copy of everything the engine puts out to another node: a meter, a recorder, a test. */
  tap(node: AudioNode | Tone.ToneAudioNode) {
    this.taps.push(node);
    Tone.connect(this.output, node);
    if (this.clipper) Tone.connect(this.clipper, node);
  }

  /** Be told as the sampled grand piano loads, is ready, or fails. Returns how to stop being told. */
  onPiano(fn: (status: PianoStatus) => void): () => void {
    this.pianoListeners.add(fn);
    return () => this.pianoListeners.delete(fn);
  }

  /** Resolves once the grand piano has loaded or failed; at once for the other sounds. */
  ready(): Promise<PianoStatus> {
    if (this.piano !== "loading") return Promise.resolve(this.piano);
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  dispose() {
    this.main.dispose();
    this.live?.dispose();
    this.clipperIn?.dispose();
    this.clipper?.dispose();
    this.pianoBuffers?.dispose();
    this.clickSynth?.dispose();
    this.clickBus?.dispose();
    this.kit?.dispose();
    this.drumBus?.dispose();
    this.limiter.dispose();
    this.output.dispose();
    this.pianoListeners.clear();
  }

  // ---- internals -------------------------------------------------------------

  private setPiano(status: PianoStatus) {
    this.piano = status;
    this.pianoListeners.forEach((fn) => fn(status));
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

  /**
   * The sound a channel plays: its own, or the engine's. The grand piano plays as Clear until its
   * samples arrive, or if they never do. A track that asks for the piano starts the download.
   */
  private resolve(asked?: SoundId): SoundId {
    const sound = asked ?? this.sound;
    if (sound !== "piano") return sound;
    if (this.piano === "idle") this.loadPiano();
    return this.piano === "ready" ? "piano" : "clear";
  }

  private createInstrument(sound: SoundId): Instrument {
    if (sound === "piano") return new Tone.Sampler({ urls: sampleUrls(this.pianoBuffers!), release: 1 });
    const { fm, options } = SYNTHS[sound];
    return fm
      ? new Tone.PolySynth(Tone.FMSynth, options as ConstructorParameters<typeof Tone.FMSynth>[0])
      : new Tone.PolySynth(Tone.Synth, options as ConstructorParameters<typeof Tone.Synth>[0]);
  }
}

let shared: Engine | null = null;
/** The page's one engine, made the first time it is wanted. */
export function sharedEngine(): Engine {
  return (shared ??= new Engine());
}
