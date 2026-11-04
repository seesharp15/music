import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Player, SOUNDS, type HandLevel, type SoundId } from "../audio/player";
import { analyzeRhythm } from "../song/rhythm";
import type { Hand, Song } from "../song/types";
import { HAND_COLORS } from "./colors";
import { Coach } from "./Coach";
import { RhythmMap } from "./RhythmMap";
import { Stage } from "./Stage";
import { Trimmer, formatTime } from "./Trimmer";

const SPEED_PRESETS = [0.5, 0.75, 1];
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
  const { playing, rate, loop, levels, sound, piano, stereo, metronome } = state;
  const rhythm = useMemo(() => analyzeRhythm(song), [song]);
  const [syncLines, setSyncLines] = useState(() => loadPrefs().syncLines ?? true);

  useEffect(() => savePrefs({ sound, stereo, syncLines }), [sound, stereo, syncLines]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, select, textarea")) return;
      if (e.code === "Space") {
        e.preventDefault();
        player.toggle();
      } else if (e.key === "l" || e.key === "L") {
        player.setLoop({ enabled: !player.state.loop.enabled });
      } else if (e.key === "ArrowLeft") {
        player.skip(-1);
      } else if (e.key === "ArrowRight") {
        player.skip(1);
      } else if (e.key === "ArrowDown" || e.key === "-") {
        player.setRate(Math.max(0.25, round2(player.state.rate - 0.05)));
      } else if (e.key === "ArrowUp" || e.key === "+" || e.key === "=") {
        player.setRate(Math.min(1.5, round2(player.state.rate + 0.05)));
      } else if (e.key === "Home" || e.key === "r") {
        player.seek(player.state.loop.enabled ? player.state.loop.start : 0);
      } else if (e.key === "m" || e.key === "M") {
        player.setMetronome(!player.state.metronome);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player]);

  const restart = () => player.seek(loop.enabled ? loop.start : 0);
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

      <div className="stage-wrap">
        <Stage song={song} player={player} levels={levels} rhythm={rhythm} syncLines={syncLines} />
        {soundNote && <div className="stage-note">{soundNote}</div>}
      </div>

      <RhythmMap player={player} rhythm={rhythm} levels={levels} duration={player.duration} />

      <Trimmer song={song} player={player} loop={loop} />

      <div className="controls">
        <div className="control-group transport">
          <button className="icon-btn" onClick={restart} aria-label="Back to start" title="Back to start (R)">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
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
            aria-label={playing ? "Pause" : "Play"}
            title="Play / pause (Space)"
          >
            {playing ? (
              <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
                <path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
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
          <button
            className={`chip ${loop.enabled ? "is-on loop-on" : ""}`}
            onClick={() => player.setLoop({ enabled: !loop.enabled })}
            title="Toggle loop (L)"
            aria-pressed={loop.enabled}
          >
            ⟲ Loop
          </button>
        </div>

        <div className="control-group speed">
          <label htmlFor="speed">Speed</label>
          <input
            id="speed"
            type="range"
            min={0.25}
            max={1.5}
            step={0.05}
            value={rate}
            onChange={(e) => player.setRate(Number(e.target.value))}
          />
          <span className="mono speed-value">{Math.round(rate * 100)}%</span>
          {SPEED_PRESETS.map((s) => (
            <button key={s} className={`chip small ${rate === s ? "is-on" : ""}`} onClick={() => player.setRate(s)}>
              {Math.round(s * 100)}%
            </button>
          ))}
        </div>
      </div>

      <div className="controls">
        <div className="control-group">
          <span className="group-label">Hands</span>
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

      {song.sections && song.sections.length > 0 && (
        <div className="sections">
          <span className="group-label">Sections</span>
          {song.sections.map((s) => {
            const active = loop.enabled && loop.start === s.start && loop.end === s.end;
            return (
              <button
                key={s.name + s.start}
                className={`chip ${active ? "is-on loop-on" : ""}`}
                onClick={() => player.setLoop({ enabled: true, start: s.start, end: s.end })}
                title={`Loop ${formatTime(s.start)} – ${formatTime(s.end)}`}
              >
                {s.name}
              </button>
            );
          })}
        </div>
      )}

      <Coach player={player} rhythm={rhythm} loop={loop} syncLines={syncLines} onSyncLines={setSyncLines} />

      <p className="hint">
        Space play/pause · ←/→ skip 5s of listening · ↑/↓ speed · , / . step · L loop · M metronome · R restart
      </p>
    </main>
  );
}

function SkipIcon({ dir }: { dir: 1 | -1 }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden style={dir === 1 ? { transform: "scaleX(-1)" } : undefined}>
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
