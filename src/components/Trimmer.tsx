import { useEffect, useRef, useState } from "react";
import { playRange, type LoopRange, type Player } from "../audio/player";
import type { Section, Song } from "../song/types";
import { HAND_COLORS } from "./colors";

interface Props {
  song: Song;
  player: Player;
  loop: LoopRange;
  /** Changes each time the selection is cleared; the view zooms back out. */
  clears: number;
}

type Drag = "start" | "end" | "seek";

interface View {
  start: number;
  end: number;
}

const MIN_LOOP = 0.25;
const MIN_SPAN = 3; // seconds visible at the tightest zoom
const FIT_PAD = 1.6; // visible span = loop length × this
const EDGE_PX = 32; // drag a handle this close to an edge to widen the view
const GROW_SPEED = 0.8; // view widths per second at full push
const TWEEN_MS = 260;
const MIN_ZOOM_SPAN = 1; // seconds visible at the tightest hand zoom
const WHEEL_ZOOM = 0.0015; // per pixel of wheel travel
const PINCH_WHEEL_ZOOM = 0.01; // trackpad pinch arrives as ctrl+wheel with small deltas
const TAP_SLOP = 6; // px a finger may wander before a tap becomes a drag

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const coarsePointer = () => window.matchMedia?.("(pointer: coarse)").matches ?? false;

/**
 * iPhone-clipper-style timeline: a miniature of the song with a yellow frame
 * whose handles set the loop range. Tap or drag elsewhere to seek. Whenever a
 * loop is set the strip zooms to frame it; dragging a handle into an edge
 * widens the view on that side. Scroll (or pinch, on touch) to zoom by hand;
 * a hand-picked view is kept until the loop moves outside it. While zoomed
 * in, playback repeats what's visible (or the loop, where they overlap).
 * Below it, a mini-map of the whole song shows the visible slice; drag that
 * slice (or tap elsewhere on the map) to slide the view along the track.
 * Under that, the same song split into its sections, each one a toggle; the
 * ones switched on become the loop.
 */
export function Trimmer({ song, player, loop, clears }: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapHeadRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const duration = player.duration || 1;
  const sections = song.sections ?? [];
  const full: View = { start: 0, end: duration };

  const [view, setViewState] = useState<View>(full);
  const viewRef = useRef<View>(full);
  const setView = (v: View) => {
    viewRef.current = v;
    setViewState(v);
    player.setWindow(isZoomed(v, duration) ? v : null);
  };

  const drag = useRef<{ kind: Drag; x: number; x0: number; pending: boolean } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; t: number; span: number } | null>(null);
  const manual = useRef(false); // the view was zoomed by hand
  const mapGrab = useRef<number | null>(null); // seconds from the view start to the finger
  const [showAll, setShowAll] = useState(false);
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
      if (d && d.kind !== "seek" && !d.pending && !tween.current && span < duration - 0.001 && stripRef.current) {
        const r = stripRef.current.getBoundingClientRect();
        const left = d.x - r.left;
        const right = r.right - d.x;
        const push = (dist: number) => Math.min(1, 1 - dist / EDGE_PX); // >1 when past the edge is capped
        if (left < EDGE_PX && d.x < d.x0 - TAP_SLOP && v.start > 0) {
          setView({ start: Math.max(0, v.start - push(left) * GROW_SPEED * span * dt), end: v.end });
          apply(d.kind, d.x);
        } else if (right < EDGE_PX && d.x > d.x0 + TAP_SLOP && v.end < duration) {
          setView({ start: v.start, end: Math.min(duration, v.end + push(right) * GROW_SPEED * span * dt) });
          apply(d.kind, d.x);
        }
      }

      const t = player.currentTime();
      const vv = viewRef.current;
      const frac = (t - vv.start) / (vv.end - vv.start);
      if (playheadRef.current) {
        playheadRef.current.style.left = `${frac * 100}%`;
        playheadRef.current.hidden = frac < 0 || frac > 1;
      }
      if (mapHeadRef.current) mapHeadRef.current.style.left = `${(t / duration) * 100}%`;
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

  const apply = (kind: Drag, clientX: number) => {
    const t = timeAt(clientX);
    const r = player.range();
    if (kind === "start") {
      player.setLoop({ enabled: true, start: Math.min(t, r.end - MIN_LOOP), end: r.end });
      player.seek(player.state.loop.start);
    } else if (kind === "end") {
      player.setLoop({ enabled: true, start: r.start, end: Math.max(t, r.start + MIN_LOOP) });
    } else {
      player.seek(clamp(t, r.start, r.end - 0.01));
    }
  };

  /** The view that frames the loop, or the whole song. */
  const fitView = (): View => {
    const l = player.state.loop;
    if (!l.enabled) return full;
    // Sections are framed exactly, so the strip shows just what was picked.
    if (selectedRun(sections, l, duration)) return { start: l.start, end: l.end };
    const span = Math.max(MIN_SPAN, (l.end - l.start) * FIT_PAD);
    if (span >= duration) return full;
    const mid = (l.start + l.end) / 2;
    const start = clamp(mid - span / 2, 0, duration - span);
    return { start, end: start + span };
  };

  useEffect(() => {
    if (!clears) return;
    manual.current = false;
    setShowAll(false);
    animateTo(full);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clears]);

  /** Show `span` seconds with time `t` sitting at fraction `frac` of the strip. */
  const zoomTo = (t: number, frac: number, span: number) => {
    span = clamp(span, Math.min(MIN_ZOOM_SPAN, duration), duration);
    const start = clamp(t - frac * span, 0, duration - span);
    tween.current = null;
    manual.current = span < duration - 0.001;
    setShowAll(!manual.current && player.state.loop.enabled); // zoomed all the way out: offer "Back to loop"
    setView({ start, end: start + span });
  };

  // Wheel zooms around the cursor; horizontal (or shift+) wheel pans. Needs a
  // non-passive native listener so the page doesn't scroll as well.
  useEffect(() => {
    const el = stripRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const v = viewRef.current;
      const span = v.end - v.start;
      const frac = clamp((e.clientX - r.left) / r.width, 0, 1);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.width : 1;
      const dx = (e.shiftKey ? e.deltaY || e.deltaX : e.deltaX) * unit;
      const dy = (e.shiftKey ? 0 : e.deltaY) * unit;
      const t = v.start + frac * span;
      if (Math.abs(dx) > Math.abs(dy)) zoomTo(t + (dx / r.width) * span, frac, span);
      else zoomTo(t, frac, span * Math.exp(dy * (e.ctrlKey ? PINCH_WHEEL_ZOOM : WHEEL_ZOOM)));
      // Keep a held handle (or the playhead) under the cursor at the new scale.
      const d = drag.current;
      if (d && !d.pending) apply(d.kind, d.x);
    };
    // Safari: stop a pinch on the strip from zooming the whole page.
    const stop = (e: Event) => e.preventDefault();
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", stop);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", stop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, duration]);

  // Re-frame whenever the loop changes (but not mid-drag; that happens on release).
  useEffect(() => {
    if (drag.current) return;
    manual.current = false;
    setShowAll(false);
    animateTo(fitView());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loop.enabled, loop.start, loop.end, duration]);

  /** Midpoint (as a strip fraction) and spread of the first two fingers. */
  const fingers = () => {
    const [a, b] = [...pointers.current.values()];
    const r = stripRef.current!.getBoundingClientRect();
    return {
      frac: clamp(((a.x + b.x) / 2 - r.left) / r.width, 0, 1),
      dist: Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)),
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.preventDefault();
    if (pointers.current.size === 2) {
      // Second finger: drop whatever the first one started and pinch instead.
      drag.current = null;
      const { frac, dist } = fingers();
      const v = viewRef.current;
      pinch.current = { dist, t: v.start + frac * (v.end - v.start), span: v.end - v.start };
      return;
    }
    if (pointers.current.size > 2) return;
    const target = e.target as HTMLElement;
    const kind = (target.closest("[data-handle]")?.getAttribute("data-handle") as Drag | null) ?? "seek";
    // A touch on the strip waits to see whether it's a tap, a drag, or the start of a pinch.
    const pending = kind === "seek" && e.pointerType === "touch";
    drag.current = { kind, x: e.clientX, x0: e.clientX, pending };
    if (!pending) apply(kind, e.clientX);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = pinch.current;
    if (p) {
      // The time under the fingers stays under them, so a pinch also pans.
      if (pointers.current.size < 2) return;
      const { frac, dist } = fingers();
      zoomTo(p.t, frac, (p.span * p.dist) / dist);
      return;
    }
    const d = drag.current;
    if (!d) return;
    d.x = e.clientX;
    if (d.pending) {
      if (Math.abs(d.x - d.x0) < TAP_SLOP) return;
      d.pending = false;
    }
    apply(d.kind, d.x);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pinch.current) {
      // Fingers left over from a pinch do nothing until lifted.
      if (pointers.current.size === 0) pinch.current = null;
      return;
    }
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.pending) apply(d.kind, d.x); // a tap seeks
    if (d.kind !== "seek") {
      const v = viewRef.current;
      const l = player.state.loop;
      if (!manual.current || l.start < v.start || l.end > v.end) {
        manual.current = false;
        setShowAll(false);
        animateTo(fitView());
      }
    }
  };

  // ---- mini-map: slide the visible slice along the whole song --------------
  const mapTime = (clientX: number) => {
    const r = mapRef.current!.getBoundingClientRect();
    return clamp((clientX - r.left) / r.width, 0, 1) * duration;
  };

  const onMapDown = (e: React.PointerEvent) => {
    const v = viewRef.current;
    if (!isZoomed(v, duration)) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
    const t = mapTime(e.clientX);
    const span = v.end - v.start;
    if (t >= v.start && t <= v.end) {
      mapGrab.current = t - v.start;
    } else {
      // Tapped outside the slice: centre it there and keep dragging from the middle.
      mapGrab.current = span / 2;
      zoomTo(t - span / 2, 0, span);
    }
  };

  const onMapMove = (e: React.PointerEvent) => {
    if (mapGrab.current === null) return;
    const v = viewRef.current;
    zoomTo(mapTime(e.clientX) - mapGrab.current, 0, v.end - v.start);
  };

  const onMapUp = () => {
    mapGrab.current = null;
  };

  // ---- sections: a contiguous run of toggles is the loop ------------------
  const run = selectedRun(sections, loop, duration);

  const toggleSection = (k: number) => {
    let next: [number, number] | null;
    if (!run) next = [k, k];
    else {
      const [i, j] = run;
      if (k < i) next = [k, j]; // reaching outward takes in everything between
      else if (k > j) next = [i, k];
      else if (i === j) next = null;
      else next = [k, k]; // tapping inside a run narrows it to just that section
    }
    if (next) player.setLoop({ enabled: true, start: sections[next[0]].start, end: sections[next[1]].end });
    else player.setLoop({ enabled: false });
  };

  // ---- layout --------------------------------------------------------------
  const span = view.end - view.start;
  const pct = (t: number) => ((t - view.start) / span) * 100;
  // The handles mark what actually repeats, so they stay in reach when zoomed in.
  const handles = playRange(loop, isZoomed(view, duration) ? view : null, duration);
  const repeating = loop.enabled || isZoomed(view, duration);
  const startPct = pct(handles.start);
  const endPct = pct(handles.end);
  const zoom = duration / span;
  const zoomed = zoom > 1.05;
  const zoomLabel = zoomed ? ` · ${zoom >= 10 ? Math.round(zoom) : zoom.toFixed(1)}×` : "";

  return (
    <div className="trimmer">
      <div
        ref={stripRef}
        className={`trimmer-strip ${repeating ? "is-looping" : ""} ${zoomed ? "is-zoomed" : ""}`}
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
          {loop.enabled
            ? `Loop ${formatTime(loop.start)} – ${formatTime(loop.end)}${zoomLabel}`
            : zoomed
              ? `Looping what's visible${zoomLabel}`
              : `Drag the yellow handles to loop a passage · ${coarsePointer() ? "pinch" : "scroll"} to zoom`}
          {(zoomed || (loop.enabled && showAll)) && (
            <button
              className="trimmer-fit"
              onClick={() => {
                manual.current = false;
                setShowAll(zoomed && loop.enabled);
                animateTo(zoomed ? full : fitView());
              }}
            >
              {zoomed ? "Whole song" : "Back to loop"}
            </button>
          )}
        </span>
        <span className="mono">{formatTime(duration)}</span>
      </div>
      <div
        ref={mapRef}
        className={`trimmer-map ${isZoomed(view, duration) ? "is-active" : ""}`}
        onPointerDown={onMapDown}
        onPointerMove={onMapMove}
        onPointerUp={onMapUp}
        onPointerCancel={onMapUp}
        role="scrollbar"
        aria-label="Visible part of the song"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(view.start)}
      >
        {loop.enabled && (
          <div
            className="trimmer-map-loop"
            style={{ left: `${(loop.start / duration) * 100}%`, width: `${((loop.end - loop.start) / duration) * 100}%` }}
          />
        )}
        <div
          className="trimmer-map-thumb"
          style={{ left: `${((view.start + span / 2) / duration) * 100}%`, width: `${(span / duration) * 100}%` }}
        />
        {sections.map((s) =>
          s.start > 0 ? (
            <div key={s.name + s.start} className="trimmer-map-tick" style={{ left: `${(s.start / duration) * 100}%` }} />
          ) : null,
        )}
        <div ref={mapHeadRef} className="trimmer-map-head" />
      </div>
      {sections.length > 0 && (
        <div className="trimmer-sections" role="group" aria-label="Sections">
          {sections.map((s, k) => {
            const on = !!run && k >= run[0] && k <= run[1];
            const left = (s.start / duration) * 100;
            const width = ((Math.min(s.end, duration) - s.start) / duration) * 100;
            return (
              <button
                key={s.name + s.start}
                className={`trimmer-section ${on ? "is-on" : ""}`}
                style={{ left: `calc(${left}% + 1px)`, width: `calc(${width}% - 2px)` }}
                onClick={() => toggleSection(k)}
                aria-pressed={on}
                title={`${s.name} · ${formatTime(s.start)} – ${formatTime(s.end)}`}
              >
                <span>{shortName(s.name)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** "Verse 1 (bars 9–20)" → "Verse 1". */
const shortName = (name: string) => name.replace(/\s*\(.*\)$/, "");

const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;

/** The run of sections [first, last] that the loop covers exactly, if any. */
function selectedRun(sections: Section[], loop: LoopRange, duration: number): [number, number] | null {
  if (!loop.enabled) return null;
  const i = sections.findIndex((s) => near(s.start, loop.start));
  const j = sections.findIndex((s) => near(Math.min(s.end, duration), loop.end));
  return i >= 0 && j >= i ? [i, j] : null;
}

/** Zoomed in at all: the visible stretch then plays on repeat. */
function isZoomed(v: View, duration: number) {
  return v.end - v.start < duration - 0.01;
}

function clamp(x: number, lo: number, hi: number) {
  return Math.min(Math.max(x, lo), hi);
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}
