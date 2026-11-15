import * as Tone from "tone";
import type { Hand, SoundId } from "../song/types";
import type { Channel, Sink } from "./types";

const SOFT_GAIN = 0.22;

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

export type HandLevel = "on" | "soft" | "off";
export type PianoStatus = "idle" | "loading" | "ready" | "failed";

interface Instrument {
  triggerAttackRelease(note: string, duration: number, time: number, velocity: number): unknown;
  releaseAll(): unknown;
  dispose(): unknown;
}

export interface VoicesOptions {
  sound: SoundId;
  stereo: boolean;
  levels: Record<Hand, HandLevel>;
  /** Called as the sampled grand piano loads, is ready, or fails. */
  onPiano?: (status: PianoStatus) => void;
}

/**
 * The instruments and the two hand channels: everything that makes a sound.
 * The player schedules; this plays. Built on whichever Tone context is current
 * when it is constructed, so it works the same live and inside `Tone.Offline`.
 */
export class Voices implements Sink {
  piano: PianoStatus = "idle";

  private sound: SoundId;
  private channels: Record<Hand, { gain: Tone.Gain; pan: Tone.Panner }>;
  private instruments: Partial<Record<`${Hand}:${SoundId}`, Instrument>> = {};
  private pianoBuffers: Tone.ToneAudioBuffers | null = null;
  private clickSynth: Tone.Synth | null = null;
  private onPiano: (status: PianoStatus) => void;

  constructor(opts: VoicesOptions) {
    this.sound = opts.sound;
    this.onPiano = opts.onPiano ?? (() => {});
    const mk = () => {
      const p = new Tone.Panner(0).toDestination();
      return { gain: new Tone.Gain(1).connect(p), pan: p };
    };
    this.channels = { L: mk(), R: mk() };
    this.setLevels(opts.levels);
    this.setStereo(opts.stereo);
    if (this.sound === "piano") this.loadPiano();
  }

  // ---- Sink ------------------------------------------------------------------

  play(pitch: number, duration: number, velocity: number, ch: Channel, when: number) {
    this.instrument(ch.hand).triggerAttackRelease(Tone.Frequency(pitch, "midi").toNote(), duration, when, velocity);
  }

  click(accent: boolean, when: number) {
    this.clickSynth ??= new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
      volume: -8,
    }).toDestination();
    this.clickSynth.triggerAttackRelease(accent ? 1760 : 1175, 0.03, when, accent ? 1 : 0.6);
  }

  releaseAll() {
    Object.values(this.instruments).forEach((i) => i?.releaseAll());
  }

  // ---- settings --------------------------------------------------------------

  setSound(sound: SoundId) {
    this.sound = sound;
    if (sound === "piano") this.loadPiano();
  }

  setLevels(levels: Record<Hand, HandLevel>) {
    for (const h of ["L", "R"] as Hand[]) {
      this.channels[h].gain.gain.rampTo(levels[h] === "soft" ? SOFT_GAIN : 1, 0.05);
    }
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
    for (const c of Object.values(this.channels)) {
      c.gain.dispose();
      c.pan.dispose();
    }
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

  private instrument(hand: Hand): Instrument {
    let sound = this.sound;
    // Until the samples arrive (or if they never do), the grand piano plays as Clear.
    if (sound === "piano" && this.piano !== "ready") sound = "clear";
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
}
