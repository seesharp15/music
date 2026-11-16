import type { DrumPadId, SoundId } from "./types";

/** Every instrument sound, as a list: for validating stored data. Kept in step with `SoundId`. */
export const SOUND_IDS = ["clear", "soft", "epiano", "bright", "piano"] as const satisfies readonly SoundId[];

/** Every drum pad, in the order a kit lays them out. Kept in step with `DrumPadId`. */
export const DRUM_PADS = [
  "kick",
  "snare",
  "rim",
  "clap",
  "hat",
  "hatOpen",
  "hatPedal",
  "tomLow",
  "tomMid",
  "tomHigh",
  "crash",
  "ride",
  "shaker",
  "tamb",
  "cowbell",
  "perc",
] as const satisfies readonly DrumPadId[];

// A sound or pad added to the type but not to its list fails to compile here.
type Missing<All, Listed> = Exclude<All, Listed>;
const _sounds: Missing<SoundId, (typeof SOUND_IDS)[number]> extends never ? true : never = true;
const _pads: Missing<DrumPadId, (typeof DRUM_PADS)[number]> extends never ? true : never = true;
void _sounds;
void _pads;

export const MIN_PITCH = 21;
export const MAX_PITCH = 108;
