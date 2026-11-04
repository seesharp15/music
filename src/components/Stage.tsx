import { useEffect, useMemo, useRef } from "react";
import type { HandLevel, Player } from "../audio/player";
import type { Rhythm } from "../song/rhythm";
import type { Hand, Song } from "../song/types";
import { HAND_COLORS } from "./colors";
import { TOTAL_WHITES, keyRangeFor, keySpan, layoutKeyboard, noteName } from "./keyboard";

const VISIBLE_SECONDS = 3; // song seconds shown above the keyboard

/** Which keys the piano shows. */
export type KeyMode = "all" | "song" | "view";

const MIN_WHITES = 15; // "In view" never narrows past ~2 octaves
const VIEW_LOOKAHEAD = 0.6; // s past the top of the waterfall, so keys widen before notes appear
const GROW_TAU = 0.18; // s: widening to take in a new note is quick…
const SHRINK_TAU = 2.2; // …narrowing again is gentle
const DRIFT_TAU = 2.5; // s: the centre only drifts slowly toward the music
const SWITCH_TAU = 0.22; // s: changing mode, or All/Song

interface Props {
  song: Song;
  player: Player;
  levels: Record<Hand, HandLevel>;
  rhythm: Rhythm;
  /** Draw a line linking left- and right-hand notes that start together. */
  syncLines: boolean;
  keys: KeyMode;
}

const LEVEL_ALPHA: Record<HandLevel, number> = { on: 1, soft: 0.55, off: 0.2 };

/** Synthesia-style falling notes above a piano keyboard. */
export function Stage({ song, player, levels, rhythm, syncLines, keys }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The song's keys, in white-key units.
  const songSpan = useMemo(() => {
    const [low, high] = keyRangeFor(song.notes.map((n) => n.pitch));
    return [keySpan(low)[0], keySpan(high)[1]] as const;
  }, [song]);
  const opts = useRef({ levels, syncLines, keys });
  opts.current = { levels, syncLines, keys };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let width = 0;
    let height = 0;
    // The visible keys as a centre and half-width in white-key units, eased each frame.
    let centre = (songSpan[0] + songSpan[1]) / 2;
    let half = (songSpan[1] - songSpan[0]) / 2;
    let lastNeed: [number, number] = [songSpan[0], songSpan[1]];
    let lastFrame = performance.now();
    let first = true;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const beat = song.bpm ? 60 / song.bpm : 0;
    const beatsPerBar = song.timeSignature?.[0] ?? 4;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const ease = (x: number, target: number, tau: number, dt: number) =>
      reduced || first ? target : x + (target - x) * (1 - Math.exp(-dt / tau));

    /** Keys the notes from just before now to past the top of the waterfall need. */
    const viewNeed = (t: number): [number, number] => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const n of song.notes) {
        if (n.time > t + VISIBLE_SECONDS + VIEW_LOOKAHEAD) break;
        if (n.time + n.duration < t - 0.1) continue;
        const [a, b] = keySpan(n.pitch);
        lo = Math.min(lo, a);
        hi = Math.max(hi, b);
      }
      // A quiet stretch keeps whatever was last needed.
      if (lo <= hi) lastNeed = [lo - 1, hi + 1];
      return lastNeed;
    };

    /** Ease the visible keys toward what the mode wants, then lay them out. */
    const frameKeys = (t: number, dt: number) => {
      const mode = opts.current.keys;
      const [a, b] = mode === "all" ? [0, TOTAL_WHITES] : mode === "song" ? songSpan : viewNeed(t);
      const minHalf = Math.min(MIN_WHITES, TOTAL_WHITES) / 2;
      if (mode === "view") {
        // Hold the middle steady and grow around it; the centre only drifts slowly
        // toward the music, so the player never loses their place.
        centre = ease(centre, (a + b) / 2, DRIFT_TAU, dt);
        const cover = Math.max(minHalf, centre - a, b - centre);
        half = ease(half, cover, cover > half ? GROW_TAU : SHRINK_TAU, dt);
      } else {
        centre = ease(centre, (a + b) / 2, SWITCH_TAU, dt);
        half = ease(half, Math.max(minHalf, (b - a) / 2), SWITCH_TAU, dt);
      }
      half = Math.min(half, TOTAL_WHITES / 2);
      centre = Math.min(Math.max(centre, half), TOTAL_WHITES - half);
      first = false;
      return layoutKeyboard(centre - half, centre + half, width);
    };

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const dt = Math.min(0.1, (now - lastFrame) / 1000);
      lastFrame = now;
      const t = player.currentTime();
      const kbH = Math.round(Math.min(150, Math.max(70, height * 0.22)));
      const hitY = height - kbH;
      const pps = hitY / VISIBLE_SECONDS;
      const layout = frameKeys(t, dt);
      const whiteW = layout.whiteW;

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

      // Sync lines: both hands strike together here.
      if (opts.current.syncLines) {
        for (const m of rhythm.moments) {
          if (m.time > t + VISIBLE_SECONDS) break;
          if (m.time < t - 0.05 || m.hands.size < 2) continue;
          const xs = [...m.pitches.L, ...m.pitches.R]
            .map((p) => layout.keys.get(p))
            .filter((k): k is NonNullable<typeof k> => !!k)
            .map((k) => k.x + k.w / 2);
          if (xs.length < 2) continue;
          const y = Math.min(hitY, hitY - (m.time - t) * pps);
          const x0 = Math.min(...xs);
          const x1 = Math.max(...xs);
          const near = 1 - Math.min(1, Math.max(0, (m.time - t) / VISIBLE_SECONDS));
          ctx.strokeStyle = `rgba(255, 204, 0, ${0.25 + 0.55 * near})`;
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 5]);
          ctx.beginPath();
          ctx.moveTo(x0, y - 1);
          ctx.lineTo(x1, y - 1);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = ctx.strokeStyle;
          for (const x of [x0, x1]) {
            ctx.beginPath();
            ctx.arc(x, y - 1, 3.5, 0, Math.PI * 2);
            ctx.fill();
          }
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
        ctx.globalAlpha = LEVEL_ALPHA[opts.current.levels[n.hand]];
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
  }, [song, player, songSpan, rhythm]);

  return <canvas ref={canvasRef} className="stage" aria-label="Falling notes piano roll" />;
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
    // Label every C with its octave (C3, C4…), sized to the key so it shows on phones too.
    if (p % 12 === 0 && whiteW >= 6) {
      ctx.fillStyle = "rgba(0,0,0,0.72)";
      ctx.font = `600 ${Math.max(8, Math.min(13, whiteW * 0.5))}px system-ui, sans-serif`;
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
