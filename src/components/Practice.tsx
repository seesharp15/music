import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Player, SOUNDS, playRange, type HandLevel, type SoundId } from "../audio/player";
import { analyzeRhythm } from "../song/rhythm";
import type { Hand, Song } from "../song/types";
import { useWakeLock } from "../useWakeLock";
import { HAND_COLORS } from "./colors";
import { Coach } from "./Coach";
import { Collapsible } from "./Collapsible";
import { RhythmMap } from "./RhythmMap";
import { Stage } from "./Stage";
import { StepKeys, StepThrough } from "./StepThrough";
import { Trimmer, formatTime } from "./Trimmer";

const SPEED_MIN = 0.05;
const SPEED_MAX = 2;
const SPEED_MARKS = [0.1, 0.5, 0.75, 1];
const SPEED_SNAP = 0.07; // within ~7% of a mark, the slider settles on it
const SPEED_STEPS = 1000; // slider resolution
const SPEED_LOG_SPAN = Math.log(SPEED_MAX / SPEED_MIN);
/** Slider position (0–1) for a speed. Logarithmic, so slow speeds get room and 100–200% stays short. */
const speedToPos = (r: number) => Math.log(r / SPEED_MIN) / SPEED_LOG_SPAN;
const posToSpeed = (p: number) => SPEED_MIN * Math.exp(p * SPEED_LOG_SPAN);
const NEXT_LEVEL: Record<HandLevel, HandLevel> = { on: "soft", soft: "off", off: "on" };
const LEVEL_LABEL: Record<HandLevel, string> = { on: "On", soft: "Soft", off: "Off" };

interface Prefs {
  sound: SoundId;
  stereo: boolean;
  syncLines: boolean;
}
const PREFS_KEY = "piano-tutor:prefs";
function loadPrefs(): Partial<Prefs> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable; preferences just won't persist */
  }
}

export function Practice({ song }: { song: Song }) {
  const [player, setPlayer] = useState<Player | null>(null);
  useEffect(() => {
    const p = new Player(song, loadPrefs());
    setPlayer(p);
    return () => p.dispose();
  }, [song]);
  if (!player) return null;
  return <PracticeView song={song} player={player} />;
}

function PracticeView({ song, player }: { song: Song; player: Player }) {
  const state = useSyncExternalStore(player.subscribe, player.getState);
  const { playing, stepping, rate, loop, levels, sound, piano, stereo, metronome } = state;
  const rhythm = useMemo(() => analyzeRhythm(song), [song]);
  const [syncLines, setSyncLines] = useState(() => loadPrefs().syncLines ?? true);
  const [clears, setClears] = useState(0); // bumped to zoom the timeline back out
  const [speedDrag, setSpeedDrag] = useState(false);
  useEffect(() => {
    if (!speedDrag) return;
    // The finger can leave the slider mid-drag, so listen for the release anywhere.
    const end = () => setSpeedDrag(false);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [speedDrag]);
  useWakeLock();

  /** Drop the loop and the zoom: back to the whole song. */
  const clearSelection = () => {
    player.setLoop({ enabled: false, start: 0, end: player.duration });
    setClears((n) => n + 1);
  };

  /** Play the whole song: loop off and zoomed out, keeping the loop range for next time. */
  const playWholeSong = () => {
    player.setLoop({ enabled: false });
    setClears((n) => n + 1);
  };

  /** Loop the remembered range, or with none, the section (or 4 bars) under the playhead. */
  const startLoop = () => {
    const l = player.state.loop;
    const d = player.duration;
    if (l.end - l.start < d - 0.5) {
      player.setLoop({ enabled: true });
      return;
    }
    const t = player.currentTime();
    const s = song.sections?.find((s) => t >= s.start && t < s.end);
    if (s) {
      player.setLoop({ enabled: true, start: s.start, end: s.end });
    } else {
      const bar = rhythm.beat * rhythm.perBar;
      const start = Math.floor(t / bar) * bar;
      player.setLoop({ enabled: true, start, end: Math.min(start + 4 * bar, d) });
    }
  };

  /** Anything repeating (a loop, or a zoomed-in stretch) counts as looping. */
  const toggleLoop = () =>
    player.state.loop.enabled || player.state.window ? playWholeSong() : startLoop();

  useEffect(() => savePrefs({ sound, stereo, syncLines }), [sound, stereo, syncLines]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, select, textarea")) return;
      if (e.code === "Space") {
        e.preventDefault();
        player.toggle();
      } else if (e.key === "l" || e.key === "L") {
        toggleLoop();
      } else if (e.key === "ArrowLeft") {
        player.skip(-1);
      } else if (e.key === "ArrowRight") {
        player.skip(1);
      } else if (e.key === "ArrowDown" || e.key === "-") {
        const r = player.state.rate;
        player.setRate(Math.max(SPEED_MIN, round2(r - (r > 0.25 + 1e-9 ? 0.05 : 0.01))));
      } else if (e.key === "ArrowUp" || e.key === "+" || e.key === "=") {
        const r = player.state.rate;
        player.setRate(Math.min(SPEED_MAX, round2(r + (r >= 0.25 - 1e-9 ? 0.05 : 0.01))));
      } else if (e.key === "Home" || e.key === "r") {
        player.restart();
      } else if (e.key === "Escape") {
        clearSelection();
      } else if (e.key === "m" || e.key === "M") {
        player.setMetronome(!player.state.metronome);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player]);

  const restart = () => player.restart();
  const repeating = loop.enabled || state.window ? playRange(loop, state.window, player.duration) : null;
  const skipSongSeconds = round2(5 * rate);
  const soundNote =
    sound === "piano" && piano === "loading"
      ? "Loading grand piano… playing Clear until it's ready"
      : sound === "piano" && piano === "failed"
        ? "Grand piano samples couldn't load here, so Clear is playing instead"
        : null;

  return (
    <main className="practice">
      <div className="song-heading">
        <h1>{song.title}</h1>
        <p>
          {[song.artist, song.arranger && `arr. ${song.arranger}`, song.bpm && `${song.bpm} BPM`]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      <div className="controls">
        <div className="control-group">
          <label className="group-label" htmlFor="sound">
            Sound
          </label>
          <select id="sound" className="select" value={sound} onChange={(e) => player.setSound(e.target.value as SoundId)}>
            {SOUNDS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
                {s.id === "piano" && piano === "failed" ? " (unavailable)" : ""}
              </option>
            ))}
          </select>
          <button
            className={`chip ${stereo ? "is-on" : ""}`}
            onClick={() => player.setStereo(!stereo)}
            aria-pressed={stereo}
            title="Left hand in your left ear, right hand in your right"
          >
            Stereo split
          </button>
          <button
            className={`chip ${metronome ? "is-on" : ""}`}
            onClick={() => player.setMetronome(!metronome)}
            aria-pressed={metronome}
            title="Click on every beat, accent on beat 1 (M)"
          >
            Metronome
          </button>
        </div>
      </div>

      <RhythmMap player={player} rhythm={rhythm} levels={levels} duration={player.duration} />
      <StepKeys player={player} rhythm={rhythm} />

      <div className="stage-wrap">
        <Stage song={song} player={player} levels={levels} rhythm={rhythm} syncLines={syncLines} />
        {soundNote && <div className="stage-note">{soundNote}</div>}
      </div>

      <Collapsible
        id="controls"
        title="Controls"
        summary={`${repeating ? `Looping ${formatTime(repeating.start)} – ${formatTime(repeating.end)}` : "Whole song"} · ${Math.round(rate * 100)}%`}
      >
        <div className="segmented" role="group" aria-label="What plays">
          <button
            className={!repeating ? "is-on" : ""}
            aria-pressed={!repeating}
            onClick={() => repeating && playWholeSong()}
            title="Play the whole song (L)"
          >
            Whole song
          </button>
          <button
            className={repeating ? "is-on loop-on" : ""}
            aria-pressed={!!repeating}
            onClick={() => !repeating && startLoop()}
            title="Loop a passage (L)"
          >
            ⟲ Loop
          </button>
        </div>

        <Trimmer song={song} player={player} loop={loop} clears={clears} />

        <div className="controls">
          <div className="control-group transport">
            <button className="icon-btn" onClick={restart} aria-label="Back to start" title="Back to start (R)">
              <svg viewBox="0 0 24 24" width="31" height="31" aria-hidden>
                <path d="M6 5h2v14H6zM20 5v14L9 12z" fill="currentColor" />
              </svg>
            </button>
            <button
              className="icon-btn skip"
              onClick={() => player.skip(-1)}
              aria-label={`Back ${skipSongSeconds} seconds`}
              title={`Back 5 s of listening (${skipSongSeconds} s of song at ${Math.round(rate * 100)}%) (←)`}
            >
              <SkipIcon dir={-1} />
            </button>
            <button
              className="play-btn"
              onClick={() => player.toggle()}
              aria-label={playing ? "Pause" : stepping ? "Resume from this step" : "Play"}
              title="Play / pause (Space)"
            >
              {/* While stepping it shows pause (we're paused on a step); tapping resumes from there. */}
              {playing || stepping ? (
                <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden>
                  <path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden>
                  <path d="M8 5v14l11-7z" fill="currentColor" />
                </svg>
              )}
            </button>
            <button
              className="icon-btn skip"
              onClick={() => player.skip(1)}
              aria-label={`Forward ${skipSongSeconds} seconds`}
              title={`Forward 5 s of listening (${skipSongSeconds} s of song at ${Math.round(rate * 100)}%) (→)`}
            >
              <SkipIcon dir={1} />
            </button>
            <StepThrough player={player} rhythm={rhythm} />
          </div>

        </div>

        <div className="controls">
          <div className="control-group speed">
            <label htmlFor="speed">Speed</label>
            <div
              className={`speed-slider ${speedDrag ? "is-dragging" : ""}`}
              style={{ "--fill": speedToPos(rate) } as React.CSSProperties}
            >
              {SPEED_MARKS.map((m) => (
                <span
                  key={m}
                  className={`speed-mark ${rate === m ? "is-on" : ""}`}
                  style={{ "--at": speedToPos(m) } as React.CSSProperties}
                  aria-hidden
                >
                  <span>{Math.round(m * 100)}</span>
                </span>
              ))}
              <input
                id="speed"
                type="range"
                min={0}
                max={SPEED_STEPS}
                step={1}
                value={Math.round(speedToPos(rate) * SPEED_STEPS)}
                aria-valuetext={`${Math.round(rate * 100)}%`}
                onPointerDown={() => setSpeedDrag(true)}
                onChange={(e) => player.setRate(snapRate(posToSpeed(Number(e.target.value) / SPEED_STEPS)))}
              />
              {/* The visible thumb (the native one is transparent) and, while dragging, a readout above the finger. */}
              <span className="speed-thumb mono" aria-hidden>
                {Math.round(rate * 100)}%
              </span>
              <span className="speed-blip mono" aria-hidden>
                {Math.round(rate * 100)}%
              </span>
            </div>
          </div>
        </div>
      </Collapsible>

      <Collapsible
        id="hands"
        title="Hands"
        summary={`Left ${LEVEL_LABEL[levels.L]} · Right ${LEVEL_LABEL[levels.R]}`}
      >
        <div className="control-group">
          {(["L", "R"] as Hand[]).map((h) => (
            <button
              key={h}
              className={`chip hand lvl-${levels[h]}`}
              style={{ "--hand": HAND_COLORS[h].fill } as React.CSSProperties}
              onClick={() => player.setLevel(h, NEXT_LEVEL[levels[h]])}
              title={`${h === "L" ? "Left" : "Right"} hand: ${LEVEL_LABEL[levels[h]]}. Tap for ${LEVEL_LABEL[NEXT_LEVEL[levels[h]]]}.`}
            >
              <span className="dot" />
              {h === "L" ? "Left" : "Right"}
              <span className="lvl mono">{LEVEL_LABEL[levels[h]]}</span>
            </button>
          ))}
        </div>


        <Coach player={player} rhythm={rhythm} loop={loop} syncLines={syncLines} onSyncLines={setSyncLines} />

        <p className="hint">
          Space play/pause · ←/→ skip 5s of listening · ↑/↓ speed · , / . step · L loop · Esc clear loop · M metronome · R restart
        </p>
      </Collapsible>
    </main>
  );
}

function SkipIcon({ dir }: { dir: 1 | -1 }) {
  return (
    <svg viewBox="0 0 24 24" width="35" height="35" aria-hidden style={dir === 1 ? { transform: "scaleX(-1)" } : undefined}>
      <path
        d="M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"
        fill="currentColor"
      />
      <text
        x="12"
        y="16.2"
        textAnchor="middle"
        fontSize="7.5"
        fontWeight="700"
        fill="currentColor"
        fontFamily="system-ui, sans-serif"
        style={dir === 1 ? { transform: "scaleX(-1)", transformOrigin: "12px 12px" } : undefined}
      >
        5
      </text>
    </svg>
  );
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Settle on 50/75/100% when close, but leave every other value reachable. */
const snapRate = (r: number) => SPEED_MARKS.find((m) => Math.abs(Math.log(r / m)) <= SPEED_SNAP) ?? round2(r);
