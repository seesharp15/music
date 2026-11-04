import type { HandLevel, LoopRange, Player, TimeRange } from "./audio/player";
import type { Hand } from "./song/types";

/**
 * Where you were in a song, kept for this tab, so a reload (the phone
 * dropping the page, or the dev server reconnecting) picks up right there.
 */
interface Session {
  time: number;
  rate: number;
  loop: LoopRange;
  window: TimeRange | null;
  levels: Record<Hand, HandLevel>;
}

const KEY = "piano-tutor:session:";

/** Put a fresh player back where this tab last left the song. */
export function restoreSession(player: Player, songId: string) {
  let s: Partial<Session>;
  try {
    s = JSON.parse(sessionStorage.getItem(KEY + songId) ?? "{}");
  } catch {
    return;
  }
  if (typeof s.rate === "number") player.setRate(s.rate);
  if (s.levels) player.setLevels(s.levels);
  if (s.loop) player.setLoop(s.loop);
  if (s.window) player.setWindow(s.window);
  if (typeof s.time === "number") player.seek(s.time);
}

export function saveSession(player: Player, songId: string) {
  const { rate, loop, window, levels } = player.state;
  const s: Session = { time: player.currentTime(), rate, loop, window, levels };
  try {
    sessionStorage.setItem(KEY + songId, JSON.stringify(s));
  } catch {
    /* storage unavailable; a reload just starts over */
  }
}
