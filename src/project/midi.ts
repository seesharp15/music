/**
 * Standard MIDI files, in and out. A project exports as a format-1 file — a conductor track with
 * the tempo and time-signature changes, then one MIDI track per project track — and any ordinary
 * MIDI file imports as a project. Pure: bytes in, bytes out, no browser and no library.
 *
 * What MIDI cannot carry is lost on the way through it: the played feel (`offset`), where each
 * note came from, chords, sections. Every note's pitch, start and length survive exactly.
 */
import { detectKey } from "../music/theory";
import { makeTimeMap, PPQ, ticksPerBar, type MeterEvent, type TempoEvent } from "../music/time";
import { DRUM_PADS, MAX_PITCH, MIN_PITCH } from "../song/ids";
import type { DrumPadId } from "../song/types";
import { expandDrums } from "./compile";
import { drumTrack, newProjectId, noteTrack } from "./new";
import { PROJECT_FORMAT } from "./schema";
import type { DrumTrack, NoteTrack, PNote, Project } from "./types";

/** Thrown for a file that is not MIDI, or is damaged, with a message a person can act on. */
export class MidiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MidiError";
  }
}

/** General MIDI percussion notes for the sixteen pads (channel 10). */
export const PAD_NOTE: Record<DrumPadId, number> = {
  kick: 36,
  rim: 37,
  snare: 38,
  clap: 39,
  hat: 42,
  hatPedal: 44,
  tomLow: 45,
  hatOpen: 46,
  tomMid: 47,
  crash: 49,
  tomHigh: 50,
  ride: 51,
  tamb: 54,
  cowbell: 56,
  perc: 60,
  shaker: 70,
};
const NOTE_PAD = new Map<number, DrumPadId>(DRUM_PADS.map((pad) => [PAD_NOTE[pad], pad]));
// Other General MIDI percussion, filed under the nearest pad.
for (const [note, pad] of [
  [35, "kick"],
  [40, "snare"],
  [41, "tomLow"],
  [43, "tomLow"],
  [48, "tomMid"],
  [52, "crash"],
  [53, "ride"],
  [55, "crash"],
  [57, "crash"],
  [59, "ride"],
  [69, "shaker"],
  [82, "shaker"],
] as [number, DrumPadId][]) {
  if (!NOTE_PAD.has(note)) NOTE_PAD.set(note, pad);
}
const DRUM_CHANNEL = 9;
const OWN_MARK = "piano-tutor:";
const DRUM_HIT_TICKS = 60;

// ── Writing ──────────────────────────────────────────────────────────────────

/** A variable-length quantity: seven bits a byte, most significant first. */
function vlq(value: number): number[] {
  const bytes = [value & 0x7f];
  for (let v = value >>> 7; v > 0; v >>>= 7) bytes.unshift((v & 0x7f) | 0x80);
  return bytes;
}
/** UTF-8, by hand: the pure zone has no TextEncoder to lean on. */
function text(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return out;
}
/** Read text as UTF-8; bytes that are not (old files are often Latin-1) are taken one character each. */
function readText(data: Uint8Array): string {
  let out = "";
  for (let i = 0; i < data.length;) {
    const b = data[i];
    const more = b >= 0xf0 ? 3 : b >= 0xe0 ? 2 : b >= 0xc0 ? 1 : 0;
    let c = more === 3 ? b & 0x07 : more === 2 ? b & 0x0f : more === 1 ? b & 0x1f : b;
    let ok = more > 0;
    for (let k = 1; ok && k <= more; k++) {
      const next = data[i + k];
      if (next === undefined || (next & 0xc0) !== 0x80) ok = false;
      else c = (c << 6) | (next & 0x3f);
    }
    if (ok && more > 0) {
      out += String.fromCodePoint(c);
      i += more + 1;
    } else {
      out += String.fromCharCode(b);
      i++;
    }
  }
  return out;
}
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u16 = (n: number) => [(n >>> 8) & 0xff, n & 0xff];

interface Timed {
  tick: number;
  /** Lower sorts first at the same tick: meta, then note-offs, then note-ons. */
  order: number;
  bytes: number[];
}

function chunk(events: Timed[], endTick: number): number[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body: number[] = [];
  let at = 0;
  for (const e of sorted) {
    body.push(...vlq(Math.max(0, e.tick - at)), ...e.bytes);
    at = Math.max(at, e.tick);
  }
  body.push(...vlq(Math.max(0, endTick - at)), 0xff, 0x2f, 0x00);
  return [...text("MTrk"), ...u32(body.length), ...body];
}
const meta = (tick: number, type: number, data: number[]): Timed => ({
  tick,
  order: 0,
  bytes: [0xff, type, ...vlq(data.length), ...data],
});

/** A project as a Standard MIDI file (format 1, 480 ticks to the quarter note). */
export function projectToMidi(p: Project): Uint8Array {
  const time = makeTimeMap(p.tempo, p.meter);
  const end = p.lengthTicks;
  const conductor: Timed[] = [meta(0, 0x03, text(p.title))];
  for (const t of p.tempo) {
    const usPerQuarter = Math.round(60_000_000 / t.bpm);
    conductor.push(
      meta(t.tick, 0x51, [(usPerQuarter >>> 16) & 0xff, (usPerQuarter >>> 8) & 0xff, usPerQuarter & 0xff]),
    );
  }
  for (const m of p.meter) conductor.push(meta(m.tick, 0x58, [m.numerator, Math.log2(m.denominator), 24, 8]));
  const chunks = [chunk(conductor, end)];

  let channel = 0;
  for (const track of p.tracks) {
    const events: Timed[] = [meta(0, 0x03, text(track.name))];
    if (track.kind === "notes") {
      // A note to this app's own importer, in a text event other software ignores: what the track
      // is for and which hand practises it, which MIDI has no other way to say.
      events.push(meta(0, 0x01, text(`${OWN_MARK}${track.role}:${track.hand}`)));
      if (channel === DRUM_CHANNEL) channel++;
      const ch = channel++ % 16;
      for (const n of track.notes) {
        const velocity = Math.min(127, Math.max(1, Math.round(n.vel * 127)));
        events.push({ tick: n.tick, order: 2, bytes: [0x90 | ch, n.pitch, velocity] });
        events.push({ tick: n.tick + n.dur, order: 1, bytes: [0x80 | ch, n.pitch, 0] });
      }
    } else {
      for (const h of expandDrums(track, time)) {
        const tick = Math.round(h.tick);
        const velocity = Math.min(127, Math.max(1, Math.round(h.vel * 127)));
        events.push({ tick, order: 2, bytes: [0x90 | DRUM_CHANNEL, PAD_NOTE[h.pad], velocity] });
        events.push({ tick: tick + DRUM_HIT_TICKS, order: 1, bytes: [0x80 | DRUM_CHANNEL, PAD_NOTE[h.pad], 0] });
      }
    }
    chunks.push(chunk(events, end));
  }
  return new Uint8Array([...text("MThd"), ...u32(6), ...u16(1), ...u16(chunks.length), ...u16(PPQ), ...chunks.flat()]);
}

// ── Reading ──────────────────────────────────────────────────────────────────

interface RawNote {
  pitch: number;
  tick: number;
  dur: number;
  vel: number;
}
interface RawTrack {
  name: string;
  /** Set on tracks this app exported: what the track is for, and its hand. */
  part?: { role: NoteTrack["role"]; hand: "L" | "R" };
  notes: RawNote[];
  drums: { pad: DrumPadId; tick: number; vel: number }[];
}
export interface ParsedMidi {
  /** Ticks to the quarter note in the file. Everything below is already in the app's 480. */
  division: number;
  title: string;
  tempo: TempoEvent[];
  meter: MeterEvent[];
  tracks: RawTrack[];
  /** The last tick anything happens at, end-of-track marks included. */
  end: number;
}

/** Read a Standard MIDI file. Throws a `MidiError` that says what is wrong with it. */
export function parseMidi(bytes: Uint8Array): ParsedMidi {
  let at = 0;
  const need = (n: number) => {
    if (at + n > bytes.length) throw new MidiError("This MIDI file is cut off part-way through.");
  };
  const byte = () => (need(1), bytes[at++]);
  const tag = () => (need(4), String.fromCharCode(bytes[at++], bytes[at++], bytes[at++], bytes[at++]));
  const read32 = () => (need(4), ((bytes[at++] << 24) | (bytes[at++] << 16) | (bytes[at++] << 8) | bytes[at++]) >>> 0);
  const read16 = () => (need(2), (bytes[at++] << 8) | bytes[at++]);
  const readVlq = () => {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const b = byte();
      value = (value << 7) | (b & 0x7f);
      if (!(b & 0x80)) return value;
    }
    throw new MidiError("This MIDI file is damaged: a time in it cannot be read.");
  };

  if (bytes.length < 14 || tag() !== "MThd") throw new MidiError("This is not a MIDI file.");
  const headerLength = read32();
  const format = read16();
  const count = read16();
  const division = read16();
  at += Math.max(0, headerLength - 6);
  if (format > 1)
    throw new MidiError("This is a type 2 MIDI file (separate patterns), which cannot be opened as one song.");
  if (division & 0x8000)
    throw new MidiError("This MIDI file keeps time in film frames rather than beats, which is not supported.");
  if (division === 0) throw new MidiError("This MIDI file is damaged: it does not say how long a beat is.");
  const scale = (tick: number) => Math.round((tick * PPQ) / division);

  const tempo: TempoEvent[] = [];
  const meter: MeterEvent[] = [];
  const tracks: RawTrack[] = [];
  let title = "";
  let end = 0;

  for (let t = 0; t < count; t++) {
    if (at >= bytes.length) break; // fewer tracks than promised: take what is there
    if (tag() !== "MTrk")
      throw new MidiError("This MIDI file is damaged: a track in it does not start where it should.");
    const length = read32();
    const stop = Math.min(bytes.length, at + length);
    const track: RawTrack = { name: "", notes: [], drums: [] };
    /** Notes sounding, by channel and pitch, oldest first. */
    const open = new Map<number, { tick: number; vel: number }[]>();
    let tick = 0;
    let status = 0;
    while (at < stop) {
      tick += readVlq();
      let first = byte();
      if (first & 0x80) {
        status = first;
        if (status < 0xf0) first = byte();
      } else if (!status) throw new MidiError("This MIDI file is damaged: an event in it has no kind.");
      if (status === 0xff) {
        const type = byte();
        const size = readVlq();
        need(size);
        const data = bytes.subarray(at, at + size);
        at += size;
        if (type === 0x01) {
          const m = /^piano-tutor:(melody|chords|bass|counter|free):([LR])$/.exec(readText(data).trim());
          if (m) track.part = { role: m[1] as NoteTrack["role"], hand: m[2] as "L" | "R" };
        } else if (type === 0x03) {
          const name = readText(data).trim();
          track.name ||= name;
          if (t === 0) title ||= name;
        } else if (type === 0x51 && size === 3) {
          const us = (data[0] << 16) | (data[1] << 8) | data[2];
          if (us > 0) tempo.push({ tick: scale(tick), bpm: Math.round((60_000_000 / us) * 1000) / 1000 });
        } else if (type === 0x58 && size >= 2) {
          const denominator = 2 ** data[1];
          meter.push({
            tick: scale(tick),
            numerator: Math.max(1, data[0]),
            denominator: ([2, 4, 8, 16].includes(denominator) ? denominator : 4) as MeterEvent["denominator"],
          });
        }
        status = 0; // a meta event ends running status
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        const size = readVlq();
        need(size);
        at += size;
        status = 0;
        continue;
      }
      const kind = status & 0xf0;
      const channel = status & 0x0f;
      const a = first;
      const b = kind === 0xc0 || kind === 0xd0 ? 0 : byte();
      const isOn = kind === 0x90 && b > 0;
      const isOff = kind === 0x80 || (kind === 0x90 && b === 0);
      if (!isOn && !isOff) continue;
      const key = (channel << 8) | a;
      if (isOn) {
        if (channel === DRUM_CHANNEL)
          track.drums.push({ pad: NOTE_PAD.get(a) ?? "perc", tick: scale(tick), vel: b / 127 });
        else open.set(key, [...(open.get(key) ?? []), { tick, vel: b / 127 }]);
      } else if (channel !== DRUM_CHANNEL) {
        const started = open.get(key)?.shift();
        if (started) {
          const from = scale(started.tick);
          track.notes.push({ pitch: a, tick: from, dur: scale(tick) - from, vel: started.vel });
        }
      }
    }
    // A key never let go lasts to the end of its track.
    for (const [key, list] of open) {
      for (const started of list) {
        const from = scale(started.tick);
        track.notes.push({ pitch: key & 0xff, tick: from, dur: scale(tick) - from, vel: started.vel });
      }
    }
    end = Math.max(end, scale(tick));
    at = stop;
    tracks.push(track);
  }
  if (!tracks.length) throw new MidiError("This MIDI file has no tracks in it.");
  return { division, title, tempo, meter, tracks, end };
}

const ROLE_BY_NAME: [RegExp, NoteTrack["role"]][] = [
  [/melod|lead|right|voc|treble/i, "melody"],
  [/bass/i, "bass"],
  [/chord|left|comp|harmon|pad|piano l/i, "chords"],
];
/** Below this, a single-track file's notes go to the left hand: middle C, as the bank's importer does. */
export const SPLIT_PITCH = 60;

export interface FromMidiOptions {
  /** Call it this, whatever the file says. */
  title?: string;
  /** What to call it if the file does not say: usually the file's own name. */
  fallbackTitle?: string;
  /** For tests: fix the id and the clock. */
  id?: string;
  now?: Date;
}

/**
 * A MIDI file as a project. Each MIDI track with notes becomes a track; a file with one track is
 * split at middle C into a right hand and a left. Percussion (channel 10) becomes the drum track.
 */
export function projectFromMidi(bytes: Uint8Array, opts: FromMidiOptions = {}): Project {
  const midi = parseMidi(bytes);
  const now = opts.now ?? new Date();
  const stamp = now.toISOString();
  const inOrder = <T extends { tick: number }>(list: T[]): T[] => {
    const byTick = new Map<number, T>();
    for (const e of [...list].sort((a, b) => a.tick - b.tick)) byTick.set(e.tick, e); // the last at a tick wins
    return [...byTick.values()];
  };
  const tempo = inOrder(midi.tempo).map((e) => ({ tick: e.tick, bpm: Math.min(400, Math.max(10, e.bpm)) }));
  if (!tempo.length || tempo[0].tick !== 0) tempo.unshift({ tick: 0, bpm: tempo[0]?.bpm ?? 120 });
  const meter = inOrder(midi.meter);
  if (!meter.length || meter[0].tick !== 0) meter.unshift({ tick: 0, numerator: 4, denominator: 4 });

  let seq = 1;
  const playable = (n: RawNote) => n.dur > 0 && n.pitch >= MIN_PITCH && n.pitch <= MAX_PITCH;
  const toNotes = (raw: RawNote[]): PNote[] =>
    raw
      .filter(playable)
      .sort((a, b) => a.tick - b.tick || a.pitch - b.pitch)
      .map((n) => ({
        id: seq++,
        pitch: n.pitch,
        tick: n.tick,
        dur: n.dur,
        vel: Math.round(n.vel * 100) / 100 || 0.01,
        origin: "imported" as const,
      }));

  const withNotes = midi.tracks.filter((t) => t.notes.some(playable));
  const tracks: Project["tracks"] = [];
  const used = new Set<string>();
  const idFor = (stem: string) => {
    let id = stem;
    for (let n = 2; used.has(id); n++) id = `${stem}${n}`;
    used.add(id);
    return id;
  };

  const namedForAPart = (name: string) => ROLE_BY_NAME.some(([pattern]) => pattern.test(name));
  if (withNotes.length === 1 && !withNotes[0].part && !namedForAPart(withNotes[0].name)) {
    // One track holding both hands (a "Piano" track, or no name at all): split it at middle C.
    // A lone track that says what it is — "Melody", "Bass" — is kept as it is.
    const all = withNotes[0].notes;
    const right = noteTrack(idFor("melody"), "Right hand", "melody", "R");
    const left = noteTrack(idFor("chords"), "Left hand", "chords", "L");
    right.notes = toNotes(all.filter((n) => n.pitch >= SPLIT_PITCH));
    left.notes = toNotes(all.filter((n) => n.pitch < SPLIT_PITCH));
    tracks.push(right, left);
  } else {
    withNotes.forEach((t, i) => {
      const named = ROLE_BY_NAME.find(([pattern]) => pattern.test(t.name))?.[1];
      // Unnamed: the first track is the right hand's melody, the rest the left hand's.
      const role = t.part?.role ?? named ?? (i === 0 ? "melody" : i === 1 ? "chords" : "free");
      const track = noteTrack(
        idFor(role === "free" || role === "counter" ? "track" : role),
        t.name || `Track ${i + 1}`,
        role,
        t.part?.hand ?? (role === "melody" ? "R" : "L"),
      );
      track.notes = toNotes(t.notes);
      tracks.push(track);
    });
  }
  if (!tracks.length) {
    tracks.push(noteTrack(idFor("melody"), "Melody", "melody", "R"));
  }

  const drums: DrumTrack = drumTrack(idFor("drums"));
  drums.hits = midi.tracks
    .flatMap((t) => t.drums)
    .sort((a, b) => a.tick - b.tick)
    .map((h) => ({
      id: seq++,
      pad: h.pad,
      tick: h.tick,
      vel: Math.round(h.vel * 100) / 100 || 0.01,
      origin: "imported" as const,
    }));
  const drumName = midi.tracks.find((t) => t.drums.length)?.name;
  if (drumName) drums.name = drumName;
  tracks.push(drums);

  // As long as the file says, and at least as long as its last note; never less than a bar.
  const contentEnd = Math.max(
    midi.end,
    ...tracks.map((t) =>
      t.kind === "notes"
        ? Math.max(0, ...t.notes.map((n) => n.tick + n.dur))
        : Math.max(0, ...t.hits.map((h) => h.tick + 1)),
    ),
  );
  const lengthTicks = Math.max(ticksPerBar(meter[0]), contentEnd);

  // MIDI rarely says the key: work it out from the notes, and say that it was worked out.
  const notes = tracks.flatMap((t) => (t.kind === "notes" ? t.notes : []));
  const guess = detectKey(notes.map((n) => ({ pitch: n.pitch, dur: n.dur, tick: n.tick })))[0];
  const warnings = guess
    ? [{ text: `The key (${guess.key.tonic} ${guess.key.mode}) was worked out from the notes; the file does not say.` }]
    : [];

  return {
    format: PROJECT_FORMAT,
    id: opts.id ?? newProjectId(now),
    title: opts.title?.trim() || midi.title || opts.fallbackTitle?.trim() || "Imported song",
    createdAt: stamp,
    updatedAt: stamp,
    seq,
    lengthTicks,
    tempo,
    meter,
    key: guess ? [{ tick: 0, tonic: guess.key.tonic, mode: guess.key.mode }] : [],
    swing: { amount: 0.5, unit: 8 },
    handSpan: 14,
    sections: [],
    chords: [],
    tracks,
    ideas: [],
    source: { kind: "midi", importedAt: stamp, ...(warnings.length ? { warnings } : {}) },
  };
}

export const midiFileName = (p: Pick<Project, "title">, slug: (title: string) => string) => `${slug(p.title)}.mid`;
