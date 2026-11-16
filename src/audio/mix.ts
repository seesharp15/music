import type { Hand } from "../song/types";
import type { HandMix } from "./types";

/** How loud each hand is: a slider position and a mute switch that remembers it. */
export type Mix = Record<Hand, HandMix>;

export const FULL: HandMix = { volume: 1, muted: false };
export const defaultMix = (): Mix => ({ L: { ...FULL }, R: { ...FULL } });

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Slider position to gain. Squared, so the slider feels even from quiet to loud:
 * half way down is a quarter of the amplitude, 12 dB quieter.
 */
export const gainOf = (m: HandMix) => (m.muted ? 0 : clamp01(m.volume) ** 2);

/** Whether a hand is making any sound. */
export const audible = (m: HandMix) => !m.muted && m.volume > 0;

/** How opaque a hand's falling notes are drawn: faint when muted, fuller as it gets louder. */
export const alphaOf = (m: HandMix) => (m.muted ? 0.2 : 0.45 + 0.55 * clamp01(m.volume));

/** The three looks the rhythm map has for a hand. */
export const lookOf = (m: HandMix): "on" | "soft" | "off" => (m.muted ? "off" : m.volume < 0.6 ? "soft" : "on");

/** "70%", or "Muted". */
export const describe = (m: HandMix) => (m.muted ? "Muted" : `${Math.round(clamp01(m.volume) * 100)}%`);

/**
 * Sessions saved before hands had a volume stored one of three levels each.
 * Soft was a gain of 0.22, which is 47% on the slider (0.47² ≈ 0.22).
 */
export function fromLevels(levels: Partial<Record<Hand, unknown>>): Mix {
  const one = (level: unknown): HandMix =>
    level === "off" ? { volume: 1, muted: true } : level === "soft" ? { volume: 0.47, muted: false } : { ...FULL };
  return { L: one(levels.L), R: one(levels.R) };
}

/** Anything read back from storage, made safe to use. */
export function sanitizeMix(raw: unknown): Mix | null {
  if (!raw || typeof raw !== "object") return null;
  const one = (m: unknown): HandMix | null => {
    if (!m || typeof m !== "object") return null;
    const { volume, muted } = m as Partial<HandMix>;
    return typeof volume === "number" && Number.isFinite(volume) ? { volume: clamp01(volume), muted: !!muted } : null;
  };
  const L = one((raw as Partial<Mix>).L);
  const R = one((raw as Partial<Mix>).R);
  return L && R ? { L, R } : null;
}
