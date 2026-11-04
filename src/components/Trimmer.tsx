import { useEffect, useRef, useState } from "react";
import type { LoopRange, Player } from "../audio/player";
import type { Song } from "../song/types";
import { HAND_COLORS } from "./colors";

interface Props {
  song: Song;
  player: Player;
  loop: LoopRange;
}

type Drag = "start" | "end" | "seek";

interface View {
  start: number;
  end: number;
}

const MIN_LOOP = 0.25;
const HOLD_MS = 350; // hold still this long while dragging to zoom in
const HOLD_SLOP_PX = 6; // movement allowed while "holding still"
const ZOOM_STEP = 4; // each hold zooms in this much
const MIN_SPAN = 2; // seconds visible at maximum zoom
const EDGE_PX = 28; // drag this close to an edge to scroll when zoomed
const PAN_SPEED = 1.5; // view widths per second at the very edge
const TWEEN_MS = 220;

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/**
 * iPhone-clipper-style timeline: a miniature of the song with a yellow frame
 * whose handles set the loop range. Tap or drag elsewhere to seek. Holding a
 * drag still zooms in around the finger for finer control; releasing zooms out.
 */
export function Trimmer({ song, player, loop }: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const duration = player.duration || 1;
  const full: View = { start: 0, end: duration };

  const [view, setViewState] = useState<View>(full);
  const viewRef = useRef<View>(full);
  const setView = (v: View) => {
    viewRef.current = v;
    setViewState(v);
  };

  const drag = useRef<{
    kind: Drag;
    x: number;
    anchorX: number;
    holdTimer: number | null;
  } | null>(null);
  const tween = useRef<{ from: View; to: View; t0: number } | null>(null);

  // ---- song overview -------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#1b1e25";
    ctx.fillRect(0, 0, w, h);
    const span = view.end - view.start;
    const x = (t: number) => ((t - view.start) / span) * w;

    // Bar and beat lines once zoomed in far enough to be useful.
    if (song.bpm) {
      const beat = 60 / song.bpm;
      const perBar = song.timeSignature?.[0] ?? 4;
      const pxPerBeat = (beat / span) * w;
      if (pxPerBeat > 6) {
        for (let b = Math.floor(view.start / beat); b * beat <= view.end; b++) {
          const isBar = b % perBar === 0;
          ctx.fillStyle = isBar ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.07)";
          ctx.fillRect(Math.round(x(b * beat)), 0, 1, h);
          if (isBar && pxPerBeat * perBar > 34) {
            ctx.fillStyle = "rgba(255,255,255,0.45)";
            ctx.font = "500 9px system-ui, sans-serif";
            ctx.textAlign = "left";
            ctx.fillText(String(b / perBar + 1), x(b * beat) + 3, 10);
          }
        }
      }
    }

    if (song.notes.length) {
      let lo = 127;
      let hi = 0;
      for (const n of song.notes) {
        lo = Math.min(lo, n.pitch);
        hi = Math.max(hi, n.pitch);
      }
      lo -= 1;
      hi += 1;
      const rowH = (h - 8) / (hi - lo);
      for (const n of song.notes) {
        if (n.time > view.end || n.time + n.duration < view.start) continue;
        ctx.fillStyle = HAND_COLORS[n.hand].fill;
        const nw = Math.max(1.5, (n.duration / span) * w - (span < 30 ? 1 : 0));
        ctx.fillRect(x(n.time), 4 + (hi - n.pitch) * rowH, nw, Math.max(1.5, rowH));
      }
    }
    if (span >= duration - 0.001) {
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      for (const s of song.sections ?? []) if (s.start > 0) ctx.fillRect(x(s.start), 0, 1, h);
    }
  }, [song, view, duration]);

  // Redraw on resize.
  useEffect(() => {
    const ro = new ResizeObserver(() => setView({ ...viewRef.current }));
    ro.observe(canvasRef.current!);
    return () => ro.disconnect();
  }, []);

  // ---- per-frame work: playhead, zoom tween, edge panning ------------------
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const tw = tween.current;
      if (tw) {
        const k = Math.min(1, (now - tw.t0) / TWEEN_MS);
        const e = 1 - Math.pow(1 - k, 3);
        setView({
          start: tw.from.start + (tw.to.start - tw.from.start) * e,
          end: tw.from.end + (tw.to.end - tw.from.end) * e,
        });
        if (k >= 1) tween.current = null;
      }

      const d = drag.current;
      const v = viewRef.current;
      const span = v.end - v.start;
      if (d && !tween.current && span < duration - 0.001 && stripRef.current) {
        const r = stripRef.current.getBoundingClientRect();
        const left = d.x - r.left;
        const right = r.right - d.x;
        let dir = 0;
        if (left < EDGE_PX) dir = -(1 - Math.max(left, 0) / EDGE_PX);
        else if (right < EDGE_PX) dir = 1 - Math.max(right, 0) / EDGE_PX;
        if (dir !== 0) {
          const shift = dir * PAN_SPEED * span * dt;
          const start = clamp(v.start + shift, 0, duration - span);
          setView({ start, end: start + span });
          apply(d.x);
        }
      }

      const t = player.currentTime();
      const vv = viewRef.current;
      const frac = (t - vv.start) / (vv.end - vv.start);
      if (playheadRef.current) {
        playheadRef.current.style.left = `${frac * 100}%`;
        playheadRef.current.hidden = frac < 0 || frac > 1;
      }
      if (timeRef.current) timeRef.current.textContent = formatTime(t);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, duration]);

  const animateTo = (to: View) => {
    if (reducedMotion()) {
      tween.current = null;
      setView(to);
    } else {
      tween.current = { from: { ...viewRef.current }, to, t0: performance.now() };
    }
  };

  // ---- pointer handling ----------------------------------------------------
  const timeAt = (clientX: number) => {
    const r = stripRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return v.start + clamp((clientX - r.left) / r.width, 0, 1) * (v.end - v.start);
  };

  const apply = (clientX: number) => {
    const d = drag.current;
    if (!d) return;
    const t = timeAt(clientX);
    const { loop: l } = player.state;
    if (d.kind === "start") {
      player.setLoop({ enabled: true, start: Math.min(t, l.end - MIN_LOOP) });
      player.seek(player.state.loop.start);
    } else if (d.kind === "end") {
      player.setLoop({ enabled: true, end: Math.max(t, l.start + MIN_LOOP) });
    } else {
      player.seek(l.enabled ? clamp(t, l.start, l.end - 0.01) : t);
    }
  };

  const armHold = () => {
    const d = drag.current;
    if (!d) return;
    if (d.holdTimer) window.clearTimeout(d.holdTimer);
    d.holdTimer = window.setTimeout(zoomIn, HOLD_MS);
  };

  const zoomIn = () => {
    const d = drag.current;
    if (!d || !stripRef.current) return;
    const v = tween.current?.to ?? viewRef.current;
    const span = v.end - v.start;
    const next = Math.max(MIN_SPAN, span / ZOOM_STEP);
    if (next >= span - 0.001) return;
    // Keep the time under the finger fixed on screen.
    const r = stripRef.current.getBoundingClientRect();
    if (span < duration - 0.001 && (d.x - r.left < EDGE_PX || r.right - d.x < EDGE_PX)) {
      armHold(); // scrolling at an edge, not holding still
      return;
    }
    const frac = clamp((d.x - r.left) / r.width, 0, 1);
    const anchor = v.start + frac * span;
    const start = clamp(anchor - frac * next, 0, duration - next);
    animateTo({ start, end: start + next });
    d.anchorX = d.x;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    const kind = (target.closest("[data-handle]")?.getAttribute("data-handle") as Drag | null) ?? "seek";
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind, x: e.clientX, anchorX: e.clientX, holdTimer: null };
    apply(e.clientX);
    armHold();
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    d.x = e.clientX;
    apply(e.clientX);
    if (Math.abs(e.clientX - d.anchorX) > HOLD_SLOP_PX) {
      d.anchorX = e.clientX;
      armHold();
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    if (d?.holdTimer) window.clearTimeout(d.holdTimer);
    drag.current = null;
    if (viewRef.current.end - viewRef.current.start < duration - 0.001) animateTo(full);
  };

  // ---- layout --------------------------------------------------------------
  const span = view.end - view.start;
  const pct = (t: number) => ((t - view.start) / span) * 100;
  const startPct = pct(loop.start);
  const endPct = pct(loop.end);
  const zoom = duration / span;
  const zoomed = zoom > 1.05;

  return (
    <div className="trimmer">
      <div
        ref={stripRef}
        className={`trimmer-strip ${loop.enabled ? "is-looping" : ""} ${zoomed ? "is-zoomed" : ""}`}
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
        <div className="trimmer-dim" style={{ left: 0, width: `${clamp(startPct, 0, 100)}%` }} />
        <div className="trimmer-dim" style={{ right: 0, width: `${clamp(100 - endPct, 0, 100)}%` }} />
        {endPct > 0 && startPct < 100 && (
          <div
            className="trimmer-frame"
            style={{ left: `${clamp(startPct, 0, 100)}%`, right: `${clamp(100 - endPct, 0, 100)}%` }}
          >
            <div
              className="trimmer-handle is-start"
              data-handle="start"
              aria-label="Loop start"
              hidden={startPct < 0}
            >
              <span />
            </div>
            <div className="trimmer-handle is-end" data-handle="end" aria-label="Loop end" hidden={endPct > 100}>
              <span />
            </div>
          </div>
        )}
        <div ref={playheadRef} className="trimmer-playhead" />
      </div>
      <div className="trimmer-labels">
        <span ref={timeRef} className="mono">
          0:00.0
        </span>
        <span className="trimmer-range mono">
          {zoomed
            ? `${loop.enabled ? `Loop ${formatTime(loop.start)} – ${formatTime(loop.end)} · ` : ""}Zoom ${zoom >= 10 ? Math.round(zoom) : zoom.toFixed(1)}×`
            : loop.enabled
              ? `Loop ${formatTime(loop.start)} – ${formatTime(loop.end)}`
              : "Drag the yellow handles to loop. Hold still while dragging to zoom."}
        </span>
        <span className="mono">{formatTime(duration)}</span>
      </div>
    </div>
  );
}

function clamp(x: number, lo: number, hi: number) {
  return Math.min(Math.max(x, lo), hi);
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}
