import { useEffect, useRef, useSyncExternalStore } from "react";
import type { Player } from "../audio/player";
import { momentIndexAt, type Rhythm } from "../song/rhythm";
import type { Hand } from "../song/types";
import { HAND_COLORS } from "./colors";
import { noteName } from "./keyboard";

/** Previous / Next: move one moment at a time and play exactly what's pressed together. */
export function StepThrough({ player, rhythm }: { player: Player; rhythm: Rhythm }) {
  const step = (dir: 1 | -1) => {
    const ms = rhythm.moments;
    if (!ms.length) return;
    const t = player.currentTime();
    // Stay inside what's repeating (the loop, or the zoomed-in stretch),
    // wrapping round at either end; otherwise stop at the song's ends.
    const repeating = player.state.loop.enabled || player.state.window !== null;
    const r = player.range();
    const first = momentIndexAt(ms, r.start - 2e-6) + 1;
    const last = momentIndexAt(ms, r.end - 2e-6);
    if (first > last) return; // no notes in the selected stretch
    // Next: first moment after now. Previous: last moment before now.
    let i = dir === 1 ? momentIndexAt(ms, t + 0.03) + 1 : momentIndexAt(ms, t - 0.03);
    if (repeating) {
      if (i > last || i < first) i = dir === 1 ? first : last;
    } else {
      i = Math.max(first, Math.min(last, i));
    }
    const m = ms[i];
    void player.strikeAt(m.time);
  };

  // Keyboard: , and . step through moments.
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, select, textarea")) return;
      if (e.key === ",") stepRef.current(-1);
      else if (e.key === ".") stepRef.current(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="step-group" role="group" aria-label="Step">
      <span className="step-sep" aria-hidden />
      <span className="step-label">Step</span>
      <button className="icon-btn step" onClick={() => step(-1)} aria-label="Previous moment" title="Previous moment (,)">
        <StepArrow dir={-1} />
      </button>
      <button className="icon-btn step" onClick={() => step(1)} aria-label="Next moment" title="Next moment (.)">
        <StepArrow dir={1} />
      </button>
    </div>
  );
}

function StepArrow({ dir }: { dir: 1 | -1 }) {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden style={dir === 1 ? undefined : { transform: "scaleX(-1)" }}>
      <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The keys for the moment the playhead is paused on (after a step, or a tap
 * on the rhythm map). Bar, count and hands are already on the rhythm map, so
 * this only adds the note names.
 */
export function StepKeys({ player, rhythm }: { player: Player; rhythm: Rhythm }) {
  const t = useSyncExternalStore(player.subscribe, () => (player.state.playing ? -1 : player.currentTime()));
  const ms = rhythm.moments;
  const i = t < 0 ? -1 : momentIndexAt(ms, t + 0.03);
  const m = i >= 0 && t - ms[i].time < 0.03 ? ms[i] : null;
  return (
    <div className="step-keys mono" aria-live="polite">
      {m &&
        (["L", "R"] as Hand[])
          .filter((h) => m.pitches[h].length)
          .map((h) => (
            <span key={h}>
              <b style={{ color: HAND_COLORS[h].fill }}>{h}</b> {m.pitches[h].map(noteName).join(" ")}
            </span>
          ))}
    </div>
  );
}
