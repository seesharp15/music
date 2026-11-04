import { useEffect, useRef, useState } from "react";
import type { Player } from "../audio/player";
import { momentIndexAt, positionOf, type Rhythm } from "../song/rhythm";
import type { Hand } from "../song/types";
import { noteName } from "./keyboard";

/** Previous / Next: move one moment at a time and play exactly what's pressed together. */
export function StepThrough({ player, rhythm }: { player: Player; rhythm: Rhythm }) {
  const [stepInfo, setStepInfo] = useState<string | null>(null);

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
    if (first > last) {
      setStepInfo("No notes in the selected stretch.");
      return;
    }
    // Next: first moment after now. Previous: last moment before now.
    let i = dir === 1 ? momentIndexAt(ms, t + 0.03) + 1 : momentIndexAt(ms, t - 0.03);
    if (repeating) {
      if (i > last || i < first) i = dir === 1 ? first : last;
    } else {
      i = Math.max(first, Math.min(last, i));
    }
    const m = ms[i];
    void player.strikeAt(m.time);
    const pos = positionOf(rhythm, m.time);
    const who = m.hands.size === 2 ? "Both hands" : m.hands.has("R") ? "Right hand" : "Left hand";
    const keys = (["L", "R"] as Hand[])
      .filter((h) => m.pitches[h].length)
      .map((h) => `${h === "L" ? "L" : "R"}: ${m.pitches[h].map(noteName).join(" ")}`)
      .join("   ");
    setStepInfo(`Bar ${pos.bar}, count ${pos.label} · ${who} · ${keys}`);
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
    <div className="control-group step-through">
      <span className="group-label">Step</span>
      <button className="chip" onClick={() => step(-1)} title="Previous moment (,)">
        ◀ Previous
      </button>
      <button className="chip" onClick={() => step(1)} title="Next moment (.)">
        Next ▶
      </button>
      {stepInfo && <span className="step-info mono">{stepInfo}</span>}
    </div>
  );
}
