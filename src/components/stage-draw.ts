/**
 * How a waterfall is painted: lane guides, a note, the glow at the line, the keyboard. Practice's
 * `Stage` and the Studio's editor both draw with these, so what is written looks like what will be
 * practised. `e2e/stage-frames.spec.ts` holds Practice to the exact calls it made before this was
 * shared: change nothing here without recording those frames again on purpose.
 */
import type { KeyRect, KeyboardLayout } from "./keyboard";
import { noteName } from "./keyboard";

/** The two shades a note or a lit key is painted in: on a white key, and on a black one. */
export interface NoteColor {
  fill: string;
  dark: string;
}

export const BACKGROUND = "#0f1115";

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Faint vertical guides at every C and F, from the top down to `bottom`. */
export function drawLaneGuides(ctx: CanvasRenderingContext2D, layout: KeyboardLayout, bottom: number) {
  ctx.fillStyle = "rgba(255,255,255,0.035)";
  for (const [p, k] of layout.keys) {
    if (p % 12 === 0 || p % 12 === 5) ctx.fillRect(k.x, 0, 1, bottom);
  }
}

/**
 * One note above its key: a rounded bar from `top`, `h` tall, with the note's letter at its foot
 * when there is room. `labelY` is the baseline for the letter.
 */
export function drawNote(
  ctx: CanvasRenderingContext2D,
  k: KeyRect,
  whiteW: number,
  top: number,
  h: number,
  color: NoteColor,
  alpha: number,
  pitch: number,
  labelY: number,
) {
  const pad = k.black ? 0 : Math.max(1, whiteW * 0.08);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = k.black ? color.dark : color.fill;
  roundRect(ctx, k.x + pad, top, k.w - pad * 2, Math.max(h, 2), Math.min(6, k.w / 3));
  ctx.fill();
  if (k.w > 16 && h > 16) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.font = `600 ${Math.min(11, k.w * 0.4)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(noteName(pitch).replace(/-?\d+$/, ""), k.x + k.w / 2, labelY);
  }
  ctx.globalAlpha = 1;
}

/** The soft light just above the line the notes fall to. */
export function drawLineGlow(ctx: CanvasRenderingContext2D, y: number, width: number) {
  const grad = ctx.createLinearGradient(0, y - 10, 0, y);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(1, "rgba(255,255,255,0.12)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, y - 10, width, 10);
}

/** The keyboard, `h` tall from `y`. Keys in `active` are lit in their colour. */
export function drawKeyboard(
  ctx: CanvasRenderingContext2D,
  layout: KeyboardLayout,
  y: number,
  h: number,
  active: ReadonlyMap<number, NoteColor>,
  whiteW: number,
) {
  ctx.fillStyle = "#7a1f2b";
  ctx.fillRect(0, y, ctx.canvas.width, 3);
  const top = y + 3;
  const kh = h - 3;
  for (const [p, k] of layout.keys) {
    if (k.black) continue;
    const lit = active.get(p);
    ctx.fillStyle = lit ? lit.fill : "#f4f4f2";
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
    const lit = active.get(p);
    ctx.fillStyle = lit ? lit.dark : "#16171b";
    roundRect(ctx, k.x, top - 1, k.w, bh, 2);
    ctx.fill();
    if (!lit) {
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(k.x + 2, top + bh - 6, k.w - 4, 3);
    }
  }
}

/** How tall the black keys are, as a share of the keyboard below its felt strip. */
export const BLACK_KEY_HEIGHT = 0.62;
