import * as Tone from "tone";
import type { DrumPadId } from "../song/types";

/**
 * A drum kit made of synthesizers: nothing to download, every pad covered. It is the kit until
 * sampled ones arrive (Stage 4), and the fallback for each of them after.
 *
 * Each pad is one voice, made the first time it is hit. A drum struck again while it still sounds is
 * cut off and restarted, as a real drum head is.
 */
type Voice = { hit(velocity: number, when: number): void; dispose(): void };

const membrane = (
  out: Tone.ToneAudioNode,
  note: string,
  decay: number,
  db: number,
  octaves = 5,
  pitchDecay = 0.04,
): Voice => {
  const synth = new Tone.MembraneSynth({
    pitchDecay,
    octaves,
    oscillator: { type: "sine" },
    envelope: { attack: 0.001, decay, sustain: 0, release: 0.05 },
    volume: db,
  }).connect(out);
  return { hit: (v, t) => synth.triggerAttackRelease(note, decay, t, v), dispose: () => void synth.dispose() };
};

const noise = (
  out: Tone.ToneAudioNode,
  type: "white" | "pink",
  decay: number,
  db: number,
  filter: { type: BiquadFilterType; frequency: number },
  flam = 0,
): Voice => {
  const shape = new Tone.Filter(filter.frequency, filter.type).connect(out);
  const synth = new Tone.NoiseSynth({
    noise: { type },
    envelope: { attack: 0.001, decay, sustain: 0, release: 0.02 },
    volume: db,
  }).connect(shape);
  return {
    hit(v, t) {
      // A hand clap is several hands, not quite together.
      if (flam) synth.triggerAttackRelease(flam, t, v * 0.7);
      synth.triggerAttackRelease(decay, t + flam, v);
    },
    dispose() {
      synth.dispose();
      shape.dispose();
    },
  };
};

const metal = (
  out: Tone.ToneAudioNode,
  frequency: number,
  decay: number,
  db: number,
  harmonicity = 5.1,
  resonance = 4000,
): Voice => {
  const synth = new Tone.MetalSynth({
    harmonicity,
    modulationIndex: 32,
    resonance,
    octaves: 1.5,
    envelope: { attack: 0.001, decay, release: 0.02 },
    volume: db,
  }).connect(out);
  return { hit: (v, t) => synth.triggerAttackRelease(frequency, decay, t, v), dispose: () => void synth.dispose() };
};

const both = (a: Voice, b: Voice): Voice => ({
  hit(v, t) {
    a.hit(v, t);
    b.hit(v, t);
  },
  dispose() {
    a.dispose();
    b.dispose();
  },
});

const PADS: Record<DrumPadId, (out: Tone.ToneAudioNode) => Voice> = {
  kick: (o) => membrane(o, "C1", 0.35, -4, 6, 0.05),
  snare: (o) =>
    both(noise(o, "white", 0.16, -12, { type: "highpass", frequency: 1200 }), membrane(o, "G2", 0.1, -14, 2, 0.02)),
  rim: (o) => membrane(o, "G4", 0.03, -14, 1, 0.005),
  clap: (o) => noise(o, "pink", 0.14, -9, { type: "bandpass", frequency: 1500 }, 0.012),
  hat: (o) => metal(o, 320, 0.05, -26),
  hatOpen: (o) => metal(o, 320, 0.35, -28),
  hatPedal: (o) => metal(o, 300, 0.03, -30),
  tomLow: (o) => membrane(o, "G1", 0.3, -8, 3),
  tomMid: (o) => membrane(o, "D2", 0.26, -8, 3),
  tomHigh: (o) => membrane(o, "A2", 0.22, -8, 3),
  crash: (o) =>
    both(metal(o, 280, 1.4, -28, 5.1, 5000), noise(o, "white", 0.9, -22, { type: "highpass", frequency: 5000 })),
  ride: (o) => metal(o, 480, 0.7, -30, 7.3, 6000),
  shaker: (o) => noise(o, "white", 0.06, -18, { type: "highpass", frequency: 6000 }),
  tamb: (o) =>
    both(metal(o, 900, 0.12, -32, 8.2, 7000), noise(o, "white", 0.08, -24, { type: "highpass", frequency: 7000 })),
  cowbell: (o) => metal(o, 560, 0.18, -26, 1.48, 2000),
  perc: (o) => membrane(o, "D4", 0.14, -12, 1.5, 0.01),
};

export class SynthKit {
  private voices: Partial<Record<DrumPadId, Voice>> = {};
  /** When each pad was last asked to sound, so two hits are never asked for at the very same instant. */
  private last: Partial<Record<DrumPadId, number>> = {};

  /** Headroom: with this, all sixteen pads struck at once at full strength stay under full scale. */
  private trim: Tone.Gain;

  constructor(out: Tone.ToneAudioNode) {
    this.trim = new Tone.Gain(0.7).connect(out);
  }

  hit(pad: DrumPadId, velocity: number, when: number) {
    const make = PADS[pad];
    if (!make) return;
    const voice = (this.voices[pad] ??= make(this.trim));
    // One voice per pad: a second hit must come after the first, if only by a hair.
    const at = Math.max(when, (this.last[pad] ?? -1) + 0.001);
    this.last[pad] = at;
    voice.hit(Math.min(1, Math.max(0.05, velocity)), at);
  }

  dispose() {
    Object.values(this.voices).forEach((v) => v?.dispose());
    this.voices = {};
    this.trim.dispose();
  }
}
