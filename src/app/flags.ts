import { useMemo } from "react";

/**
 * Feature flags let unfinished stages merge without showing (docs/plan/contracts.md §11).
 * A flag is on when it is listed in localStorage under `piano-tutor:flags` (comma-separated)
 * or in the page's query string as `?flags=a,b`.
 */
export type FlagName =
  | "studio"
  | "drums"
  | "assist"
  | "assist-ai"
  | "hum"
  | "import"
  | "import-youtube"
  /** Exposes `window.__app` in a production build, for end-to-end tests. */
  | "test-hooks";

const KEY = "piano-tutor:flags";

const split = (s: string | null | undefined) =>
  (s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

function active(): Set<string> {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch {
    /* storage unavailable: only the query string counts */
  }
  return new Set([...split(stored), ...split(new URLSearchParams(window.location.search).get("flags"))]);
}

export function flag(name: FlagName): boolean {
  return active().has(name);
}

/** The flag's value when the component mounted; flags change by reload, not live. */
export function useFlag(name: FlagName): boolean {
  return useMemo(() => flag(name), [name]);
}

/** Whether a flag is among those kept on this device (not counting the address). */
export function storedFlag(name: FlagName): boolean {
  try {
    return split(localStorage.getItem(KEY)).includes(name);
  } catch {
    return false;
  }
}

/**
 * Keep a flag on (or take it off) on this device, as listing it in `piano-tutor:flags` by hand
 * would. Flags are read when the page loads, so the caller reloads. False if it could not be kept.
 */
export function setStoredFlag(name: FlagName, on: boolean): boolean {
  try {
    const rest = split(localStorage.getItem(KEY)).filter((f) => f !== name);
    const next = on ? [...rest, name] : rest;
    if (next.length) localStorage.setItem(KEY, next.join(","));
    else localStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}
