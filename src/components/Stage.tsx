import { useEffect, useMemo, useRef } from "react";
import type { Player } from "../audio/player";
import type { Hand, Song } from "../song/types";
import { HAND_COLORS } from "./colors";
import { keyRangeFor, layoutKeyboard, noteName } from "./keyboard";

const VISIBLE_SECONDS = 3; // song seconds shown above the keyboard

interface Props {
  song: Song;
  player: Player;
  muted: Record<Hand, boolean>;
}

/** Synthesia-style falling notes above a piano keyboard. */
export function Stage({ song, player, muted }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const range = useMemo(() => keyRangeFor(song.notes.map((n) => n.pitch)), [song]);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let width = 0;
    let height = 0;
    let layout = layoutKeyboard(range[0], range[1], 1);

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      layout = layoutKeyboard(range[0], range[1], width);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const beat = song.bpm ? 60 / song.bpm : 0;
    const beatsPerBar = song.timeSignature?.[0] ?? 4;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const t = player.currentTime();
      const kbH = Math.round(Math.min(150, Math.max(70, height * 0.22)));
      const hitY = height - kbH;
      const pps = hitY / VISIBLE_SECONDS;
      const whiteW = width / countWhites(layout);

      ctx.fillStyle = "#0f1115";
      ctx.fillRect(0, 0, width, height);

      // Lane guides at every C and F.
      ctx.fillStyle = "rgba(255,255,255,0.035)";
      for (const [p, k] of layout.keys) {
        if (p % 12 === 0 || p % 12 === 5) ctx.fillRect(k.x, 0, 1, hitY);
      }

      // Bar / beat lines.
      if (beat > 0) {
        const first = Math.floor(t / beat);
        for (let b = first; b * beat < t + VISIBLE_SECONDS; b++) {
          const y = hitY - (b * beat - t) * pps;
          const bar = b % beatsPerBar === 0;
          ctx.fillStyle = bar ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)";
          ctx.fillRect(0, Math.round(y), width, 1);
        }
      }

      // Falling notes.
      const active = new Map<number, Hand>();
      for (const n of song.notes) {
        if (n.time > t + VISIBLE_SECONDS) break;
        const end = n.time + n.duration;
        if (end < t) continue;
        const k = layout.keys.get(n.pitch);
        if (!k) continue;
        if (n.time <= t && t < end) active.set(n.pitch, n.hand);
        const yBottom = hitY - (n.time - t) * pps;
        const yTop = hitY - (end - t) * pps;
        const top = Math.max(yTop, -4);
        const h = Math.min(yBottom, hitY) - top;
        if (h <= 0) continue;
        const c = HAND_COLORS[n.hand];
        const pad = k.black ? 0 : Math.max(1, whiteW * 0.08);
        ctx.globalAlpha = mutedRef.current[n.hand] ? 0.25 : 1;
        ctx.fillStyle = k.black ? c.dark : c.fill;
        roundRect(ctx, k.x + pad, top, k.w - pad * 2, Math.max(h, 2), Math.min(6, k.w / 3));
        ctx.fill();
        if (k.w > 16 && h > 16) {
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.font = `600 ${Math.min(11, k.w * 0.4)}px system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(noteName(n.pitch).replace(/-?\d+$/, ""), k.x + k.w / 2, Math.min(yBottom, hitY) - 5);
        }
        ctx.globalAlpha = 1;
      }

      // Hit line glow.
      const grad = ctx.createLinearGradient(0, hitY - 10, 0, hitY);
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(1, "rgba(255,255,255,0.12)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, hitY - 10, width, 10);

      drawKeyboard(ctx, layout, hitY, kbH, active, whiteW);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [song, player, range]);

  return <canvas ref={canvasRef} className="stage" aria-label="Falling notes piano roll" />;
}

function countWhites(layout: ReturnType<typeof layoutKeyboard>) {
  let n = 0;
  for (const k of layout.keys.values()) if (!k.black) n++;
  return n;
}

function drawKeyboard(
  ctx: CanvasRenderingContext2D,
  layout: ReturnType<typeof layoutKeyboard>,
  y: number,
  h: number,
  active: Map<number, Hand>,
  whiteW: number,
) {
  ctx.fillStyle = "#7a1f2b";
  ctx.fillRect(0, y, ctx.canvas.width, 3);
  const top = y + 3;
  const kh = h - 3;
  for (const [p, k] of layout.keys) {
    if (k.black) continue;
    const hand = active.get(p);
    ctx.fillStyle = hand ? HAND_COLORS[hand].fill : "#f4f4f2";
    ctx.fillRect(k.x + 0.5, top, k.w - 1, kh);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(k.x + k.w - 0.5, top, 1, kh);
    if (p % 12 === 0 && whiteW > 14) {
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.font = `500 ${Math.min(11, whiteW * 0.45)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(noteName(p), k.x + k.w / 2, top + kh - 6);
    }
  }
  const bh = kh * 0.62;
  for (const [p, k] of layout.keys) {
    if (!k.black) continue;
    const hand = active.get(p);
    ctx.fillStyle = hand ? HAND_COLORS[hand].dark : "#16171b";
    roundRect(ctx, k.x, top - 1, k.w, bh, 2);
    ctx.fill();
    if (!hand) {
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(k.x + 2, top + bh - 6, k.w - 4, 3);
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
