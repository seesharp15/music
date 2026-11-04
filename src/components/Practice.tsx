import { useEffect, useState, useSyncExternalStore } from "react";
import { Player } from "../audio/player";
import type { Hand, Song } from "../song/types";
import { HAND_COLORS } from "./colors";
import { Stage } from "./Stage";
import { Trimmer, formatTime } from "./Trimmer";

const SPEED_PRESETS = [0.5, 0.75, 1];

export function Practice({ song }: { song: Song }) {
  const [player, setPlayer] = useState<Player | null>(null);
  useEffect(() => {
    const p = new Player(song);
    setPlayer(p);
    return () => p.dispose();
  }, [song]);
  if (!player) return null;
  return <PracticeView song={song} player={player} />;
}

function PracticeView({ song, player }: { song: Song; player: Player }) {
  const state = useSyncExternalStore(player.subscribe, player.getState);
  const { playing, rate, loop, muted, instrument } = state;

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
        player.seek(player.currentTime() - 2);
      } else if (e.key === "ArrowRight") {
        player.seek(player.currentTime() + 2);
      } else if (e.key === "ArrowDown" || e.key === "-") {
        player.setRate(Math.max(0.25, round2(player.state.rate - 0.05)));
      } else if (e.key === "ArrowUp" || e.key === "+" || e.key === "=") {
        player.setRate(Math.min(1.5, round2(player.state.rate + 0.05)));
      } else if (e.key === "Home" || e.key === "r") {
        player.seek(player.state.loop.enabled ? player.state.loop.start : 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player]);

  const restart = () => player.seek(loop.enabled ? loop.start : 0);

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
        <Stage song={song} player={player} muted={muted} />
        {instrument !== "piano" && (
          <div className="stage-note">
            {instrument === "loading" ? "Loading piano sound…" : "Piano sound unavailable — using a basic synth"}
          </div>
        )}
      </div>

      <Trimmer song={song} player={player} loop={loop} />

      <div className="controls">
        <div className="control-group">
          <button className="icon-btn" onClick={restart} aria-label="Back to start" title="Back to start (R)">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
              <path d="M6 5h2v14H6zM20 5v14L9 12z" fill="currentColor" />
            </svg>
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

        <div className="control-group">
          <span className="group-label">Hands</span>
          {(["L", "R"] as Hand[]).map((h) => (
            <button
              key={h}
              className={`chip hand ${muted[h] ? "" : "is-on"}`}
              style={{ "--hand": HAND_COLORS[h].fill } as React.CSSProperties}
              onClick={() => player.setMuted(h, !muted[h])}
              aria-pressed={!muted[h]}
              title={`${muted[h] ? "Unmute" : "Mute"} ${h === "L" ? "left" : "right"} hand`}
            >
              <span className="dot" />
              {h === "L" ? "Left" : "Right"}
            </button>
          ))}
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

      <p className="hint">
        Space play/pause · ←/→ skip 2s · ↑/↓ speed · L loop · R restart
      </p>
    </main>
  );
}

const round2 = (x: number) => Math.round(x * 100) / 100;
