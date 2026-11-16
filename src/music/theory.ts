/**
 * The theory kernel: keys, scale degrees, chord symbols, Roman numerals, key finding.
 *
 * A thin, typed layer over `tonal`, so that nothing else in the app imports `tonal` and the library
 * could be swapped. The kernel owns one canonical spelling for every chord (the table below); tonal
 * supplies note spelling and reads the many other ways people write a chord.
 */
import { Chord as TonalChord, Scale as TonalScale } from "tonal";
import type { ChordEvent, Project } from "../project/types";
import { ticksPerBeat, type TimeMap } from "./time";

// ── Keys ─────────────────────────────────────────────────────────────────────

export type Mode = Project["key"][number]["mode"];
export interface Key {
  tonic: string;
  mode: Mode;
}

const MODES: Record<Mode, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};
const MAJOR = MODES.major;
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** How a pitch class is named when there is no key to say otherwise: the usual chord-root spellings. */
const PLAIN_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

const mod12 = (x: number) => ((x % 12) + 12) % 12;

/** "f♯" → { name: "F#", pc: 6, letter: "F", alt: 1 }; null when it is not a note name. */
function readNoteName(text: string): { name: string; pc: number; letter: string; alt: number } | null {
  const m = /^([A-Ga-g])([#b♯♭]{0,2})$/.exec(text.trim());
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const acc = m[2].replace(/♯/g, "#").replace(/♭/g, "b");
  const alt = [...acc].reduce((sum, c) => sum + (c === "#" ? 1 : -1), 0);
  return { name: letter + acc, pc: mod12(LETTER_PC[letter] + alt), letter, alt };
}

/** Pitch class (0–11) of a note name such as "F#" or "Bb"; -1 when it is not one. */
export function pitchClassOf(name: string): number {
  return readNoteName(name)?.pc ?? -1;
}

/** "A minor", "F# dorian", "Bb" (major), "Am" → a Key; null when it cannot be read. */
export function parseKey(name: string): Key | null {
  const m = /^\s*([A-Ga-g][#b♯♭]?)\s*(.*?)\s*$/.exec(name);
  if (!m) return null;
  const tonic = readNoteName(m[1]);
  if (!tonic) return null;
  const word = m[2].toLowerCase();
  const mode: Mode | null =
    word === "" || word === "maj" || word === "major"
      ? "major"
      : word === "m" || word === "min" || word === "minor" || word === "aeolian"
        ? "minor"
        : word in MODES
          ? (word as Mode)
          : null;
  return mode ? { tonic: tonic.name, mode } : null;
}

/** A Key as the song format writes it: "A minor". */
export function keyName(key: Key): string {
  return `${key.tonic} ${key.mode}`;
}

const tonicPc = (key: Key) => Math.max(0, pitchClassOf(key.tonic));

/** The pitch classes of a key's scale, from the tonic upwards. */
export function scaleOf(key: Key): number[] {
  const t = tonicPc(key);
  return MODES[key.mode].map((s) => mod12(t + s));
}

/** The note names of a key's scale, spelled as the key spells them: F# major has an E#. */
export function scaleNames(key: Key): string[] {
  const tonalName = key.mode === "minor" ? "aeolian" : key.mode;
  const names = TonalScale.get(`${key.tonic} ${tonalName}`).notes;
  return names.length === 7 ? names : scaleOf(key).map((pc) => PLAIN_NAMES[pc]);
}

/**
 * Where a pitch class sits against a scale: the degree (0–6) and whether it is raised or lowered.
 * Degrees are counted in the key's own scale: in A minor, C is 3 and C# is #3.
 */
function degreeParts(rel: number, mode: Mode): { index: number; alt: -1 | 0 | 1 } {
  const steps = MODES[mode];
  const exact = steps.indexOf(rel);
  if (exact >= 0) return { index: exact, alt: 0 };
  const lower = steps.indexOf(mod12(rel - 1));
  const upper = steps.indexOf(mod12(rel + 1));
  // A scale note put back where the major scale has it reads as raised: #3, #6 and #7 in minor.
  if (lower >= 0 && MAJOR[lower] === rel) return { index: lower, alt: 1 };
  // The tritone is a raised fourth, by convention.
  if (rel === 6 && steps[3] === 5) return { index: 3, alt: 1 };
  return upper >= 0 ? { index: upper, alt: -1 } : { index: Math.max(lower, 0), alt: 1 };
}

const accidental = (alt: number) => (alt > 0 ? "#".repeat(alt) : "b".repeat(-alt));

/** Scale degree of a pitch in a key: "1"…"7", with "b" or "#" for notes outside the scale. */
export function degreeOf(pitch: number, key: Key): string {
  const { index, alt } = degreeParts(mod12(pitch - tonicPc(key)), key.mode);
  return accidental(alt) + String(index + 1);
}

function readDegree(degree: string, key: Key): number | null {
  const m = /^([#b]?)([1-7])$/.exec(degree.trim());
  if (!m) return null;
  const alt = m[1] === "#" ? 1 : m[1] === "b" ? -1 : 0;
  return mod12(tonicPc(key) + MODES[key.mode][Number(m[2]) - 1] + alt);
}

/** The pitch nearest `near` that is the given degree of the key. Ties go upwards. */
export function pitchOfDegree(degree: string, key: Key, near: number): number {
  const pc = readDegree(degree, key);
  if (pc === null) throw new Error(`Not a scale degree: ${degree}`);
  const up = mod12(pc - near);
  return up <= 6 ? near + up : near + up - 12;
}

/** A pitch class named as the key names it: F# in D major, Gb in Db major. */
export function spellPitchClass(pc: number, key?: Key): string {
  if (!key) return PLAIN_NAMES[mod12(pc)];
  const { index, alt } = degreeParts(mod12(pc - tonicPc(key)), key.mode);
  const base = readNoteName(scaleNames(key)[index]);
  if (!base) return PLAIN_NAMES[mod12(pc)];
  const total = base.alt + alt;
  return Math.abs(total) <= 1 ? base.letter + accidental(total) : PLAIN_NAMES[mod12(pc)];
}

/** A pitch named to fit the key: "F#4" or "Gb4". Middle C is C4. */
export function spell(pitch: number, key?: Key): string {
  const name = readNoteName(spellPitchClass(pitch, key))!;
  // The octave belongs to the letter: Cb4 is the B below middle C's octave-mate, B#3 is middle C.
  return `${name.name}${(pitch - name.alt - LETTER_PC[name.letter]) / 12 - 1}`;
}

// ── Intervals ────────────────────────────────────────────────────────────────

const INTERVAL_NAMES = ["P1", "m2", "M2", "m3", "M3", "P4", "TT", "P5", "m6", "M6", "m7", "M7"];
const COMPOUND_NAMES = ["P8", "m9", "M9", "m10", "M10", "P11", "A11", "P12", "m13", "M13", "m14", "M14"];

/** The interval from one pitch to another: signed semitones, and its name ignoring direction. */
export function interval(a: number, b: number): { semitones: number; name: string } {
  const semitones = b - a;
  const size = Math.abs(semitones);
  const name = size < 12 ? INTERVAL_NAMES[size] : size < 24 ? COMPOUND_NAMES[size - 12] : `${size} semitones`;
  return { semitones, name };
}

/**
 * Move a pitch by scale steps, staying in the key. A note outside the scale keeps its alteration:
 * in C major, Db (a lowered 2) up one step is Eb (a lowered 3).
 */
export function transposeDiatonic(pitch: number, steps: number, key: Key): number {
  const scale = MODES[key.mode];
  const rel = pitch - tonicPc(key);
  const { index, alt } = degreeParts(mod12(rel), key.mode);
  // The scale-tone this pitch is an alteration of, as an absolute pitch.
  const anchor = pitch - alt;
  const octave = Math.floor((anchor - tonicPc(key)) / 12);
  const target = index + steps;
  const targetOctave = octave + Math.floor(target / 7);
  return tonicPc(key) + targetOctave * 12 + scale[((target % 7) + 7) % 7] + alt;
}

// ── Chords ───────────────────────────────────────────────────────────────────

interface Quality {
  /** The one way this kernel writes it. */
  name: string;
  /** Semitones above the root, in chord order. */
  steps: readonly number[];
  /** Other spellings it reads. */
  aliases: readonly string[];
}

/**
 * Every chord quality the kernel names, simplest first: when a set of notes could be read two ways,
 * the earlier entry wins. No two entries share a set of pitch classes.
 */
const QUALITIES: readonly Quality[] = [
  { name: "", steps: [0, 4, 7], aliases: ["M", "maj", "major", "Maj"] },
  { name: "m", steps: [0, 3, 7], aliases: ["min", "minor", "-", "mi"] },
  { name: "7", steps: [0, 4, 7, 10], aliases: ["dom7", "dom"] },
  { name: "maj7", steps: [0, 4, 7, 11], aliases: ["M7", "Maj7", "ma7", "major7", "Δ", "Δ7", "^7"] },
  { name: "m7", steps: [0, 3, 7, 10], aliases: ["min7", "-7", "mi7", "minor7"] },
  { name: "sus4", steps: [0, 5, 7], aliases: ["sus"] },
  { name: "sus2", steps: [0, 2, 7], aliases: ["2"] },
  { name: "dim", steps: [0, 3, 6], aliases: ["°", "o", "mb5"] },
  { name: "aug", steps: [0, 4, 8], aliases: ["+", "#5", "+5"] },
  { name: "5", steps: [0, 7], aliases: ["no3"] },
  { name: "6", steps: [0, 4, 7, 9], aliases: ["M6", "maj6", "add6"] },
  { name: "m6", steps: [0, 3, 7, 9], aliases: ["min6", "-6"] },
  { name: "m7b5", steps: [0, 3, 6, 10], aliases: ["ø", "ø7", "m7-5", "min7b5", "-7b5", "half-diminished", "h7"] },
  { name: "dim7", steps: [0, 3, 6, 9], aliases: ["°7", "o7"] },
  {
    name: "mMaj7",
    steps: [0, 3, 7, 11],
    aliases: ["m(maj7)", "mM7", "mmaj7", "minMaj7", "m/ma7", "m/maj7", "-Δ7", "-maj7"],
  },
  { name: "7sus4", steps: [0, 5, 7, 10], aliases: ["7sus"] },
  { name: "add9", steps: [0, 4, 7, 14], aliases: ["add2", "Madd9", "(add9)"] },
  { name: "madd9", steps: [0, 3, 7, 14], aliases: ["m(add9)", "madd2", "minadd9"] },
  { name: "add11", steps: [0, 4, 7, 17], aliases: ["add4", "Madd11", "(add11)"] },
  { name: "9", steps: [0, 4, 7, 10, 14], aliases: ["dom9"] },
  { name: "maj9", steps: [0, 4, 7, 11, 14], aliases: ["M9", "Maj9", "Δ9"] },
  { name: "m9", steps: [0, 3, 7, 10, 14], aliases: ["min9", "-9"] },
  { name: "6/9", steps: [0, 4, 7, 9, 14], aliases: ["69", "6add9", "M69"] },
  { name: "m6/9", steps: [0, 3, 7, 9, 14], aliases: ["m69", "m6add9"] },
  { name: "7#5", steps: [0, 4, 8, 10], aliases: ["aug7", "+7", "7+", "7+5", "7aug"] },
  { name: "7b5", steps: [0, 4, 6, 10], aliases: ["7-5"] },
  { name: "maj7#5", steps: [0, 4, 8, 11], aliases: ["+maj7", "augmaj7", "maj7+5", "M7#5", "+M7"] },
  { name: "7b9", steps: [0, 4, 7, 10, 13], aliases: ["7-9"] },
  { name: "7#9", steps: [0, 4, 7, 10, 15], aliases: ["7+9"] },
  { name: "7#11", steps: [0, 4, 7, 10, 18], aliases: ["7+11", "7#4"] },
  { name: "7b13", steps: [0, 4, 7, 10, 20], aliases: ["7-13", "7b6"] },
  { name: "9sus4", steps: [0, 5, 7, 10, 14], aliases: ["9sus"] },
  { name: "maj7#11", steps: [0, 4, 7, 11, 18], aliases: ["M7#11", "maj7+11", "Δ#11"] },
  { name: "11", steps: [0, 4, 7, 10, 14, 17], aliases: ["dom11"] },
  { name: "m11", steps: [0, 3, 7, 10, 14, 17], aliases: ["min11", "-11"] },
  { name: "13", steps: [0, 4, 7, 10, 14, 21], aliases: ["dom13"] },
  { name: "maj13", steps: [0, 4, 7, 11, 14, 21], aliases: ["M13", "Maj13"] },
  { name: "m13", steps: [0, 3, 7, 10, 14, 21], aliases: ["min13", "-13"] },
  { name: "9#11", steps: [0, 4, 7, 10, 14, 18], aliases: ["9+11"] },
  { name: "13b9", steps: [0, 4, 7, 10, 13, 21], aliases: ["13-9"] },
  { name: "7#5#9", steps: [0, 4, 8, 10, 15], aliases: ["7alt", "alt", "alt7"] },
  { name: "7#5b9", steps: [0, 4, 8, 10, 13], aliases: ["7b9#5"] },
  { name: "7b9#11", steps: [0, 4, 7, 10, 13, 18], aliases: ["7b9b5"] },
];

const maskOf = (steps: readonly number[]) => steps.reduce((m, s) => m | (1 << mod12(s)), 0);
const BY_NAME = new Map<string, Quality>();
const BY_MASK = new Map<number, Quality>();
QUALITIES.forEach((q) => {
  BY_NAME.set(q.name, q);
  q.aliases.forEach((a) => BY_NAME.set(a, q));
  BY_MASK.set(maskOf(q.steps), q);
});
const rank = (q: Quality) => QUALITIES.indexOf(q);

/** The canonical quality names, simplest first. */
export const CHORD_QUALITIES: readonly string[] = QUALITIES.map((q) => q.name);

export interface ChordInfo {
  /** The canonical symbol: "Am7", "F/A", "G7b9". */
  symbol: string;
  root: string;
  /** Canonical quality: "" for major, "m", "maj7", "7b9" … */
  quality: string;
  /** Pitch classes of the chord tones, root first, in chord order. The bass is not added. */
  tones: number[];
  /** Semitones above the root, in chord order: 14 for a ninth. */
  steps: number[];
  /** Named only when it is not the root. */
  bass?: string;
}

function findQuality(text: string, root: string): Quality | null {
  const direct = BY_NAME.get(text);
  if (direct) return direct;
  // Tonal reads many more spellings; whatever it makes of this one is named from our own table.
  const chord = TonalChord.get(root + text);
  if (chord.empty || !chord.tonic) return null;
  const rootPc = pitchClassOf(chord.tonic);
  let mask = 0;
  for (const note of chord.notes) mask |= 1 << mod12(pitchClassOf(note) - rootPc);
  return BY_MASK.get(mask) ?? null;
}

/** Read a chord symbol in any common spelling. Null when it is not a chord this kernel knows. */
export function parseChord(symbol: string): ChordInfo | null {
  const text = symbol.trim().replace(/♯/g, "#").replace(/♭/g, "b");
  const head = /^([A-Ga-g][#b]?)(.*)$/.exec(text);
  if (!head) return null;
  const root = readNoteName(head[1])!;
  let rest = head[2];
  let bass: ReturnType<typeof readNoteName> = null;
  // A slash followed by a note name is a bass note; "6/9" is not.
  const slash = /^(.*)\/([A-Ga-g][#b]?)$/.exec(rest);
  if (slash) {
    bass = readNoteName(slash[2]);
    rest = slash[1];
  }
  const quality = findQuality(rest.replace(/\s+/g, ""), root.name);
  if (!quality) return null;
  const info: ChordInfo = {
    symbol: "",
    root: root.name,
    quality: quality.name,
    tones: quality.steps.map((s) => mod12(root.pc + s)),
    steps: [...quality.steps],
  };
  if (bass && bass.pc !== root.pc) info.bass = bass.name;
  info.symbol = formatChord(info);
  return info;
}

/** Write a chord the canonical way. The quality may be given in any spelling `parseChord` reads. */
export function formatChord(chord: { root: string; quality: string; bass?: string }): string {
  const root = readNoteName(chord.root);
  if (!root) throw new Error(`Not a note name: ${chord.root}`);
  const quality = findQuality(chord.quality, root.name);
  if (!quality) throw new Error(`Not a chord quality: ${chord.quality}`);
  const bass = chord.bass ? readNoteName(chord.bass) : null;
  return root.name + quality.name + (bass && bass.pc !== root.pc ? `/${bass.name}` : "");
}

/** The canonical form of a symbol, or null: what a ChordEvent stores. */
export function canonicalChord(symbol: string): string | null {
  return parseChord(symbol)?.symbol ?? null;
}

/** Every pitch in `range` (inclusive) that is a tone of the chord, lowest first. */
export function chordTones(symbol: string, range: [number, number]): number[] {
  const chord = parseChord(symbol);
  if (!chord) return [];
  const out: number[] = [];
  for (let p = Math.ceil(range[0]); p <= range[1]; p++) if (chord.tones.includes(mod12(p))) out.push(p);
  return out;
}

/**
 * Name the chord in a set of sounding pitches, most likely first. The lowest pitch is the bass: a
 * reading rooted on it comes before an inversion, and a simpler chord before a fancier one.
 * A chord missing its fifth is still recognised; a key, when given, decides how roots are spelled.
 */
export function detectChord(pitches: readonly number[], key?: Key): string[] {
  if (!pitches.length) return [];
  const bass = mod12(Math.min(...pitches));
  const pcs = [...new Set(pitches.map(mod12))];
  if (pcs.length < 2) return [];
  const found: { symbol: string; score: number }[] = [];
  const name = (pc: number) => spellPitchClass(pc, key);

  for (const root of pcs) {
    let mask = 0;
    for (const pc of pcs) mask |= 1 << mod12(pc - root);
    let quality = BY_MASK.get(mask);
    let penalty = 0;
    if (!quality && !(mask & (1 << 7)) && pcs.length >= 2) {
      // No fifth sounding: the ear supplies it.
      quality = BY_MASK.get(mask | (1 << 7));
      // …but only for chords with a third or a seventh to say what they are.
      if (quality && quality.steps.length < 3) quality = undefined;
      penalty = 100;
    }
    if (!quality) continue;
    const inverted = root !== bass;
    found.push({
      symbol: name(root) + quality.name + (inverted ? `/${name(bass)}` : ""),
      score: rank(quality) + penalty + (inverted ? 50 : 0),
    });
  }
  return found.sort((a, b) => a.score - b.score).map((f) => f.symbol);
}

// ── Roman numerals ───────────────────────────────────────────────────────────

const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII"];
const hasMinorThird = (q: Quality) => q.steps.includes(3) && !q.steps.includes(4);

/** How a quality is written after a numeral whose case already says major or minor. */
const ROMAN_SUFFIX: Record<string, string> = {
  m: "",
  dim: "°",
  dim7: "°7",
  m7b5: "ø7",
  aug: "+",
  mMaj7: "(maj7)",
  m7: "7",
};

/**
 * A chord's function in a key: `Am` in C major is "vi", `Bb` is "bVII". Degrees are counted in the
 * key's own scale, so in A minor `C` is "III" and `E` is "V". An inversion does not change the numeral.
 */
export function romanOf(symbol: string, key: Key): string | null {
  const chord = parseChord(symbol);
  if (!chord) return null;
  const quality = BY_NAME.get(chord.quality)!;
  const { index, alt } = degreeParts(mod12(pitchClassOf(chord.root) - tonicPc(key)), key.mode);
  const minor = hasMinorThird(quality);
  const numeral = minor ? NUMERALS[index].toLowerCase() : NUMERALS[index];
  const suffix = ROMAN_SUFFIX[quality.name] ?? (minor ? quality.name.replace(/^m/, "") : quality.name);
  return accidental(alt) + numeral + suffix;
}

/** The chord a Roman numeral names in a key: "bVII" in C major is `Bb`. Null when it cannot be read. */
export function chordOfRoman(roman: string, key: Key): string | null {
  const m = /^([#b]?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(.*)$/.exec(roman.trim());
  if (!m) return null;
  const lower = m[2] === m[2].toLowerCase();
  const index = NUMERALS.indexOf(m[2].toUpperCase());
  const alt = m[1] === "#" ? 1 : m[1] === "b" ? -1 : 0;
  const rootPc = mod12(tonicPc(key) + MODES[key.mode][index] + alt);
  const suffix = m[3];
  let qualityName: string;
  if (lower) {
    const special = Object.entries(ROMAN_SUFFIX).find(([q, s]) => s === suffix && q !== "aug");
    qualityName = suffix === "ø" ? "m7b5" : special ? special[0] : `m${suffix}`;
  } else {
    qualityName = suffix === "+" ? "aug" : suffix;
  }
  const root = spellPitchClass(rootPc, key);
  const quality = findQuality(qualityName, root);
  if (!quality || (lower && !hasMinorThird(quality))) return null;
  return root + quality.name;
}

// ── The palette ──────────────────────────────────────────────────────────────

/** The seven chords built on a key's own scale, as triads or as sevenths. */
export function diatonicChords(key: Key, opts: { sevenths?: boolean } = {}): string[] {
  const steps = MODES[key.mode];
  const names = scaleNames(key);
  const at = (i: number) => steps[i % 7] + 12 * Math.floor(i / 7);
  return steps.map((rootStep, i) => {
    const stack = [0, 2, 4, ...(opts.sevenths ? [6] : [])].map((n) => at(i + n) - rootStep);
    return names[i] + (BY_MASK.get(maskOf(stack))?.name ?? "");
  });
}

const BORROWED: Partial<Record<Mode, string[]>> = {
  // From the parallel minor, most used first; then the Neapolitan.
  major: ["bVII", "iv", "bVI", "bIII", "v", "bII"],
  // The major dominant, the Dorian IV and ii, the Neapolitan, the leading-tone chord, the Picardy I.
  minor: ["V", "V7", "IV", "ii", "bII", "#vii°", "I"],
};

/** Chords from outside the key that songs in it commonly use, most common first. */
export function borrowedChords(key: Key): string[] {
  const listed = BORROWED[key.mode];
  if (listed) return listed.map((r) => chordOfRoman(r, key)!).filter(Boolean);
  // For the other modes: whatever the parallel major and minor have that this mode does not.
  const own = new Set(diatonicChords(key).map((c) => chordKey(c)));
  const out: string[] = [];
  for (const mode of ["major", "minor"] as const) {
    for (const chord of diatonicChords({ tonic: key.tonic, mode })) {
      if (own.has(chordKey(chord))) continue;
      own.add(chordKey(chord));
      const p = parseChord(chord)!;
      out.push(spellPitchClass(pitchClassOf(p.root), key) + p.quality);
    }
  }
  return out;
}

/** Two spellings of one chord compare equal by this. */
function chordKey(symbol: string): string {
  const p = parseChord(symbol);
  return p ? `${pitchClassOf(p.root)}:${p.quality}` : symbol;
}

export interface Substitute {
  symbol: string;
  /** Why it can stand in: the UI turns this into plain words. */
  kind: "relative" | "mediant" | "tritone" | "leadingTone" | "suspended" | "parallel";
  /** Whether every tone of it belongs to the key. */
  inKey: boolean;
}

/** Chords that can stand in for one, each with the reason. */
export function substitutesFor(symbol: string, key: Key): Substitute[] {
  const chord = parseChord(symbol);
  if (!chord) return [];
  const root = pitchClassOf(chord.root);
  const quality = BY_NAME.get(chord.quality)!;
  const minor = hasMinorThird(quality);
  const major = quality.steps.includes(4);
  const dominant = major && quality.steps.includes(10);
  const seventh = quality.steps.includes(10) || quality.steps.includes(11);
  const scale = new Set(scaleOf(key));
  const out: Substitute[] = [];
  const add = (rootPc: number, q: string, kind: Substitute["kind"]) => {
    const s = spellPitchClass(mod12(rootPc), key) + q;
    const p = parseChord(s);
    if (!p || chordKey(s) === chordKey(chord.symbol) || out.some((o) => chordKey(o.symbol) === chordKey(s))) return;
    out.push({ symbol: p.symbol, kind, inKey: p.tones.every((t) => scale.has(t)) });
  };

  if (dominant) {
    add(root + 6, "7", "tritone");
    add(root + 4, "dim", "leadingTone");
  } else if (major) {
    add(root + 9, seventh ? "m7" : "m", "relative");
    add(root + 4, seventh ? "m7" : "m", "mediant");
  } else if (minor && quality.name !== "dim" && quality.name !== "dim7" && quality.name !== "m7b5") {
    add(root + 3, seventh ? "maj7" : "", "relative");
    add(root + 8, seventh ? "maj7" : "", "mediant");
  }
  if (quality.name === "" || quality.name === "m") {
    add(root, "sus4", "suspended");
    add(root, minor ? "" : "m", "parallel");
  }
  // Those that stay in the key first.
  return out.sort((a, b) => Number(b.inKey) - Number(a.inKey));
}

// ── Key finding ──────────────────────────────────────────────────────────────

/** Temperley's revision of the Krumhansl–Kessler key profiles ("What's Key for Key?", 1999). */
const MAJOR_PROFILE = [5, 2, 3.5, 2, 4.5, 4, 2, 4.5, 2, 3.5, 1.5, 4];
const MINOR_PROFILE = [5, 2, 3.5, 4.5, 2, 4, 2, 4.5, 3.5, 2, 1.5, 4];
const MAJOR_TONICS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MINOR_TONICS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];
/** How sharply confidence separates keys whose fit is close. */
const KEY_TEMPERATURE = 0.06;

export interface KeyNote {
  pitch: number;
  /** Length, in whatever unit `tick` is in: longer notes count for more. */
  dur: number;
  tick?: number;
}

export interface KeyGuess {
  key: Key;
  /** Correlation of the notes' pitch-class profile with this key's, -1..1. */
  score: number;
  /** 0..1, summing to 1 over all 24 keys: how far this key stands out from the rest. */
  confidence: number;
}

function correlation(a: number[], b: number[]): number {
  const ma = a.reduce((s, x) => s + x, 0) / a.length;
  const mb = b.reduce((s, x) => s + x, 0) / b.length;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/**
 * The key of some notes, likeliest first: their duration-weighted pitch-class profile matched
 * against major and minor key profiles (Krumhansl–Schmuckler). With `window`, only what sounds
 * between two ticks counts. Empty when there are no notes.
 */
export function detectKey(
  notes: readonly KeyNote[],
  opts: { window?: { start: number; end: number } } = {},
): KeyGuess[] {
  const profile = new Array<number>(12).fill(0);
  const w = opts.window;
  for (const n of notes) {
    let weight = Math.max(n.dur, 0);
    if (w) {
      const start = n.tick ?? 0;
      weight = Math.max(0, Math.min(start + n.dur, w.end) - Math.max(start, w.start));
    }
    profile[mod12(n.pitch)] += weight;
  }
  if (!profile.some((x) => x > 0)) return [];

  const guesses: KeyGuess[] = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = profile.map((_, i) => profile[(i + tonic) % 12]);
    guesses.push({
      key: { tonic: MAJOR_TONICS[tonic], mode: "major" },
      score: correlation(rotated, MAJOR_PROFILE),
      confidence: 0,
    });
    guesses.push({
      key: { tonic: MINOR_TONICS[tonic], mode: "minor" },
      score: correlation(rotated, MINOR_PROFILE),
      confidence: 0,
    });
  }
  guesses.sort((a, b) => b.score - a.score);
  const weights = guesses.map((g) => Math.exp((g.score - guesses[0].score) / KEY_TEMPERATURE));
  const total = weights.reduce((s, x) => s + x, 0);
  guesses.forEach((g, i) => (g.confidence = weights[i] / total));
  return guesses;
}

/**
 * Where the key changes: the key of each window of `windowTicks`, stepping half a window at a time,
 * reported when a new key holds for two windows running. The first entry is the opening key.
 */
export function findKeyChanges(
  notes: readonly (KeyNote & { tick: number })[],
  windowTicks: number,
): { tick: number; key: Key }[] {
  if (!notes.length || windowTicks <= 0) return [];
  const end = Math.max(...notes.map((n) => n.tick + n.dur));
  const hop = windowTicks / 2;
  const out: { tick: number; key: Key }[] = [];
  let pending: { tick: number; key: Key } | null = null;
  for (let start = 0; start < end; start += hop) {
    const best = detectKey(notes, { window: { start, end: start + windowTicks } })[0];
    if (!best) continue;
    const current = out[out.length - 1];
    if (!current) {
      out.push({ tick: 0, key: best.key });
    } else if (keyName(best.key) === keyName(current.key)) {
      pending = null;
    } else if (pending && keyName(pending.key) === keyName(best.key)) {
      out.push(pending);
      pending = null;
    } else {
      pending = { tick: start, key: best.key };
    }
  }
  return out;
}

/** Whether two keys share all their notes: C major and A minor. */
export function areRelative(a: Key, b: Key): boolean {
  if (a.mode === b.mode) return false;
  const sa = [...scaleOf(a)].sort((x, y) => x - y).join();
  const sb = [...scaleOf(b)].sort((x, y) => x - y).join();
  return sa === sb;
}

// ── Reading a project ────────────────────────────────────────────────────────

/** The chord sounding at a tick, or null. */
export function chordAt(project: Pick<Project, "chords">, tick: number): ChordEvent | null {
  let found: ChordEvent | null = null;
  for (const c of project.chords) {
    if (c.tick > tick) break;
    if (tick < c.tick + c.dur) found = c;
  }
  return found;
}

/** The key in force at a tick. C major when the project names none. */
export function keyAt(project: Pick<Project, "key">, tick: number): Key {
  let found: Key = { tonic: "C", mode: "major" };
  let at = -Infinity;
  for (const k of project.key) {
    if (k.tick <= tick && k.tick >= at) {
      found = { tonic: k.tonic, mode: k.mode };
      at = k.tick;
    }
  }
  if (at === -Infinity && project.key.length) {
    const first = [...project.key].sort((a, b) => a.tick - b.tick)[0];
    found = { tonic: first.tonic, mode: first.mode };
  }
  return found;
}

/**
 * How strong a place in the bar a tick is, 0..1: the downbeat 1, the middle of an even bar 0.75,
 * other beats 0.5, the half-beat 0.25, quarters of a beat 0.125, anything finer 0.06.
 */
export function metricWeight(tick: number, time: TimeMap): number {
  const pos = time.positionAt(tick);
  const meter = time.meterAt(tick);
  if (pos.tick === 0) {
    if (pos.beat === 1) return 1;
    const n = meter.numerator;
    // 4/4 leans on beat 3; 6/8 on its fourth eighth; 12/8 on 4, 7 and 10; 9/8 on 4 and 7.
    const compound = meter.denominator >= 8 && n % 3 === 0 && n > 3;
    if (compound ? (pos.beat - 1) % 3 === 0 : n % 2 === 0 && n > 2 && pos.beat - 1 === n / 2) return 0.75;
    return 0.5;
  }
  const beat = ticksPerBeat(meter);
  if (pos.tick * 2 === beat) return 0.25;
  if ((pos.tick * 4) % beat === 0) return 0.125;
  return 0.06;
}
