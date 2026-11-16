/**
 * Project → Song: what makes everything written in the Studio practisable. Pure and deterministic.
 * See docs/plan/contracts.md §4.
 */
import { grooveAccent, grooveOffset, swingOffset } from "../music/quantize";
import { keyName } from "../music/theory";
import { makeTimeMap, type TimeMap } from "../music/time";
import { normalize } from "../song/normalize";
import type { DrumPadId, Note, Song } from "../song/types";
import type { DrumTrack, NoteTrack, Project } from "./types";

export interface CompileOptions {
  /** Leave out swing, groove and offsets: exactly on the grid. */
  straight?: boolean;
  /** Only these tracks (solo). A muted track named here is compiled all the same. */
  tracks?: string[];
  /** Only this tick range, shifted to start at 0. */
  range?: { start: number; end: number };
}

const round = (seconds: number) => Math.round(seconds * 1e6) / 1e6;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function compileProject(p: Project, opts: CompileOptions = {}): Song {
  const time = makeTimeMap(p.tempo, p.meter);
  const from = opts.range?.start ?? 0;
  const until = opts.range?.end ?? Infinity;
  const zero = time.secondsAt(from);
  /** Seconds from the start of what is compiled. */
  const at = (tick: number) => round(time.secondsAt(tick) - zero);
  const included = (t: { id: string; muted: boolean }) => (opts.tracks ? opts.tracks.includes(t.id) : !t.muted);

  /** Where a grid position is heard once the song's feel is applied: swing and groove, not offsets. */
  const felt = (tick: number): number => {
    if (opts.straight) return tick;
    const barStart = time.tickOfBar(time.positionAt(tick).bar);
    return tick + swingOffset(tick, p.swing, barStart) + (p.groove ? grooveOffset(tick, p.groove, time) : 0);
  };
  const accent = (tick: number) => (opts.straight || !p.groove ? 1 : grooveAccent(tick, p.groove, time));

  // ── Notes ──
  const notes: Note[] = [];
  const noteTracks = p.tracks.filter((t): t is NoteTrack => t.kind === "notes" && included(t));
  for (const track of noteTracks) {
    const own: Note[] = [];
    for (const n of track.notes) {
      if (n.tick < from || n.tick >= until) continue;
      const push = opts.straight ? 0 : (n.offset ?? 0) * track.feel;
      // The start moves with the feel; the end is swung too, so a swung pair stays long–short
      // rather than overlapping.
      const start = Math.max(from, felt(n.tick) + push);
      const end = Math.max(start + 1, Math.min(felt(n.tick + n.dur) + push, until));
      own.push({
        pitch: n.pitch,
        time: at(start),
        duration: round(at(end) - at(start)),
        hand: n.hand ?? track.hand,
        velocity: round(clamp01(n.vel * accent(n.tick))),
        track: track.id,
      });
    }
    notes.push(...withoutOverlaps(own));
  }

  // ── Drums ──
  const drumTracks = p.tracks.filter((t): t is DrumTrack => t.kind === "drums" && included(t));
  const hits: { pad: DrumPadId; time: number; velocity: number }[] = [];
  for (const track of drumTracks) {
    for (const h of expandDrums(track, time)) {
      if (h.tick < from || h.tick >= until) continue;
      const push = opts.straight ? 0 : h.offset * track.feel;
      hits.push({
        pad: h.pad,
        time: at(Math.max(from, felt(h.tick) + push)),
        velocity: round(clamp01(h.vel * accent(h.tick))),
      });
    }
  }
  hits.sort((a, b) => a.time - b.time || a.pad.localeCompare(b.pad));

  // ── The song around them ──
  const meter = time.meterAt(from);
  // A song's `bpm` counts the beat its time signature names; a project's counts quarter notes.
  const perQuarter = meter.denominator / 4;
  const end = Math.min(p.lengthTicks, until);
  const tempos = p.tempo.filter((e) => e.tick > from && e.tick < end);
  const clip = (tick: number, dur: number) => ({ start: Math.max(tick, from), end: Math.min(tick + dur, end) });

  const song: Song = {
    format: "piano-song/v2",
    id: `u-${p.id}`,
    title: p.title,
    ...(p.author ? { artist: p.author } : {}),
    bpm: time.bpmAt(from) * perQuarter,
    timeSignature: [meter.numerator, meter.denominator],
    duration: Math.max(at(end), 0),
    notes,
    key: keyName(keyAtTick(p, from)),
    ...(tempos.length
      ? {
          tempoMap: [
            { time: 0, bpm: time.bpmAt(from) * perQuarter },
            ...tempos.map((e) => ({ time: at(e.tick), bpm: e.bpm * perQuarter })),
          ],
        }
      : {}),
    tracks: noteTracks.map((t) => ({ id: t.id, name: t.name, role: t.role, sound: t.sound, volume: t.volume })),
    origin: {
      kind: p.source && p.source.kind !== "song" ? "import" : "studio",
      projectId: p.id,
      createdAt: p.createdAt,
    },
  };

  const sections = p.sections
    .map((s) => ({ name: s.name, ...clip(s.tick, s.dur) }))
    .filter((s) => s.end > s.start)
    .map((s) => ({ name: s.name, start: at(s.start), end: at(s.end) }));
  if (sections.length) song.sections = sections;

  const chords = p.chords
    .map((c) => ({ symbol: c.symbol, ...clip(c.tick, c.dur) }))
    .filter((c) => c.end > c.start)
    .map((c) => ({ time: at(c.start), duration: round(at(c.end) - at(c.start)), symbol: c.symbol }));
  if (chords.length) song.chords = chords;

  if (hits.length) song.drums = { kit: drumTracks[0].kit, volume: drumTracks[0].volume, hits };

  return normalize(song);
}

function keyAtTick(p: Project, tick: number) {
  let found = p.key[0] ?? { tonic: "C", mode: "major" as const };
  for (const k of p.key) if (k.tick <= tick) found = k;
  return { tonic: found.tonic, mode: found.mode };
}

/**
 * Two notes of one pitch on one track cannot sound at once on a piano: the earlier is cut where the
 * later begins, and of two that start together only the longer is kept.
 */
function withoutOverlaps(notes: Note[]): Note[] {
  const byPitch = new Map<number, Note[]>();
  for (const n of notes) {
    const list = byPitch.get(n.pitch);
    if (list) list.push(n);
    else byPitch.set(n.pitch, [n]);
  }
  const out: Note[] = [];
  for (const list of byPitch.values()) {
    list.sort((a, b) => a.time - b.time || b.duration - a.duration);
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      const prev = out[out.length - 1];
      if (i > 0 && prev.pitch === n.pitch && n.time <= prev.time) continue; // starts with the one before
      const next = list.slice(i + 1).find((x) => x.time > n.time);
      out.push(next && n.time + n.duration > next.time ? { ...n, duration: round(next.time - n.time) } : n);
    }
  }
  return out;
}

/** Every drum hit of a track, in ticks: its free hits, and its patterns laid out clip by clip. */
function expandDrums(track: DrumTrack, time: TimeMap): { pad: DrumPadId; tick: number; vel: number; offset: number }[] {
  const out = track.hits.map((h) => ({ pad: h.pad, tick: h.tick, vel: h.vel, offset: h.offset ?? 0 }));
  for (const clip of track.clips) {
    const pattern = track.patterns.find((x) => x.id === clip.patternId);
    if (!pattern) continue;
    let barStart = clip.tick;
    for (let bar = 0; bar < clip.repeats * pattern.bars; bar++) {
      // A pattern's columns divide whatever bar it lands on: sixteen steps of 4/4, or of 3/4.
      const barTicks = time.ticksPerBarAt(barStart);
      const stepTicks = barTicks / pattern.stepsPerBar;
      const first = (bar % pattern.bars) * pattern.stepsPerBar;
      for (const [pad, lane] of Object.entries(pattern.lanes) as [DrumPadId, number[]][]) {
        for (let s = 0; s < pattern.stepsPerBar; s++) {
          const vel = lane[first + s];
          if (vel > 0) out.push({ pad, tick: barStart + s * stepTicks, vel, offset: 0 });
        }
      }
      barStart += barTicks;
    }
  }
  return out;
}
