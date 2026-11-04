import { useEffect, useRef } from "react";
import type { LoopRange, Player } from "../audio/player";
import type { Song } from "../song/types";
import { HAND_COLORS } from "./colors";

interface Props {
  song: Song;
  player: Player;
  loop: LoopRange;
}

type Drag = "start" | "end" | "seek" | null;

const MIN_LOOP = 0.25;

/**
 * iPhone-clipper-style timeline: a miniature of the whole song with a yellow
 * frame whose handles set the loop range. Tap or drag elsewhere to seek.
 */
export function Trimmer({ song, player, loop }: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const drag = useRef<Drag>(null);
  const duration = player.duration || 1;

  // Song overview (mini piano roll).
  useEffect(() => {
    const canvas = canvasRef.current!;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#1b1e25";
      ctx.fillRect(0, 0, w, h);
      if (!song.notes.length) return;
      const pitches = song.notes.map((n) => n.pitch);
      const lo = Math.min(...pitches) - 1;
      const hi = Math.max(...pitches) + 1;
      const rowH = (h - 8) / (hi - lo);
      for (const n of song.notes) {
        ctx.fillStyle = HAND_COLORS[n.hand].fill;
        const x = (n.time / duration) * w;
        const nw = Math.max(1.5, (n.duration / duration) * w);
        const y = 4 + (hi - n.pitch) * rowH;
        ctx.fillRect(x, y, nw, Math.max(1.5, rowH));
      }
      // Section dividers.
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      for (const s of song.sections ?? []) {
        if (s.start > 0) ctx.fillRect((s.start / duration) * w, 0, 1, h);
      }
    };
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [song, duration]);

  // Playhead follows playback without re-rendering React.
  useEffect(() => {
    let raf = 0;
    const loopFn = () => {
      raf = requestAnimationFrame(loopFn);
      const t = player.currentTime();
      if (playheadRef.current) playheadRef.current.style.left = `${(t / duration) * 100}%`;
      if (timeRef.current) timeRef.current.textContent = formatTime(t);
    };
    raf = requestAnimationFrame(loopFn);
    return () => cancelAnimationFrame(raf);
  }, [player, duration]);

  const timeAt = (clientX: number) => {
    const r = stripRef.current!.getBoundingClientRect();
    return Math.min(Math.max((clientX - r.left) / r.width, 0), 1) * duration;
  };

  const apply = (clientX: number) => {
    const t = timeAt(clientX);
    const { loop: l } = player.state;
    if (drag.current === "start") {
      player.setLoop({ enabled: true, start: Math.min(t, l.end - MIN_LOOP) });
      player.seek(player.state.loop.start);
    } else if (drag.current === "end") {
      player.setLoop({ enabled: true, end: Math.max(t, l.start + MIN_LOOP) });
    } else if (drag.current === "seek") {
      player.seek(l.enabled ? Math.min(Math.max(t, l.start), l.end - 0.01) : t);
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    drag.current = (target.closest("[data-handle]")?.getAttribute("data-handle") as Drag) ?? "seek";
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    apply(e.clientX);
    e.preventDefault();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (drag.current) apply(e.clientX);
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const left = (loop.start / duration) * 100;
  const right = 100 - (loop.end / duration) * 100;

  return (
    <div className="trimmer">
      <div
        ref={stripRef}
        className={`trimmer-strip ${loop.enabled ? "is-looping" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="slider"
        aria-label="Song position and loop range"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
      >
        <canvas ref={canvasRef} className="trimmer-canvas" />
        <div className="trimmer-dim" style={{ left: 0, width: `${left}%` }} />
        <div className="trimmer-dim" style={{ right: 0, width: `${right}%` }} />
        <div className="trimmer-frame" style={{ left: `${left}%`, right: `${right}%` }}>
          <div className="trimmer-handle is-start" data-handle="start" aria-label="Loop start">
            <span />
          </div>
          <div className="trimmer-handle is-end" data-handle="end" aria-label="Loop end">
            <span />
          </div>
        </div>
        <div ref={playheadRef} className="trimmer-playhead" />
      </div>
      <div className="trimmer-labels">
        <span ref={timeRef} className="mono">0:00.0</span>
        <span className="trimmer-range mono">
          {loop.enabled ? `Loop ${formatTime(loop.start)} – ${formatTime(loop.end)}` : "Drag the yellow handles to loop a passage"}
        </span>
        <span className="mono">{formatTime(duration)}</span>
      </div>
    </div>
  );
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}
