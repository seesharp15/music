/**
 * Chord symbols as notes: block chords in close position, each in the inversion that moves least
 * from the chord before it. This is what the Studio's "Write to track" writes — a mechanical tool,
 * not a suggestion. Patterns and smarter voicings are Stage 5's.
 */
import { MAX_PITCH, MIN_PITCH } from "../song/ids";
import { parseChord, pitchClassOf } from "./theory";
import { ticksPerBeat, type TimeMap } from "./time";

/** How long each strike of a chord lasts: for the whole chord, or struck again each bar or beat. */
export type Restrike = "hold" | "bar" | "beat";
export const RESTRIKES: readonly Restrike[] = ["hold", "bar", "beat"];

export interface ChordSpan {
  tick: number;
  dur: number;
  symbol: string;
}
export interface VoicedNote {
  pitch: number;
  tick: number;
  dur: number;
}

/** The lowest note of a voicing sits in the octave from here: C3. */
export const VOICING_LOW = 48;
const MOST_NOTES = 5;

/** The chord's pitch classes as they are voiced: no more than five, the fifth going first. */
function voicedTones(symbol: string): { tones: number[]; bass: number | null } | null {
  const chord = parseChord(symbol);
  if (!chord) return null;
  let steps = [...chord.steps];
  // A big chord loses its fifth, then its root's octave doublings, to stay playable in one hand.
  if (steps.length > MOST_NOTES) steps = steps.filter((s) => s !== 7);
  if (steps.length > MOST_NOTES) steps = steps.slice(0, MOST_NOTES);
  const root = pitchClassOf(chord.root);
  const tones = [...new Set(steps.map((s) => (root + s) % 12))];
  return { tones, bass: chord.bass ? pitchClassOf(chord.bass) : null };
}

/**
 * Every close-position voicing of a chord: one for each of its notes at the bottom, the rest
 * stacked upwards as tightly as they go. A slash chord whose bass is one of its notes has only the
 * voicing with that note lowest; any other bass is added underneath.
 */
export function closeVoicings(symbol: string, low = VOICING_LOW): number[][] {
  const read = voicedTones(symbol);
  if (!read) return [];
  const { tones, bass } = read;
  const stack = (bottom: number) => {
    const first = low + ((((bottom - low) % 12) + 12) % 12);
    const above = tones
      .filter((pc) => pc !== bottom)
      .map((pc) => first + ((pc - bottom + 12) % 12))
      .sort((a, b) => a - b);
    return [first, ...above].filter((p) => p >= MIN_PITCH && p <= MAX_PITCH);
  };
  if (bass !== null && tones.includes(bass)) return [stack(bass)];
  const voicings = tones.map(stack);
  if (bass === null) return voicings;
  return voicings.map((v) => {
    const under = v[0] - ((((v[0] - bass) % 12) + 12) % 12) || v[0] - 12;
    return under >= MIN_PITCH ? [under, ...v] : v;
  });
}

/** How far the hand moves between two chords: each note to its nearest neighbour, both ways. */
export function movement(from: readonly number[], to: readonly number[]): number {
  if (!from.length || !to.length) return 0;
  const reach = (a: readonly number[], b: readonly number[]) =>
    a.reduce((sum, p) => sum + Math.min(...b.map((q) => Math.abs(p - q))), 0);
  return reach(from, to) + reach(to, from);
}

/**
 * A chord's notes: in root position when it is the first, otherwise in the inversion that moves
 * least from `previous`. Empty for a symbol that is not a chord.
 */
export function voiceChord(symbol: string, previous: readonly number[] | null = null, low = VOICING_LOW): number[] {
  const voicings = closeVoicings(symbol, low);
  if (!voicings.length) return [];
  if (!previous?.length) return voicings[0];
  let best = voicings[0];
  let least = Infinity;
  for (const v of voicings) {
    const m = movement(previous, v);
    if (m < least) {
      least = m;
      best = v;
    }
  }
  return best;
}

/** Where a chord is struck: once, or again at each bar line or beat it lasts through. */
export function strikes(
  chord: { tick: number; dur: number; symbol?: string },
  time: TimeMap,
  mode: Restrike,
): { tick: number; dur: number }[] {
  const end = chord.tick + chord.dur;
  if (mode === "hold") return [{ tick: chord.tick, dur: chord.dur }];
  const starts: number[] = [chord.tick];
  if (mode === "bar") {
    let bar = time.positionAt(chord.tick).bar + 1;
    for (let t = time.tickOfBar(bar); t < end; t = time.tickOfBar(++bar)) starts.push(t);
  } else {
    const pos = time.positionAt(chord.tick);
    const beat = ticksPerBeat(time.meterAt(chord.tick));
    // The next beat line after the chord's start, then every beat of whatever bar it is in.
    let t = chord.tick - pos.tick + beat;
    while (t < end) {
      starts.push(t);
      t += ticksPerBeat(time.meterAt(t));
    }
  }
  return starts.map((tick, i) => ({ tick, dur: (starts[i + 1] ?? end) - tick }));
}

/** One chord, in a given voicing, as notes. */
export function chordNotes(chord: ChordSpan, voicing: readonly number[], time: TimeMap, mode: Restrike): VoicedNote[] {
  return strikes(chord, time, mode).flatMap((s) => voicing.map((pitch) => ({ pitch, tick: s.tick, dur: s.dur })));
}

/** A whole progression as notes, each chord voiced to move least from the one before. */
export function realizeChords(chords: readonly ChordSpan[], time: TimeMap, mode: Restrike): VoicedNote[] {
  const out: VoicedNote[] = [];
  let previous: number[] | null = null;
  for (const chord of [...chords].sort((a, b) => a.tick - b.tick)) {
    const voicing = voiceChord(chord.symbol, previous);
    if (!voicing.length) continue;
    out.push(...chordNotes(chord, voicing, time, mode));
    previous = voicing;
  }
  return out;
}

/**
 * Whether these notes are exactly what a chord would be written as — in any of its close voicings,
 * struck in any of the three ways. Returns how it was struck, or null if the notes are anything else
 * (someone has changed them, or wrote them by hand).
 */
export function writtenAs(notes: readonly VoicedNote[], chord: ChordSpan, time: TimeMap): Restrike | null {
  if (!notes.length) return null;
  const key = (n: VoicedNote) => `${n.pitch}:${n.tick}:${n.dur}`;
  const have = notes.map(key).sort().join(" ");
  for (const mode of RESTRIKES) {
    for (const voicing of closeVoicings(chord.symbol)) {
      if (chordNotes(chord, voicing, time, mode).map(key).sort().join(" ") === have) return mode;
    }
  }
  return null;
}
