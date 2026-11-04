import { useEffect, useMemo, useRef, useState } from "react";
import type { HandLevel, Player } from "../audio/player";
import { countLabel, type Rhythm } from "../song/rhythm";
import type { Hand } from "../song/types";

interface Props {
  player: Player;
  rhythm: Rhythm;
  levels: Record<Hand, HandLevel>;
  duration: number;
}

const BARS_SHOWN = 2;

interface Cell {
  time: number;
  hands: Set<Hand>;
  momentTime: number | null;
}

/**
 * The combined rhythm of both hands for the current and next bar: one lane
 * per hand on a shared count ("1 & 2 & …"). Columns where both hands strike
 * together are marked as sync points.
 */
export function RhythmMap({ player, rhythm, levels, duration }: Props) {
  const barLen = rhythm.beat * rhythm.perBar;
  const cellsPerBar = rhythm.perBar * rhythm.sub;
  const lastBar = Math.max(0, Math.floor(duration / barLen));
  const [bar, setBar] = useState(0); // zero-based first bar shown
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Group moments into grid cells for fast lookup.
  const byCell = useMemo(() => {
    const map = new Map<number, { hands: Set<Hand>; time: number }>();
    for (const m of rhythm.moments) {
      const idx = Math.round(m.time / rhythm.cell);
      const c = map.get(idx);
      if (c) m.hands.forEach((h) => c.hands.add(h));
      else map.set(idx, { hands: new Set(m.hands), time: m.time });
    }
    return map;
  }, [rhythm]);

  const cells: Cell[] = [];
  for (let i = 0; i < cellsPerBar * BARS_SHOWN; i++) {
    const idx = bar * cellsPerBar + i;
    const c = byCell.get(idx);
    cells.push({ time: idx * rhythm.cell, hands: c?.hands ?? new Set(), momentTime: c?.time ?? null });
  }

  // Follow playback: page to the bar under the playhead, highlight the cell.
  useEffect(() => {
    let raf = 0;
    let active = -1;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const t = player.currentTime();
      const b = Math.min(lastBar, Math.max(0, Math.floor((t + 1e-3) / barLen)));
      setBar(b);
      const idx = Math.floor((t + 1e-3) / rhythm.cell) - bar * cellsPerBar;
      if (idx !== active) {
        cellRefs.current[active]?.classList.remove("is-now");
        cellRefs.current[idx]?.classList.add("is-now");
        active = idx;
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      cellRefs.current[active]?.classList.remove("is-now");
    };
  }, [player, rhythm, bar, barLen, cellsPerBar, lastBar]);

  return (
    <div className="rhythm" aria-label="Rhythm map: which hand plays on each count">
      <div className="rhythm-lanes" aria-hidden>
        <span className="lane-name r">R</span>
        <span className="lane-name l">L</span>
        <span className="lane-name count">Count</span>
      </div>
      <div className="rhythm-bars" style={{ "--cells": cellsPerBar } as React.CSSProperties}>
        {Array.from({ length: BARS_SHOWN }, (_, b) => (
          <div key={b} className="rhythm-bar">
            <div className="rhythm-bar-num mono">Bar {bar + b + 1}</div>
            <div className="rhythm-cells">
              {cells.slice(b * cellsPerBar, (b + 1) * cellsPerBar).map((c, i) => {
                const both = c.hands.size === 2;
                const onBeat = i % rhythm.sub === 0;
                const ci = b * cellsPerBar + i;
                return (
                  <button
                    key={ci}
                    ref={(el) => {
                      cellRefs.current[ci] = el;
                    }}
                    className={`rhythm-cell ${both ? "is-sync" : ""} ${onBeat ? "on-beat" : ""}`}
                    onClick={() =>
                      c.momentTime != null ? void player.strikeAt(c.momentTime) : player.seek(c.time)
                    }
                    title={describe(c)}
                    aria-label={`Bar ${bar + b + 1}, count ${countLabel(rhythm, i)}: ${describe(c)}`}
                  >
                    <span className={`dot r ${c.hands.has("R") ? "is-hit" : ""} lvl-${levels.R}`} />
                    <span className={`dot l ${c.hands.has("L") ? "is-hit" : ""} lvl-${levels.L}`} />
                    <span className="count mono">{countLabel(rhythm, i)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function describe(c: Cell): string {
  if (c.hands.size === 2) return "both hands together";
  if (c.hands.has("R")) return "right hand";
  if (c.hands.has("L")) return "left hand";
  return "rest";
}
