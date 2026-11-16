/**
 * The audio contracts: what a sound-maker must offer the player (Sink) and, from Stage 2, the whole
 * engine. See docs/plan/contracts.md §6.
 */

import type { DrumPadId, Hand, SoundId } from "../song/types";

export interface HandMix {
  volume: number;
  muted: boolean;
} // volume 0..1 on the slider

/** One per page. Owns the audio context, instruments, buses and the master limiter. */
export interface AudioEngine {
  /** Resumes the context; must be called from a user gesture. */
  start(): Promise<void>;
  now(): number; // audio-context seconds
  /** Live playing: on-screen keys, MIDI, auditioning a dragged note. */
  noteOn(pitch: number, velocity: number, ch: Channel, when?: number): void;
  noteOff(pitch: number, ch: Channel, when?: number): void;
  /** Scheduled playing: the Player. */
  play(pitch: number, duration: number, velocity: number, ch: Channel, when: number): void;
  drum(pad: DrumPadId, velocity: number, when?: number, kit?: string): void;
  click(accent: boolean, when: number): void;
  setHandMix(hand: Hand, mix: HandMix): void;
  setTrackMix(trackId: string, mix: HandMix): void;
  setDrumMix(mix: HandMix): void;
  /** Forget every track but these: the player calls it when its song changes. */
  keepTracks(ids: readonly string[]): void;
  setStereoSplit(on: boolean): void;
  setSustain(down: boolean): void;
  setSound(sound: SoundId): void;
  releaseAll(): void;
  /** Output latency in seconds, for lining up recorded input. */
  latency(): number;
}
export interface Channel {
  hand: Hand;
  track?: string;
  sound?: SoundId;
}

export interface Sink {
  play(pitch: number, duration: number, velocity: number, ch: Channel, when: number): void;
  click(accent: boolean, when: number): void;
  releaseAll(): void;
  /**
   * Silence notes ringing on under the sustain pedal, without lifting it. Optional: a sink with no
   * pedal has nothing to damp.
   */
  damp?(when?: number): void;
  /** One drum hit. Optional: a sink with no drums drops them. */
  drum?(pad: DrumPadId, velocity: number, when: number, kit?: string): void;
}
