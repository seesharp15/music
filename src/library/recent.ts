/** What was played lately, newest first: the Library's "Continue" row. */
export interface Recent {
  id: string;
  /** When it was last played, ISO. */
  at: string;
  /** Where the playhead was left, seconds. */
  time: number;
  duration: number;
}

const KEY = "piano-tutor:recent";
const MAX = 12;

export function readRecent(): Recent[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((r) => r && typeof r.id === "string" && typeof r.time === "number") : [];
  } catch {
    return [];
  }
}

/** Remember where a song was left. Moves it to the front. */
export function noteRecent(entry: Omit<Recent, "at">, now = new Date()) {
  const rest = readRecent().filter((r) => r.id !== entry.id);
  try {
    localStorage.setItem(KEY, JSON.stringify([{ ...entry, at: now.toISOString() }, ...rest].slice(0, MAX)));
  } catch {
    /* storage unavailable; Continue just stays empty */
  }
}

export function recentFor(id: string): Recent | undefined {
  return readRecent().find((r) => r.id === id);
}
