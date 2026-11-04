import type { Hand } from "../song/types";

export const HAND_COLORS: Record<Hand, { fill: string; dark: string; glow: string }> = {
  R: { fill: "#5fd38d", dark: "#2f9e5f", glow: "rgba(95, 211, 141, 0.55)" },
  L: { fill: "#5aa8f8", dark: "#2f73c4", glow: "rgba(90, 168, 248, 0.55)" },
};
