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
