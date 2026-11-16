/**
 * Input latency: how long after a key, pad or voice the app hears about it, measured on this device.
 * Every recording path — live notes, pads, humming — subtracts it, so what is recorded lands where it
 * was played. Stage 4 adds the calibration screen that measures and writes it; until a device has
 * been calibrated the answer is 0. See docs/plan/contracts.md §6.
 */
const KEY = "piano-tutor:latency";
/** Anything outside this is a bad measurement, not a device. */
const MAX_MS = 500;

export function inputLatencyMs(): number {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return 0;
    const value: unknown = JSON.parse(raw);
    // Stored as a number, or as { ms } so that more can be kept beside it later.
    const ms = typeof value === "number" ? value : (value as { ms?: unknown } | null)?.ms;
    return typeof ms === "number" && Number.isFinite(ms) && ms >= 0 && ms <= MAX_MS ? ms : 0;
  } catch {
    return 0;
  }
}

/** For the calibration screen (Stage 4). */
export function setInputLatencyMs(ms: number) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ms: Math.min(MAX_MS, Math.max(0, ms)), at: new Date().toISOString() }));
  } catch {
    /* storage unavailable: recordings are simply not corrected */
  }
}
