import { fromLevels, sanitizeMix, type Mix } from "./audio/mix";
import type { LoopRange, Player, TimeRange } from "./audio/player";
import { noteRecent, recentFor } from "./library/recent";

/**
 * Where you were in a song, kept for this tab, so a reload (the phone
 * dropping the page, or the dev server reconnecting) picks up right there.
 */
interface Session {
  time: number;
  rate: number;
  loop: LoopRange;
  window: TimeRange | null;
  mix: Mix;
}

/** The hands' volumes from a saved session, including sessions saved when hands were On / Soft / Off. */
export function mixOf(saved: { mix?: unknown; levels?: unknown }): Mix | null {
  const mix = sanitizeMix(saved.mix);
  if (mix) return mix;
  return saved.levels && typeof saved.levels === "object" ? fromLevels(saved.levels) : null;
}

const KEY = "piano-tutor:session:";
const HEARD_SECONDS = 1;

/** Put a fresh player back where this tab last left the song. */
export function restoreSession(player: Player, songId: string) {
  let s: Partial<Session> & { levels?: unknown };
  try {
    s = JSON.parse(sessionStorage.getItem(KEY + songId) ?? "{}");
  } catch {
    return;
  }
  // A new tab has no session, but the Library may remember where this song was left.
  if (typeof s.time !== "number") {
    const left = recentFor(songId)?.time;
    if (typeof left === "number" && left < player.duration - 1) s.time = left;
  }
  if (typeof s.rate === "number") player.setRate(s.rate);
  const mix = mixOf(s);
  if (mix) player.setMix(mix);
  if (s.loop) player.setLoop(s.loop);
  if (s.window) player.setWindow(s.window);
  if (typeof s.time === "number") player.seek(s.time);
}

export function saveSession(player: Player, songId: string) {
  const { rate, loop, window, mix } = player.state;
  const s: Session = { time: player.currentTime(), rate, loop, window, mix };
  try {
    sessionStorage.setItem(KEY + songId, JSON.stringify(s));
  } catch {
    /* storage unavailable; a reload just starts over */
  }
  // Once some of the song has gone by, it belongs in the Library's "Continue" row.
  if (s.time >= HEARD_SECONDS) noteRecent({ id: songId, time: s.time, duration: player.duration });
}
