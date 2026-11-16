/**
 * Song → Project: how a bank song, or an import, becomes something the Studio can edit.
 * See docs/plan/contracts.md §4.
 *
 * Every note is filed under its nearest grid line, and how far it was from that line is kept in
 * `offset`, so nothing about the performance is lost: compiling the project gives the song back.
 */
import { detectKey, parseKey, canonicalChord } from "../music/theory";
import { estimateTempo } from "../music/tempo";
import { makeTimeMap, PPQ, ticksPerBar, type MeterEvent, type TempoEvent } from "../music/time";
import type { Hand, Song } from "../song/types";
import { drumTrack, newProjectId, noteTrack } from "./new";
import { PROJECT_FORMAT } from "./schema";
import type { ChordEvent, DrumTrack, NoteTrack, PNote, Project } from "./types";

export interface FromSongOptions {
  /** The grid notes are filed on: sixteenths (default) or thirty-seconds. */
  ppqGrid?: 16 | 32;
  /** For tests: fix the id and the clock. */
  id?: string;
  now?: Date;
}

const DENOMINATORS = [2, 4, 8, 16];

export function projectFromSong(song: Song, opts: FromSongOptions = {}): Project {
  const now = opts.now ?? new Date();
  const step = (PPQ * 4) / (opts.ppqGrid ?? 16);
  const warnings: { tick?: number; text: string }[] = [];

  // ── The grid: known, or guessed ──
  let numerator = song.timeSignature?.[0] ?? 4;
  const lower = song.timeSignature?.[1] ?? 4;
  let denominator = (DENOMINATORS.includes(lower) ? lower : 4) as MeterEvent["denominator"];
  let gridGuessed = false;
  let changes: { time: number; bpm: number }[];
  if (song.tempoMap?.length) {
    changes = [...song.tempoMap].sort((a, b) => a.time - b.time);
  } else if (song.bpm) {
    changes = [{ time: 0, bpm: song.bpm }];
  } else {
    // Free time. There is no honest grid; make the best guess and say that it is one.
    const guess = estimateTempo(song.notes.map((n) => ({ time: n.time })));
    gridGuessed = true;
    if (!song.timeSignature) [numerator, denominator] = guess.meter as [number, MeterEvent["denominator"]];
    changes = [{ time: 0, bpm: Math.round(guess.bpm) * (denominator / 4) }];
    warnings.push({
      text: "This song is played in free time, so its bars and beats here are an estimate. The notes sound exactly as they did; only the grid behind them is a guess.",
    });
  }

  // A song's bpm counts the beat its time signature names; a project's counts quarter notes.
  const perQuarter = 4 / denominator;
  const meter: MeterEvent[] = [{ tick: 0, numerator, denominator }];
  const bar = ticksPerBar(meter[0]);

  // Tick 0 is a bar line at or before the song's first moment: a song whose first downbeat comes
  // late (a pickup) gets a whole first bar, and nothing lands before the start.
  const firstBpm = changes[0].bpm * perQuarter;
  const downbeatTicks = ((song.gridOffset ?? 0) * firstBpm * PPQ) / 60;
  const lead = downbeatTicks > 0 ? Math.ceil(downbeatTicks / bar) * bar - downbeatTicks : -downbeatTicks;
  // `lead` ticks pass, at the first tempo, before the song's time 0.
  const tempo: TempoEvent[] = [{ tick: 0, bpm: firstBpm }];
  let tick = lead;
  for (let i = 1; i < changes.length; i++) {
    tick += ((changes[i].time - Math.max(changes[i - 1].time, 0)) * changes[i - 1].bpm * perQuarter * PPQ) / 60;
    const at = Math.round(tick);
    if (at > tempo[tempo.length - 1].tick) tempo.push({ tick: at, bpm: changes[i].bpm * perQuarter });
    else tempo[tempo.length - 1].bpm = changes[i].bpm * perQuarter;
  }
  const time = makeTimeMap(tempo, meter);
  const leadSeconds = time.secondsAt(lead);
  const tickAt = (seconds: number) => time.tickAt(seconds + leadSeconds);

  /** A moment filed on the grid: the line, and how far from it the moment really was. */
  const place = (seconds: number) => {
    const exact = tickAt(seconds);
    const line = Math.max(0, Math.round(exact / step) * step);
    return { exact, line, offset: Math.round(exact - line) };
  };

  // ── Tracks ──
  let seq = 1;
  const tracks: NoteTrack[] = [];
  const trackFor = new Map<string, NoteTrack>();
  if (song.tracks?.length) {
    for (const t of song.tracks) {
      const mine = song.notes.filter((n) => n.track === t.id);
      const right = mine.filter((n) => n.hand === "R").length;
      const hand: Hand = mine.length ? (right * 2 >= mine.length ? "R" : "L") : t.role === "melody" ? "R" : "L";
      const track = {
        ...noteTrack(t.id, t.name, t.role, hand),
        ...(t.sound ? { sound: t.sound } : {}),
        ...(t.volume !== undefined ? { volume: t.volume } : {}),
      };
      tracks.push(track);
      trackFor.set(t.id, track);
    }
  }
  const byHand: Partial<Record<Hand, NoteTrack>> = {};
  const handTrack = (hand: Hand) => {
    let t = byHand[hand];
    if (!t) {
      // The right hand is taken for the melody and the left for the chords; roles can be changed after.
      t =
        hand === "R"
          ? noteTrack(unique("melody"), "Melody", "melody", "R")
          : noteTrack(unique("chords"), "Chords", "chords", "L");
      byHand[hand] = t;
      tracks.push(t);
    }
    return t;
  };
  const unique = (id: string) => (trackFor.has(id) || tracks.some((t) => t.id === id) ? `${id}-2` : id);
  // Both hand tracks exist even when a hand has no notes yet, right hand first.
  if (!song.tracks?.length) {
    handTrack("R");
    handTrack("L");
  }

  for (const n of song.notes) {
    const track = (n.track && trackFor.get(n.track)) || handTrack(n.hand);
    const start = place(n.time);
    const note: PNote = {
      id: seq++,
      pitch: n.pitch,
      tick: start.line,
      dur: Math.max(1, Math.round(tickAt(n.time + n.duration) - start.exact)),
      vel: n.velocity ?? 0.7,
      origin: "imported",
    };
    if (start.offset) note.offset = start.offset;
    if (n.hand !== track.hand) note.hand = n.hand;
    track.notes.push(note);
  }
  for (const t of tracks) t.notes.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch || a.id - b.id);

  // ── Drums ──
  const drums: DrumTrack = drumTrack(tracks.some((t) => t.id === "drums") ? "drums-2" : "drums");
  if (song.drums) {
    drums.kit = song.drums.kit;
    if (song.drums.volume !== undefined) drums.volume = song.drums.volume;
    for (const h of song.drums.hits) {
      const at = place(h.time);
      drums.hits.push({
        id: seq++,
        pad: h.pad,
        tick: at.line,
        vel: h.velocity ?? 0.7,
        origin: "imported",
        ...(at.offset ? { offset: at.offset } : {}),
      });
    }
    drums.hits.sort((a, b) => a.tick - b.tick || a.id - b.id);
  }

  // ── Chords, sections, key ──
  const chords: ChordEvent[] = [];
  for (const c of [...(song.chords ?? [])].sort((a, b) => a.time - b.time)) {
    const symbol = canonicalChord(c.symbol);
    const at = place(c.time).line;
    const prev = chords[chords.length - 1];
    if (!symbol || (prev && at <= prev.tick)) continue;
    if (prev && prev.tick + prev.dur > at) prev.dur = at - prev.tick;
    chords.push({
      id: seq++,
      tick: at,
      dur: Math.max(step, place(c.time + c.duration).line - at),
      symbol,
      origin: "imported",
    });
  }

  const sections = (song.sections ?? [])
    .map((s, i) => {
      const at = place(s.start).line;
      return { id: `s${i + 1}`, name: s.name, tick: at, dur: place(s.end).line - at };
    })
    .filter((s) => s.dur > 0)
    .sort((a, b) => a.tick - b.tick);

  let key = song.key ? parseKey(song.key) : null;
  if (!key) {
    const guess = detectKey(song.notes.map((n) => ({ pitch: n.pitch, dur: n.duration })))[0];
    if (guess) {
      key = guess.key;
      warnings.push({
        text: `The song does not say what key it is in. ${guess.key.tonic} ${guess.key.mode} is the best fit for its notes.`,
      });
    }
  }

  const lastEnd = song.notes.reduce((m, n) => Math.max(m, n.time + n.duration), song.duration ?? 0);
  let length = Math.max(bar, Math.ceil(tickAt(lastEnd) / bar - 1e-9) * bar);
  for (const t of tracks) for (const n of t.notes) length = Math.max(length, n.tick + n.dur);
  for (const c of chords) length = Math.max(length, c.tick + c.dur);
  for (const s of sections) length = Math.max(length, s.tick + s.dur);

  const stamp = now.toISOString();
  return {
    format: PROJECT_FORMAT,
    id: opts.id ?? newProjectId(now),
    title: song.title,
    ...(song.artist ? { author: song.artist } : {}),
    createdAt: stamp,
    updatedAt: stamp,
    seq,
    lengthTicks: length,
    tempo,
    meter,
    key: key ? [{ tick: 0, tonic: key.tonic, mode: key.mode }] : [],
    swing: { amount: 0.5, unit: 8 },
    handSpan: 14,
    sections,
    chords,
    tracks: [...tracks, drums],
    ideas: [],
    source: {
      kind: "song",
      ref: song.id,
      importedAt: stamp,
      ...(gridGuessed ? { gridGuessed: true } : {}),
      ...(warnings.length ? { warnings } : {}),
    },
  };
}
