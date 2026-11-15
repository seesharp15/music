/** The speed slider's arithmetic: 5–200% on a logarithmic scale, settling on a few marks. */

export const SPEED_MIN = 0.05;
export const SPEED_MAX = 2;
export const SPEED_MARKS = [0.1, 0.5, 0.75, 1];
export const SPEED_STEPS = 1000; // slider resolution
const SPEED_SNAP = 0.07; // within ~7% of a mark, the slider settles on it
const SPEED_LOG_SPAN = Math.log(SPEED_MAX / SPEED_MIN);

/** Slider position (0–1) for a speed. Logarithmic, so slow speeds get room and 100–200% stays short. */
export const speedToPos = (r: number) => Math.log(r / SPEED_MIN) / SPEED_LOG_SPAN;
export const posToSpeed = (p: number) => SPEED_MIN * Math.exp(p * SPEED_LOG_SPAN);

export const round2 = (x: number) => Math.round(x * 100) / 100;

/** Settle on 10/50/75/100% when close, but leave every other value reachable. */
export const snapRate = (r: number) => SPEED_MARKS.find((m) => Math.abs(Math.log(r / m)) <= SPEED_SNAP) ?? round2(r);

/** One press of the speed keys: 5% steps, 1% steps below 25%. */
export const slower = (r: number) => Math.max(SPEED_MIN, round2(r - (r > 0.25 + 1e-9 ? 0.05 : 0.01)));
export const faster = (r: number) => Math.min(SPEED_MAX, round2(r + (r >= 0.25 - 1e-9 ? 0.05 : 0.01)));
