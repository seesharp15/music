/**
 * Twenty-four short melodies with known keys, for testing key finding: twelve major, twelve minor,
 * one on each tonic. Written as scale degrees so the key is certain; `realize` turns one into notes.
 *
 * A degree is "5", "b3", "#4" … counted against the MAJOR scale of the tonic (so a minor tune writes
 * its third as "b3"), with "'" to go up an octave and "," to go down. The number after the colon is
 * the length in eighth notes.
 */
export interface MelodyFixture {
  name: string;
  tonic: string;
  mode: "major" | "minor";
  tune: string;
}

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const TONIC_PC: Record<string, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  Bb: 10,
  B: 11,
};

/** The notes of a fixture: pitches around middle C, ticks at 240 to the eighth. */
export function realize(f: MelodyFixture): { pitch: number; tick: number; dur: number }[] {
  const base = 60 + ((TONIC_PC[f.tonic] + 6) % 12) - 6;
  let tick = 0;
  return f.tune
    .trim()
    .split(/\s+/)
    .map((token) => {
      const m = /^([#b]?)([1-7])([',]*):(\d+)$/.exec(token);
      if (!m) throw new Error(`Bad token "${token}" in ${f.name}`);
      const alt = m[1] === "#" ? 1 : m[1] === "b" ? -1 : 0;
      const octave = [...m[3]].reduce((s, c) => s + (c === "'" ? 1 : -1), 0);
      const dur = Number(m[4]) * 240;
      const note = { pitch: base + MAJOR_STEPS[Number(m[2]) - 1] + alt + 12 * octave, tick, dur };
      tick += dur;
      return note;
    });
}

export const MELODIES: MelodyFixture[] = [
  // ── Major ──
  {
    name: "Twinkle, Twinkle",
    tonic: "C",
    mode: "major",
    tune: "1:2 1:2 5:2 5:2 6:2 6:2 5:4 4:2 4:2 3:2 3:2 2:2 2:2 1:4",
  },
  {
    name: "Ode to Joy",
    tonic: "D",
    mode: "major",
    tune: "3:2 3:2 4:2 5:2 5:2 4:2 3:2 2:2 1:2 1:2 2:2 3:2 3:3 2:1 2:4",
  },
  {
    name: "Frère Jacques",
    tonic: "F",
    mode: "major",
    tune: "1:2 2:2 3:2 1:2 1:2 2:2 3:2 1:2 3:2 4:2 5:4 3:2 4:2 5:4 5:1 6:1 5:1 4:1 3:2 1:2 1:2 5,:2 1:4",
  },
  {
    name: "Mary Had a Little Lamb",
    tonic: "G",
    mode: "major",
    tune: "3:2 2:2 1:2 2:2 3:2 3:2 3:4 2:2 2:2 2:4 3:2 5:2 5:4 3:2 2:2 1:2 2:2 3:2 3:2 3:2 3:2 2:2 2:2 3:2 2:2 1:8",
  },
  {
    name: "Amazing Grace",
    tonic: "Eb",
    mode: "major",
    tune: "5,:2 1:4 3:1 1:1 3:4 2:2 1:4 6,:2 5,:4 5,:2 1:4 3:1 1:1 3:4 2:2 5:8",
  },
  {
    name: "Oh! Susanna",
    tonic: "A",
    mode: "major",
    tune: "1:1 2:1 3:2 5:2 5:3 6:1 5:2 3:2 1:3 2:1 3:2 3:2 2:2 1:2 2:6 1:1 2:1 3:2 5:2 5:3 6:1 5:2 3:2 1:3 2:1 3:2 3:2 2:2 2:2 1:6",
  },
  {
    name: "Row, Row, Row Your Boat",
    tonic: "Bb",
    mode: "major",
    tune: "1:3 1:3 1:2 2:1 3:3 3:2 2:1 3:2 4:1 5:6 1':1 1':1 1':1 5:1 5:1 5:1 3:1 3:1 3:1 1:1 1:1 1:1 5:2 4:1 3:2 2:1 1:6",
  },
  {
    name: "London Bridge",
    tonic: "E",
    mode: "major",
    tune: "5:3 6:1 5:2 4:2 3:2 4:2 5:4 2:2 3:2 4:4 3:2 4:2 5:4 5:3 6:1 5:2 4:2 3:2 4:2 5:4 2:4 5:4 3:2 1:6",
  },
  {
    name: "Joy to the World",
    tonic: "Ab",
    mode: "major",
    tune: "1':4 7:3 6:1 5:6 4:2 3:4 2:4 1:6 5:2 6:6 6:2 7:6 7:2 1':8",
  },
  {
    name: "Yankee Doodle",
    tonic: "B",
    mode: "major",
    tune: "1:2 1:2 2:2 3:2 1:2 3:2 2:2 5,:2 1:2 1:2 2:2 3:2 1:4 7,:4 1:2 1:2 2:2 3:2 4:2 3:2 2:2 1:2 7,:2 5,:2 6,:2 7,:2 1:4 1:4",
  },
  {
    name: "Auld Lang Syne",
    tonic: "Db",
    mode: "major",
    tune: "5,:2 1:3 1:1 1:2 3:2 2:3 1:1 2:2 3:2 1:3 1:1 3:2 5:2 6:6 6:2 5:3 3:1 3:2 1:2 2:3 1:1 2:2 3:2 1:3 6,:1 6,:2 5,:2 1:6",
  },
  {
    name: "Simple Gifts",
    tonic: "F#",
    mode: "major",
    tune: "5,:1 5,:1 1:2 1:1 2:1 3:1 1:1 3:1 4:1 5:2 5:1 4:1 3:2 2:2 1:2 2:2 3:2 2:2 7,:2 5,:2 1:6",
  },

  // ── Minor ── (degrees against the major scale: b3, b6, b7; the raised 7 is plain "7")
  {
    name: "Greensleeves (natural minor)",
    tonic: "A",
    mode: "minor",
    tune: "1:2 b3:4 4:2 5:3 b6:1 5:2 4:4 2:2 b7,:3 1:1 2:2 b3:4 1:2 1:3 7,:1 1:2 2:4 7,:2 5,:4 1:2 b3:4 4:2 5:3 b6:1 5:2 4:4 2:2 b7,:3 1:1 2:2 b3:3 2:1 1:2 7,:3 6,:1 7,:2 1:8",
  },
  {
    name: "God Rest Ye Merry, Gentlemen",
    tonic: "E",
    mode: "minor",
    tune: "1:2 1:2 5:2 5:2 4:2 b3:2 2:2 1:2 b7,:2 1:2 2:2 b3:2 4:2 5:6 1:2 1:2 5:2 5:2 4:2 b3:2 2:2 1:2 b7,:2 1:2 2:2 b3:2 4:2 5:6",
  },
  {
    name: "House of the Rising Sun",
    tonic: "D",
    mode: "minor",
    tune: "1:2 1:4 2:2 b3:4 5:2 4:4 1:6 1':2 1':4 1':2 b7:4 5:2 5:10 1':2 1':4 1':2 b7:4 5:2 4:4 1:6 1:2 1:2 b3:2 2:4 1:2 7,:6 1:8",
  },
  {
    name: "Wayfaring Stranger",
    tonic: "G",
    mode: "minor",
    tune: "1:2 1:2 b3:2 4:2 5:6 5:2 4:2 b3:2 4:2 5:2 1:8 1:2 b3:2 4:2 5:6 b7:2 5:2 4:2 b3:2 1:2 1:8",
  },
  {
    name: "Coventry Carol",
    tonic: "B",
    mode: "minor",
    tune: "1:4 1:2 7,:4 1:2 b3:4 2:2 1:6 2:4 b3:2 4:4 b3:2 2:6 5:4 4:2 b3:4 2:2 1:4 7,:2 1:6",
  },
  {
    name: "Minor Twinkle",
    tonic: "C",
    mode: "minor",
    tune: "1:2 1:2 5:2 5:2 b6:2 b6:2 5:4 4:2 4:2 b3:2 b3:2 2:2 2:2 1:4 5:2 5:2 4:2 4:2 b3:2 b3:2 2:4",
  },
  {
    name: "Hatikvah",
    tonic: "F",
    mode: "minor",
    tune: "1:1 2:1 b3:1 4:1 5:2 5:2 b6:1 5:1 b6:1 1':1 5:4 4:2 4:2 b3:2 b3:2 2:1 1:1 2:1 b3:1 1:4",
  },
  {
    name: "Erie Canal",
    tonic: "F#",
    mode: "minor",
    tune: "5,:2 1:2 1:2 1:2 b3:2 2:2 1:2 b7,:2 5,:2 1:2 1:2 1:2 b3:2 2:2 1:4 5:2 5:2 4:2 b3:2 4:2 b3:2 2:2 1:2 b7,:2 1:2 2:2 b3:2 2:2 1:6",
  },
  {
    name: "Minor waltz",
    tonic: "Bb",
    mode: "minor",
    tune: "5:2 b3:2 1:2 5:2 b3:2 1:2 b6:2 4:2 2:2 5:6 5:2 b3:2 1:2 b7:2 5:2 b3:2 4:2 2:2 7,:2 1:6",
  },
  {
    name: "Shady Grove (aeolian)",
    tonic: "C#",
    mode: "minor",
    tune: "1:2 1:1 b7,:1 1:2 b3:2 4:2 5:2 4:4 b3:2 b3:1 2:1 1:2 b7,:2 1:2 2:2 1:4 5:2 5:1 4:1 b3:2 4:2 5:2 b7:2 5:4 b6:2 5:1 4:1 b3:2 2:2 1:8",
  },
  {
    name: "When Johnny Comes Marching Home",
    tonic: "Eb",
    mode: "minor",
    tune: "5,:1 1:2 1:1 1:2 2:1 b3:2 2:1 b3:2 4:1 5:6 5:2 4:1 b3:6 5,:1 1:2 1:1 1:2 2:1 b3:2 2:1 b3:2 4:1 5:6 b7:2 b6:1 5:6 4:2 b3:1 2:2 1:1 1:6",
  },
  {
    name: "Minor lament",
    tonic: "G#",
    mode: "minor",
    tune: "1:4 b3:2 2:2 1:4 5,:4 b6,:2 1:2 b3:2 2:2 1:8 5:4 b6:2 5:2 4:2 b3:2 2:4 b3:2 2:2 1:2 7,:2 1:8",
  },
];
