import { useRef } from "react";
import { describe } from "../audio/mix";
import type { Mix, Player } from "../audio/player";
import type { Hand } from "../song/types";
import { HAND_COLORS } from "./colors";

const NAME: Record<Hand, string> = { L: "Left", R: "Right" };
const KEY: Record<Hand, string> = { L: "1", R: "2" };
const DOUBLE_TAP_MS = 320;

/** A volume slider and a mute button for each hand. */
export function HandMixer({ player, mix }: { player: Player; mix: Mix }) {
  return (
    <div className="hand-mix" role="group" aria-label="Hand volume">
      {(["L", "R"] as Hand[]).map((h) => (
        <HandRow key={h} hand={h} player={player} mix={mix} />
      ))}
    </div>
  );
}

function HandRow({ hand, player, mix }: { hand: Hand; player: Player; mix: Mix }) {
  const m = mix[hand];
  const percent = Math.round(m.volume * 100);
  const silent = m.muted || m.volume === 0;
  const name = NAME[hand];
  // Double-click or double-tap on the slider puts the hand back to full volume.
  const lastTap = useRef(0);
  const onTap = (e: React.PointerEvent) => {
    if (e.timeStamp - lastTap.current < DOUBLE_TAP_MS) {
      player.setVolume(hand, 1);
      lastTap.current = 0;
    } else lastTap.current = e.timeStamp;
  };
  return (
    <div
      className={`hand-row ${m.muted ? "is-muted" : ""}`}
      style={{ "--hand": HAND_COLORS[hand].fill, "--fill": m.volume } as React.CSSProperties}
    >
      <span className="hand-name">
        <span className="dot" aria-hidden />
        {name}
      </span>
      <button
        className="icon-btn mute-btn"
        aria-pressed={m.muted}
        aria-label={`Mute ${name.toLowerCase()} hand`}
        title={`${m.muted ? "Un-mute" : "Mute"} the ${name.toLowerCase()} hand (${KEY[hand]})`}
        onClick={() => player.toggleMute(hand)}
      >
        <SpeakerIcon off={silent} />
      </button>
      <input
        className="hand-slider"
        type="range"
        min={0}
        max={100}
        step={1}
        value={percent}
        aria-label={`${name} hand volume`}
        aria-valuetext={m.muted ? `Muted, ${percent} percent` : `${percent} percent`}
        title="Double-tap for 100%"
        onChange={(e) => player.setVolume(hand, Number(e.target.value) / 100)}
        onPointerUp={onTap}
      />
      <span className="hand-value mono">{describe(m)}</span>
    </div>
  );
}

function SpeakerIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
      <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" />
      {off ? (
        <path d="M15.5 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      ) : (
        <path
          d="M15.2 9.2a4 4 0 0 1 0 5.6M17.6 6.8a7.4 7.4 0 0 1 0 10.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
