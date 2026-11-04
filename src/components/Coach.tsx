import { useEffect, useRef, useState } from "react";
import type { HandLevel, LoopRange, Player } from "../audio/player";
import { momentIndexAt, positionOf, type Rhythm } from "../song/rhythm";
import type { Hand } from "../song/types";
import { noteName } from "./keyboard";

interface Stage {
  label: string;
  levels: Record<Hand, HandLevel>;
  rate: number;
}

const STAGES: Stage[] = [
  { label: "Right hand", levels: { L: "off", R: "on" }, rate: 0.75 },
  { label: "Left hand", levels: { L: "on", R: "off" }, rate: 0.75 },
  { label: "Together 60%", levels: { L: "on", R: "on" }, rate: 0.6 },
  { label: "Together 80%", levels: { L: "on", R: "on" }, rate: 0.8 },
  { label: "Together 100%", levels: { L: "on", R: "on" }, rate: 1 },
];
const PASSES_PER_STAGE = 2;

interface Props {
  player: Player;
  rhythm: Rhythm;
  loop: LoopRange;
  syncLines: boolean;
  onSyncLines: (on: boolean) => void;
}

/** Tools for fitting the two hands together. */
export function Coach({ player, rhythm, loop, syncLines, onSyncLines }: Props) {
  const [routine, setRoutine] = useState<{ stage: number; pass: number } | "done" | null>(null);
  const routineRef = useRef(routine);
  routineRef.current = routine;
  const [stepInfo, setStepInfo] = useState<string | null>(null);

  // Advance the routine each time the loop comes around.
  useEffect(
    () =>
      player.onLoopWrap(() => {
        const r = routineRef.current;
        if (!r || r === "done") return;
        let { stage, pass } = r;
        pass += 1;
        if (pass >= PASSES_PER_STAGE) {
          stage += 1;
          pass = 0;
        }
        if (stage >= STAGES.length) {
          player.setLevels({ L: "on", R: "on" });
          setRoutine("done");
          return;
        }
        if (stage !== r.stage) applyStage(player, STAGES[stage]);
        setRoutine({ stage, pass });
      }),
    [player],
  );

  const startRoutine = (stage = 0) => {
    if (!player.state.loop.enabled) {
      // Default to the two bars around the playhead.
      const barLen = rhythm.beat * rhythm.perBar;
      const start = Math.floor(player.currentTime() / barLen) * barLen;
      player.setLoop({ enabled: true, start, end: Math.min(start + 2 * barLen, player.duration) });
    }
    applyStage(player, STAGES[stage]);
    setRoutine({ stage, pass: 0 });
    player.seek(player.state.loop.start);
    void player.play();
  };

  const stopRoutine = () => {
    setRoutine(null);
    player.setLevels({ L: "on", R: "on" });
  };

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

  const active = routine && routine !== "done" ? routine : null;

  return (
    <section className="coach" aria-labelledby="coach-title">
      <div className="coach-head">
        <h2 id="coach-title">Hands together</h2>
        <label className="switch">
          <input type="checkbox" checked={syncLines} onChange={(e) => onSyncLines(e.target.checked)} />
          <span>Show sync lines</span>
        </label>
      </div>

      <div className="coach-block">
        <div className="coach-label">Step through</div>
        <div className="coach-row">
          <button className="chip" onClick={() => step(-1)} title="Previous moment (,)">
            ◀ Previous
          </button>
          <button className="chip" onClick={() => step(1)} title="Next moment (.)">
            Next ▶
          </button>
          <span className="step-info mono">
            {stepInfo ?? "Moves one moment at a time and plays exactly what is pressed together."}
          </span>
        </div>
      </div>

      <div className="coach-block">
        <div className="coach-label">
          Practice routine
          <span className="coach-sub">
            {" "}
            · {loop.enabled ? "uses your loop" : "loops the 2 bars at the playhead"} · {PASSES_PER_STAGE} passes per
            step
          </span>
        </div>
        <ol className="routine">
          {STAGES.map((s, i) => {
            const state = routine === "done" ? "done" : active ? (i < active.stage ? "done" : i === active.stage ? "now" : "") : "";
            return (
              <li key={s.label}>
                <button className={`routine-step ${state ? `is-${state}` : ""}`} onClick={() => startRoutine(i)}>
                  <span className="routine-num mono">{i + 1}</span>
                  {s.label}
                  {state === "now" && active && (
                    <span className="routine-pass mono">
                      pass {active.pass + 1}/{PASSES_PER_STAGE}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
        <div className="coach-row">
          {active ? (
            <button className="chip is-on loop-on" onClick={stopRoutine}>
              ■ Stop routine
            </button>
          ) : (
            <button className="chip is-on loop-on" onClick={() => startRoutine(0)}>
              ▶ {routine === "done" ? "Run again" : "Start routine"}
            </button>
          )}
          {routine === "done" && <span className="step-info">Done. Try a longer loop or the next section.</span>}
        </div>
      </div>
    </section>
  );
}

function applyStage(player: Player, s: Stage) {
  player.setLevels(s.levels);
  player.setRate(s.rate);
}
