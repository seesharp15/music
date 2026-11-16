import { describe, expect, it } from "vitest";
import { MELODIES, realize } from "./fixtures/melodies";
import {
  areRelative,
  borrowedChords,
  canonicalChord,
  CHORD_QUALITIES,
  chordAt,
  chordOfRoman,
  chordTones,
  degreeOf,
  detectChord,
  detectKey,
  diatonicChords,
  findKeyChanges,
  formatChord,
  interval,
  keyAt,
  keyName,
  metricWeight,
  parseChord,
  parseKey,
  pitchClassOf,
  pitchOfDegree,
  romanOf,
  scaleNames,
  scaleOf,
  spell,
  spellPitchClass,
  substitutesFor,
  transposeDiatonic,
  type Key,
} from "./theory";
import { makeTimeMap } from "./time";

const C: Key = { tonic: "C", mode: "major" };
const Am: Key = { tonic: "A", mode: "minor" };

const LETTERS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** "C3 Eb3 G3" → MIDI pitches. */
function p(text: string): number[] {
  return text.split(" ").map((t) => {
    const m = /^([A-G])([#b]?)(\d)$/.exec(t)!;
    return LETTERS[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + 12 * (Number(m[3]) + 1);
  });
}
const pcs = (pitches: number[]) => [...new Set(pitches.map((x) => x % 12))].sort((a, b) => a - b);

describe("keys and scales", () => {
  it("reads key names", () => {
    expect(parseKey("A minor")).toEqual(Am);
    expect(parseKey("F# dorian")).toEqual({ tonic: "F#", mode: "dorian" });
    expect(parseKey("Bb")).toEqual({ tonic: "Bb", mode: "major" });
    expect(parseKey("am")).toEqual(Am);
    expect(parseKey("e♭ major")).toEqual({ tonic: "Eb", mode: "major" });
    expect(parseKey("H major")).toBeNull();
    expect(parseKey("C wibble")).toBeNull();
    expect(keyName(Am)).toBe("A minor");
    expect(parseKey(keyName({ tonic: "Db", mode: "lydian" }))).toEqual({ tonic: "Db", mode: "lydian" });
  });

  it("gives the pitch classes and names of a scale", () => {
    expect(scaleOf(C)).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(scaleOf(Am)).toEqual([9, 11, 0, 2, 4, 5, 7]);
    expect(scaleOf({ tonic: "D", mode: "dorian" })).toEqual([2, 4, 5, 7, 9, 11, 0]);
    expect(scaleNames({ tonic: "F#", mode: "major" })).toEqual(["F#", "G#", "A#", "B", "C#", "D#", "E#"]);
    expect(scaleNames({ tonic: "Gb", mode: "major" })).toEqual(["Gb", "Ab", "Bb", "Cb", "Db", "Eb", "F"]);
    expect(scaleNames({ tonic: "G", mode: "mixolydian" })).toEqual(["G", "A", "B", "C", "D", "E", "F"]);
    expect(pitchClassOf("Bb")).toBe(10);
    expect(pitchClassOf("X")).toBe(-1);
  });

  it("names scale degrees, with accidentals outside the scale", () => {
    expect([60, 62, 64, 65, 67, 69, 71].map((x) => degreeOf(x, C))).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect([61, 63, 66, 68, 70].map((x) => degreeOf(x, C))).toEqual(["b2", "b3", "#4", "b6", "b7"]);
    // In a minor key degrees are counted in the minor scale: C is the 3 of A minor, C# its #3.
    expect([57, 59, 60, 62, 64, 65, 67].map((x) => degreeOf(x, Am))).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect([58, 61, 63, 66, 68].map((x) => degreeOf(x, Am))).toEqual(["b2", "#3", "#4", "#6", "#7"]);
  });

  it("finds the pitch of a degree nearest a given pitch", () => {
    expect(pitchOfDegree("5", C, 60)).toBe(55);
    expect(pitchOfDegree("5", C, 62)).toBe(67);
    expect(pitchOfDegree("5", C, 59)).toBe(55);
    expect(pitchOfDegree("b7", C, 72)).toBe(70);
    expect(pitchOfDegree("3", Am, 60)).toBe(60);
    expect(pitchOfDegree("#7", Am, 69)).toBe(68);
    expect(() => pitchOfDegree("9", C, 60)).toThrow();
    for (let pitch = 40; pitch < 90; pitch++) {
      for (const key of [C, Am, { tonic: "Eb", mode: "dorian" } as Key]) {
        expect(pitchOfDegree(degreeOf(pitch, key), key, pitch)).toBe(pitch);
      }
    }
  });

  it("spells notes to fit the key", () => {
    expect(spell(60)).toBe("C4");
    expect(spell(66, { tonic: "D", mode: "major" })).toBe("F#4");
    expect(spell(66, { tonic: "Db", mode: "major" })).toBe("Gb4");
    expect(spell(70, { tonic: "F", mode: "major" })).toBe("Bb4");
    expect(spell(68, Am)).toBe("G#4");
    expect(spell(63, { tonic: "C", mode: "minor" })).toBe("Eb4");
    // Octaves belong to the letter.
    expect(spell(59, { tonic: "Gb", mode: "major" })).toBe("Cb4");
    expect(spell(65, { tonic: "F#", mode: "major" })).toBe("E#4");
    expect(spell(21)).toBe("A0");
    expect(spell(108)).toBe("C8");
    expect(spellPitchClass(1, { tonic: "A", mode: "major" })).toBe("C#");
    expect(spellPitchClass(10, C)).toBe("Bb");
    expect(spellPitchClass(6, C)).toBe("F#");
  });
});

describe("intervals", () => {
  it("names the interval between two pitches", () => {
    expect(interval(60, 64)).toEqual({ semitones: 4, name: "M3" });
    expect(interval(64, 60)).toEqual({ semitones: -4, name: "M3" });
    expect(interval(60, 66).name).toBe("TT");
    expect(interval(60, 72).name).toBe("P8");
    expect(interval(60, 74).name).toBe("M9");
    expect(interval(60, 60)).toEqual({ semitones: 0, name: "P1" });
  });

  it("moves by scale steps within a key", () => {
    expect(transposeDiatonic(60, 1, C)).toBe(62);
    expect(transposeDiatonic(60, 2, C)).toBe(64);
    expect(transposeDiatonic(64, 1, C)).toBe(65);
    expect(transposeDiatonic(71, 1, C)).toBe(72);
    expect(transposeDiatonic(60, -1, C)).toBe(59);
    expect(transposeDiatonic(60, 7, C)).toBe(72);
    expect(transposeDiatonic(60, -8, C)).toBe(47);
    expect(transposeDiatonic(69, 2, Am)).toBe(72);
    // A triad shape stays a triad of the key: C E G up a step is D F A.
    expect([60, 64, 67].map((x) => transposeDiatonic(x, 1, C))).toEqual([62, 65, 69]);
    // An altered note keeps its alteration: Db up a step is Eb.
    expect(transposeDiatonic(61, 1, C)).toBe(63);
    // Notes of the scale come back where they started.
    for (let pitch = 40; pitch < 90; pitch++) {
      if (degreeOf(pitch, C).length === 1) expect(transposeDiatonic(transposeDiatonic(pitch, 3, C), -3, C)).toBe(pitch);
    }
  });
});

/**
 * Acceptance criterion 4: sixty chords, each given as its canonical symbol and a voicing with the
 * bass lowest. `parseChord` must say the symbol has exactly those notes; `detectChord` must name
 * those notes with exactly that symbol.
 */
const CHORDS: [string, string][] = [
  // triads
  ["C", "C3 E3 G3"],
  ["Gm", "G2 Bb2 D3"],
  ["Bdim", "B2 D3 F3"],
  ["Ebaug", "Eb3 G3 B3"],
  ["Dsus4", "D3 G3 A3"],
  ["Asus2", "A2 B2 E3"],
  ["E5", "E2 B2 E3"],
  ["F#m", "F#2 A2 C#3"],
  ["Ab", "Ab2 C3 Eb3"],
  ["Bb", "Bb2 D3 F3 Bb3"],
  ["Em", "E2 B2 E3 G3"],
  // sixths
  ["C6", "C3 E3 G3 A3"],
  ["Dm6", "D3 F3 A3 B3"],
  ["F6/9", "F2 A2 C3 D3 G3"],
  ["Am6/9", "A2 C3 E3 F#3 B3"],
  // sevenths
  ["G7", "G2 B2 D3 F3"],
  ["Cmaj7", "C3 E3 G3 B3"],
  ["Dm7", "D3 F3 A3 C4"],
  ["Bm7b5", "B2 D3 F3 A3"],
  ["Ddim7", "D3 F3 Ab3 B3"],
  ["AmMaj7", "A2 C3 E3 G#3"],
  ["E7sus4", "E2 A2 B2 D3"],
  ["Bb7", "Bb2 D3 F3 Ab3"],
  ["Ebmaj7", "Eb3 G3 Bb3 D4"],
  ["F#m7", "F#2 A2 C#3 E3"],
  ["Abmaj7", "Ab2 C3 Eb3 G3"],
  ["D7", "D3 F#3 A3 C4"],
  ["Am7", "A2 C3 E3 G3"],
  // added tones
  ["Cadd9", "C3 E3 G3 D4"],
  ["Emadd9", "E2 G2 B2 F#3"],
  ["Gadd11", "G2 B2 C3 D3"],
  // ninths, elevenths, thirteenths
  ["G9", "G2 B2 D3 F3 A3"],
  ["Fmaj9", "F2 A2 C3 E3 G3"],
  ["Dm9", "D3 F3 A3 C4 E4"],
  ["A9sus4", "A2 D3 E3 G3 B3"],
  ["C11", "C3 E3 G3 Bb3 D4 F4"],
  ["Dm11", "D3 F3 A3 C4 E4 G4"],
  ["G13", "G2 B2 D3 F3 A3 E4"],
  ["Cmaj13", "C3 E3 G3 B3 D4 A4"],
  ["Em13", "E2 G2 B2 D3 F#3 C#4"],
  // altered dominants
  ["G7b9", "G2 B2 D3 F3 Ab3"],
  ["E7#9", "E2 G#2 B2 D3 G3"],
  ["C7b5", "C3 E3 Gb3 Bb3"],
  ["A7#5", "A2 C#3 F3 G3"],
  ["D7#11", "D3 F#3 A3 C4 G#4"],
  ["F7b13", "F2 A2 C3 Eb3 Db4"],
  ["Bb13b9", "Bb2 D3 F3 Ab3 B3 G4"],
  ["G7#5#9", "G2 B2 D#3 F3 A#3"],
  ["C9#11", "C3 E3 G3 Bb3 D4 F#4"],
  ["D7#5b9", "D3 F#3 A#3 C4 Eb4"],
  ["A7b9#11", "A2 C#3 E3 G3 Bb3 D#4"],
  // other colours
  ["Cmaj7#11", "C3 E3 G3 B3 F#4"],
  ["Fmaj7#5", "F2 A2 C#3 E3"],
  // slash chords
  ["C/E", "E2 G2 C3"],
  ["F/A", "A2 C3 F3"],
  ["G/B", "B2 D3 G3"],
  ["D/F#", "F#2 A2 D3"],
  ["Am/C", "C3 E3 A3"],
  ["C/G", "G2 C3 E3"],
  ["Dm7/C", "C3 D3 F3 A3"],
  ["G7/B", "B2 D3 F3 G3"],
  ["Cmaj7/E", "E2 G2 B2 C3"],
  ["Fm/Ab", "Ab2 C3 F3"],
  ["Bb/D", "D3 F3 Bb3"],
];

describe("chord symbols", () => {
  it("has a table of at least sixty chords, of every family", () => {
    expect(CHORDS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(CHORDS.map(([s]) => s)).size).toBe(CHORDS.length);
  });

  it.each(CHORDS)("%s: parseChord and detectChord agree", (symbol, voicing) => {
    const pitches = p(voicing);
    const parsed = parseChord(symbol)!;
    expect(parsed, "parses").not.toBeNull();
    expect(parsed.symbol, "is already canonical").toBe(symbol);
    const withBass = parsed.bass ? [...parsed.tones, pitchClassOf(parsed.bass)] : parsed.tones;
    expect(
      [...new Set(withBass)].sort((a, b) => a - b),
      "has the notes of the voicing",
    ).toEqual(pcs(pitches));
    if (parsed.bass) expect(pitchClassOf(parsed.bass)).toBe(Math.min(...pitches) % 12);
    else expect(pitchClassOf(parsed.root)).toBe(Math.min(...pitches) % 12);
    expect(detectChord(pitches)[0], "is what the notes are called").toBe(symbol);
  });

  it("no two qualities share a set of notes, so naming is never ambiguous", () => {
    const seen = new Map<string, string>();
    for (const q of CHORD_QUALITIES) {
      const key = pcs(parseChord(`C${q}`)!.tones).join();
      expect(seen.get(key), `${q} and ${seen.get(key)}`).toBeUndefined();
      seen.set(key, q);
    }
  });

  it("reads the many ways a chord is written, and writes one", () => {
    const same: [string, string][] = [
      ["CM7", "Cmaj7"],
      ["CΔ", "Cmaj7"],
      ["C-7", "Cm7"],
      ["Cmin7", "Cm7"],
      ["Cmin", "Cm"],
      ["CM", "C"],
      ["Cmaj", "C"],
      ["Cø", "Cm7b5"],
      ["Cø7", "Cm7b5"],
      ["C°", "Cdim"],
      ["Co7", "Cdim7"],
      ["C+", "Caug"],
      ["C+7", "C7#5"],
      ["Caug7", "C7#5"],
      ["Csus", "Csus4"],
      ["C7sus", "C7sus4"],
      ["C69", "C6/9"],
      ["Cadd2", "Cadd9"],
      ["CmM7", "CmMaj7"],
      ["Cm(maj7)", "CmMaj7"],
      ["C7alt", "C7#5#9"],
      ["c#m", "C#m"],
      ["B♭maj7", "Bbmaj7"],
      ["F♯m7", "F#m7"],
      [" Am7 ", "Am7"],
      ["C/C", "C"],
      ["C6/9/E", "C6/9/E"],
      ["Cm7/Bb", "Cm7/Bb"],
      ["Chalf-diminished", "Cm7b5"],
      ["C7b6", "C7b13"],
    ];
    for (const [written, canonical] of same) expect(canonicalChord(written), written).toBe(canonical);
  });

  it("refuses what is not a chord", () => {
    for (const bad of ["", "H", "Cxyz", "7", "C/", "Cmaj7/H", "hello"]) expect(parseChord(bad), bad).toBeNull();
    expect(canonicalChord("nope")).toBeNull();
  });

  it("gives root, quality, tones and bass", () => {
    expect(parseChord("F/A")).toEqual({
      symbol: "F/A",
      root: "F",
      quality: "",
      tones: [5, 9, 0],
      steps: [0, 4, 7],
      bass: "A",
    });
    expect(parseChord("G7b9")).toMatchObject({
      root: "G",
      quality: "7b9",
      tones: [7, 11, 2, 5, 8],
      steps: [0, 4, 7, 10, 13],
    });
    expect(parseChord("Am7")!.bass).toBeUndefined();
  });

  it("formats from parts", () => {
    expect(formatChord({ root: "a", quality: "min7" })).toBe("Am7");
    expect(formatChord({ root: "F", quality: "", bass: "A" })).toBe("F/A");
    expect(formatChord({ root: "F", quality: "M", bass: "F" })).toBe("F");
    expect(() => formatChord({ root: "F", quality: "wibble" })).toThrow();
    expect(() => formatChord({ root: "Q", quality: "" })).toThrow();
  });

  it("lists a chord's tones within a range", () => {
    expect(chordTones("C", [60, 72])).toEqual([60, 64, 67, 72]);
    expect(chordTones("Am7", [45, 57])).toEqual([45, 48, 52, 55, 57]);
    expect(chordTones("nope", [0, 127])).toEqual([]);
  });

  it("ranks other readings after the best one", () => {
    expect(detectChord(p("C3 E3 G3 A3"))).toEqual(["C6", "Am7/C"]);
    expect(detectChord(p("A2 C3 E3 G3"))).toEqual(["Am7", "C6/A"]);
    expect(detectChord(p("D3 G3 A3")).slice(0, 2)).toEqual(["Dsus4", "Gsus2/D"]);
  });

  it("hears a chord with no fifth, and says nothing of a single note", () => {
    expect(detectChord(p("C3 E3"))[0]).toBe("C");
    expect(detectChord(p("C3 Eb3"))[0]).toBe("Cm");
    expect(detectChord(p("C3 E3 Bb3"))[0]).toBe("C7");
    expect(detectChord(p("D3 F3 C4"))[0]).toBe("Dm7");
    expect(detectChord(p("C3 C4 C5"))).toEqual([]);
    expect(detectChord([])).toEqual([]);
    expect(detectChord(p("C3 Db3 D3"))).toEqual([]);
  });

  it("spells roots by the key when there is one", () => {
    expect(detectChord(p("C#3 F3 G#3"))[0]).toBe("Db");
    expect(detectChord(p("C#3 F3 G#3"), { tonic: "F#", mode: "major" })[0]).toBe("C#");
    expect(detectChord(p("G#2 B2 E3"), { tonic: "E", mode: "major" })[0]).toBe("E/G#");
    expect(detectChord(p("G#2 B2 D3"), Am)[0]).toBe("G#dim");
  });
});

describe("Roman numerals", () => {
  // Acceptance criterion 4, second half.
  it("is right for the diatonic chords of a major key", () => {
    expect(["C", "Dm", "Em", "F", "G", "Am", "Bdim"].map((c) => romanOf(c, C))).toEqual([
      "I",
      "ii",
      "iii",
      "IV",
      "V",
      "vi",
      "vii°",
    ]);
    expect(["Cmaj7", "Dm7", "Em7", "Fmaj7", "G7", "Am7", "Bm7b5"].map((c) => romanOf(c, C))).toEqual([
      "Imaj7",
      "ii7",
      "iii7",
      "IVmaj7",
      "V7",
      "vi7",
      "viiø7",
    ]);
  });

  it("is right for the diatonic chords of a minor key", () => {
    expect(["Am", "Bdim", "C", "Dm", "Em", "F", "G"].map((c) => romanOf(c, Am))).toEqual([
      "i",
      "ii°",
      "III",
      "iv",
      "v",
      "VI",
      "VII",
    ]);
    expect(["Am7", "Bm7b5", "Cmaj7", "Dm7", "Em7", "Fmaj7", "G7"].map((c) => romanOf(c, Am))).toEqual([
      "i7",
      "iiø7",
      "IIImaj7",
      "iv7",
      "v7",
      "VImaj7",
      "VII7",
    ]);
  });

  it("is right for the common borrowed chords", () => {
    // In C major: from the parallel minor, and the Neapolitan.
    expect(["Bb", "Fm", "Ab", "Eb", "Gm", "Db"].map((c) => romanOf(c, C))).toEqual([
      "bVII",
      "iv",
      "bVI",
      "bIII",
      "v",
      "bII",
    ]);
    // In A minor: the major dominant, the Dorian IV, the Neapolitan, the leading-tone chord, the Picardy third.
    expect(["E", "E7", "D", "Bb", "G#dim", "G#dim7", "A"].map((c) => romanOf(c, Am))).toEqual([
      "V",
      "V7",
      "IV",
      "bII",
      "#vii°",
      "#vii°7",
      "I",
    ]);
    // Secondary dominants, in C major.
    expect(["D7", "A7", "E7", "B7"].map((c) => romanOf(c, C))).toEqual(["II7", "VI7", "III7", "VII7"]);
  });

  it("works in every key, and ignores the inversion", () => {
    expect(romanOf("C#m", { tonic: "E", mode: "major" })).toBe("vi");
    expect(romanOf("Db", { tonic: "Gb", mode: "major" })).toBe("V");
    expect(romanOf("C#", { tonic: "F#", mode: "major" })).toBe("V");
    expect(romanOf("F/A", C)).toBe("IV");
    expect(romanOf("Caug", C)).toBe("I+");
    expect(romanOf("AmMaj7", Am)).toBe("i(maj7)");
    expect(romanOf("Dm9", C)).toBe("ii9");
    expect(romanOf("Gsus4", C)).toBe("Vsus4");
    expect(romanOf("nope", C)).toBeNull();
  });

  it("goes back from numeral to chord", () => {
    expect(chordOfRoman("vi", C)).toBe("Am");
    expect(chordOfRoman("bVII", C)).toBe("Bb");
    expect(chordOfRoman("V7", Am)).toBe("E7");
    expect(chordOfRoman("#vii°", Am)).toBe("G#dim");
    expect(chordOfRoman("iiø7", Am)).toBe("Bm7b5");
    expect(chordOfRoman("IV", { tonic: "F#", mode: "major" })).toBe("B");
    expect(chordOfRoman("iii", { tonic: "F#", mode: "major" })).toBe("A#m");
    expect(chordOfRoman("nonsense", C)).toBeNull();
    expect(chordOfRoman("Vwibble", C)).toBeNull();
  });

  it("round-trips every quality on every degree", () => {
    for (const key of [C, Am, { tonic: "Eb", mode: "major" } as Key, { tonic: "F#", mode: "minor" } as Key]) {
      for (let pc = 0; pc < 12; pc++) {
        for (const q of CHORD_QUALITIES) {
          const symbol = spellPitchClass(pc, key) + q;
          const roman = romanOf(symbol, key)!;
          expect(chordOfRoman(roman, key), `${symbol} → ${roman} in ${keyName(key)}`).toBe(symbol);
        }
      }
    }
  });
});

describe("the palette", () => {
  it("builds the diatonic chords of a key", () => {
    expect(diatonicChords(C)).toEqual(["C", "Dm", "Em", "F", "G", "Am", "Bdim"]);
    expect(diatonicChords(C, { sevenths: true })).toEqual(["Cmaj7", "Dm7", "Em7", "Fmaj7", "G7", "Am7", "Bm7b5"]);
    expect(diatonicChords(Am)).toEqual(["Am", "Bdim", "C", "Dm", "Em", "F", "G"]);
    expect(diatonicChords({ tonic: "D", mode: "dorian" })).toEqual(["Dm", "Em", "F", "G", "Am", "Bdim", "C"]);
    expect(diatonicChords({ tonic: "Eb", mode: "major" })).toEqual(["Eb", "Fm", "Gm", "Ab", "Bb", "Cm", "Ddim"]);
    expect(diatonicChords({ tonic: "F#", mode: "minor" }, { sevenths: true })).toEqual([
      "F#m7",
      "G#m7b5",
      "Amaj7",
      "Bm7",
      "C#m7",
      "Dmaj7",
      "E7",
    ]);
  });

  it("lists the chords commonly borrowed", () => {
    expect(borrowedChords(C)).toEqual(["Bb", "Fm", "Ab", "Eb", "Gm", "Db"]);
    expect(borrowedChords(Am)).toEqual(["E", "E7", "D", "Bm", "Bb", "G#dim", "A"]);
    const dorian = borrowedChords({ tonic: "D", mode: "dorian" });
    expect(dorian).toContain("D");
    expect(dorian).toContain("Bb");
    expect(dorian).not.toContain("Dm");
  });

  it("offers substitutes with reasons", () => {
    expect(substitutesFor("G7", C)).toEqual([
      { symbol: "Bdim", kind: "leadingTone", inKey: true },
      { symbol: "Db7", kind: "tritone", inKey: false },
    ]);
    expect(substitutesFor("C", C).map((s) => [s.symbol, s.kind])).toEqual([
      ["Am", "relative"],
      ["Em", "mediant"],
      ["Csus4", "suspended"],
      ["Cm", "parallel"],
    ]);
    expect(substitutesFor("Am7", C).map((s) => s.symbol)).toEqual(["Cmaj7", "Fmaj7"]);
    expect(substitutesFor("nope", C)).toEqual([]);
  });
});

describe("finding the key", () => {
  // Acceptance criterion 3.
  it("has twelve major and twelve minor melodies, one on each tonic", () => {
    for (const mode of ["major", "minor"] as const) {
      const tonics = MELODIES.filter((m) => m.mode === mode).map((m) => pitchClassOf(m.tonic));
      expect(new Set(tonics).size).toBe(12);
    }
    expect(MELODIES).toHaveLength(24);
  });

  it("names the key of at least 22 of the 24, with the relative key the only confusion", () => {
    let right = 0;
    const misses: string[] = [];
    for (const m of MELODIES) {
      const truth: Key = { tonic: m.tonic, mode: m.mode };
      const guesses = detectKey(realize(m));
      const same = (k: Key) => k.mode === truth.mode && pitchClassOf(k.tonic) === pitchClassOf(truth.tonic);
      if (same(guesses[0].key)) {
        right++;
        continue;
      }
      misses.push(`${m.name}: ${keyName(guesses[0].key)} for ${keyName(truth)}`);
      expect(areRelative(guesses[0].key, truth), `${m.name} was heard as ${keyName(guesses[0].key)}`).toBe(true);
      expect(same(guesses[1].key), `${m.name}: the true key should be runner-up`).toBe(true);
    }
    expect(right, misses.join("; ")).toBeGreaterThanOrEqual(22);
  });

  it("ranks all 24 keys with confidences that sum to 1", () => {
    const guesses = detectKey(realize(MELODIES[0]));
    expect(guesses).toHaveLength(24);
    expect(guesses.reduce((s, g) => s + g.confidence, 0)).toBeCloseTo(1, 9);
    expect(guesses[0].confidence).toBeGreaterThan(guesses[1].confidence);
    expect(guesses[0].score).toBeGreaterThan(0.6);
  });

  it("is unsure about a chromatic scale, and silent about nothing", () => {
    const chromatic = Array.from({ length: 12 }, (_, i) => ({ pitch: 60 + i, tick: i * 240, dur: 240 }));
    expect(detectKey(chromatic)[0].confidence).toBeLessThan(0.1);
    expect(detectKey([])).toEqual([]);
  });

  it("weighs long notes more than short ones", () => {
    // C and G held long with a passing F# reads as C; the same notes with the F# held does not.
    const withLongC = [
      { pitch: 60, tick: 0, dur: 1920 },
      { pitch: 64, tick: 1920, dur: 960 },
      { pitch: 67, tick: 2880, dur: 1920 },
      { pitch: 66, tick: 4800, dur: 60 },
      { pitch: 65, tick: 4860, dur: 480 },
      { pitch: 62, tick: 5340, dur: 480 },
    ];
    expect(keyName(detectKey(withLongC)[0].key)).toBe("C major");
  });

  it("looks only inside a window when given one", () => {
    const first = realize(MELODIES[0]); // C major
    const length = first[first.length - 1].tick + first[first.length - 1].dur;
    const second = realize(MELODIES[7]).map((n) => ({ ...n, tick: n.tick + length })); // E major
    const both = [...first, ...second];
    expect(keyName(detectKey(both, { window: { start: 0, end: length } })[0].key)).toBe("C major");
    expect(keyName(detectKey(both, { window: { start: length, end: length * 4 } })[0].key)).toBe("E major");
  });

  it("finds a key change", () => {
    const repeat = (i: number, times: number, from: number) => {
      const out: { pitch: number; tick: number; dur: number }[] = [];
      let at = from;
      for (let k = 0; k < times; k++) {
        const notes = realize(MELODIES[i]);
        for (const n of notes) out.push({ ...n, tick: n.tick + at });
        at += notes[notes.length - 1].tick + notes[notes.length - 1].dur;
      }
      return { notes: out, end: at };
    };
    const a = repeat(0, 3, 0); // C major
    const b = repeat(7, 2, a.end); // E major
    const changes = findKeyChanges([...a.notes, ...b.notes], 1920 * 4);
    expect(changes.map((c) => keyName(c.key))).toEqual(["C major", "E major"]);
    expect(changes[0].tick).toBe(0);
    expect(Math.abs(changes[1].tick - a.end)).toBeLessThanOrEqual(1920 * 4);
    expect(findKeyChanges([], 1920)).toEqual([]);
  });

  it("knows relative keys", () => {
    expect(areRelative(C, Am)).toBe(true);
    expect(areRelative({ tonic: "Eb", mode: "major" }, { tonic: "C", mode: "minor" })).toBe(true);
    expect(areRelative(C, { tonic: "C", mode: "minor" })).toBe(false);
    expect(areRelative(C, C)).toBe(false);
  });
});

describe("reading a project", () => {
  const chords = [
    { id: 1, tick: 0, dur: 1920, symbol: "C", origin: "manual" as const },
    { id: 2, tick: 1920, dur: 960, symbol: "Am", origin: "manual" as const },
    { id: 3, tick: 3840, dur: 1920, symbol: "F", origin: "manual" as const },
  ];
  it("finds the chord at a tick", () => {
    expect(chordAt({ chords }, 0)?.symbol).toBe("C");
    expect(chordAt({ chords }, 1919)?.symbol).toBe("C");
    expect(chordAt({ chords }, 1920)?.symbol).toBe("Am");
    expect(chordAt({ chords }, 3000)).toBeNull();
    expect(chordAt({ chords }, 9999)).toBeNull();
    expect(chordAt({ chords: [] }, 0)).toBeNull();
  });
  it("finds the key at a tick", () => {
    const key = [
      { tick: 0, tonic: "C", mode: "major" as const },
      { tick: 3840, tonic: "A", mode: "minor" as const },
    ];
    expect(keyAt({ key }, 0)).toEqual(C);
    expect(keyAt({ key }, 3839)).toEqual(C);
    expect(keyAt({ key }, 3840)).toEqual(Am);
    expect(keyAt({ key: [] }, 100)).toEqual(C);
    expect(keyAt({ key: [{ tick: 480, tonic: "G", mode: "major" }] }, 0)).toEqual({ tonic: "G", mode: "major" });
  });
});

describe("metricWeight", () => {
  it("ranks the places in a bar of 4/4", () => {
    const tm = makeTimeMap([{ tick: 0, bpm: 120 }], [{ tick: 0, numerator: 4, denominator: 4 }]);
    expect([0, 480, 960, 1440, 1920].map((t) => metricWeight(t, tm))).toEqual([1, 0.5, 0.75, 0.5, 1]);
    expect(metricWeight(240, tm)).toBe(0.25);
    expect(metricWeight(120, tm)).toBe(0.125);
    expect(metricWeight(360, tm)).toBe(0.125);
    expect(metricWeight(160, tm)).toBe(0.06);
  });
  it("ranks 3/4 and 6/8 by their own shape", () => {
    const waltz = makeTimeMap([{ tick: 0, bpm: 120 }], [{ tick: 0, numerator: 3, denominator: 4 }]);
    expect([0, 480, 960].map((t) => metricWeight(t, waltz))).toEqual([1, 0.5, 0.5]);
    const six = makeTimeMap([{ tick: 0, bpm: 120 }], [{ tick: 0, numerator: 6, denominator: 8 }]);
    expect([0, 240, 480, 720, 960, 1200].map((t) => metricWeight(t, six))).toEqual([1, 0.5, 0.5, 0.75, 0.5, 0.5]);
    expect(metricWeight(120, six)).toBe(0.25);
  });
});
