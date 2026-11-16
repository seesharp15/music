import { describe, expect, it } from "vitest";
import divenireJson from "../../public/songs/divenire.json";
import rewriteJson from "../../public/songs/rewrite-the-stars.json";
import { beatMapOf } from "../song/beatmap";
import { normalize } from "../song/normalize";
import { parseSong } from "../song/schema";
import type { Note, Song } from "../song/types";
import { compileProject } from "./compile";
import { projectFromSong } from "./fromSong";
import { newProject } from "./new";
import { applyOps } from "./ops";
import { checkProject, ProjectSchema } from "./schema";
import type { DrumTrack, EditOp, NoteTrack, Project } from "./types";

const rewrite = normalize(rewriteJson as unknown as Song);
const divenire = normalize(divenireJson as unknown as Song);
const NOW = new Date("2026-11-16T12:00:00Z");

// 120 BPM: a quarter note (480 ticks) is half a second, a tick is 1/960 s.
const fresh = (opts: Parameters<typeof newProject>[0] = {}) =>
  newProject({ id: "p1", title: "Test", bpm: 120, now: NOW, ...opts });
const n = (pitch: number, tick: number, dur = 480, extra: object = {}) => ({
  pitch,
  tick,
  dur,
  vel: 0.7,
  origin: "manual" as const,
  ...extra,
});
const add = (trackId: string, ...notes: ReturnType<typeof n>[]): EditOp => ({ op: "addNotes", trackId, notes });
const times = (song: Song) => song.notes.map((x) => [x.pitch, x.time, x.duration]);

describe("compileProject", () => {
  it("turns ticks into seconds, and names the song after the project", () => {
    const p = applyOps(fresh(), [add("melody", n(60, 0), n(62, 480), n(64, 960, 960))]);
    const song = compileProject(p);
    expect(times(song)).toEqual([
      [60, 0, 0.5],
      [62, 0.5, 0.5],
      [64, 1, 1],
    ]);
    expect(song).toMatchObject({
      format: "piano-song/v2",
      id: "u-p1",
      title: "Test",
      bpm: 120,
      timeSignature: [4, 4],
      key: "C major",
    });
    expect(song.duration).toBe(16); // eight bars of 4/4 at 120
    expect(song.origin).toEqual({ kind: "studio", projectId: "p1", createdAt: NOW.toISOString() });
    expect(song.tempoMap).toBeUndefined();
    expect(song.drums).toBeUndefined();
    expect(song.chords).toBeUndefined();
  });

  it("gives each note its track's hand, or its own, and its track id", () => {
    const p = applyOps(fresh(), [add("melody", n(72, 0), n(71, 480, 480, { hand: "L" })), add("bass", n(36, 0))]);
    const song = compileProject(p);
    expect(song.notes.map((x) => [x.pitch, x.hand, x.track])).toEqual([
      [36, "L", "bass"],
      [72, "R", "melody"],
      [71, "L", "melody"],
    ]);
    expect(song.tracks).toEqual([
      { id: "melody", name: "Melody", role: "melody", sound: "piano", volume: 0.8 },
      { id: "chords", name: "Chords", role: "chords", sound: "piano", volume: 0.8 },
      { id: "bass", name: "Bass", role: "bass", sound: "piano", volume: 0.8 },
    ]);
  });

  it("sorts by time then pitch, and passes normalize unchanged", () => {
    const p = applyOps(fresh(), [add("melody", n(67, 480), n(60, 480), n(64, 0)), add("chords", n(48, 480), n(52, 0))]);
    const song = compileProject(p);
    expect(song.notes.map((x) => [x.time, x.pitch])).toEqual([
      [0, 52],
      [0, 64],
      [0.5, 48],
      [0.5, 60],
      [0.5, 67],
    ]);
    expect(normalize(song)).toEqual(song);
    expect(parseSong(JSON.parse(JSON.stringify(song))).ok).toBe(true);
  });

  it("is deterministic, and does not change the project", () => {
    const p = applyOps(fresh(), [add("melody", n(60, 0), n(62, 480))]);
    const before = structuredClone(p);
    expect(compileProject(p)).toEqual(compileProject(p));
    expect(p).toEqual(before);
  });

  it("adds each note's offset, as far as its track's feel allows", () => {
    let p = applyOps(fresh(), [add("melody", n(60, 480, 480, { offset: 48 }), n(62, 960, 480, { offset: -96 }))]);
    expect(times(compileProject(p))).toEqual([
      [60, 0.55, 0.5],
      [62, 0.9, 0.5],
    ]);
    p = applyOps(p, [{ op: "patchTrack", trackId: "melody", patch: { feel: 0.5 } }]);
    expect(times(compileProject(p))).toEqual([
      [60, 0.525, 0.5],
      [62, 0.95, 0.5],
    ]);
    p = applyOps(p, [{ op: "patchTrack", trackId: "melody", patch: { feel: 0 } }]);
    expect(times(compileProject(p))).toEqual([
      [60, 0.5, 0.5],
      [62, 1, 0.5],
    ]);
  });

  it("never starts a note before the start of the song", () => {
    const p = applyOps(fresh(), [add("melody", n(60, 0, 480, { offset: -50 }))]);
    const [note] = compileProject(p).notes;
    expect(note.time).toBe(0);
    expect(note.duration).toBeGreaterThan(0);
  });

  it("swings the off-beats, long then short", () => {
    const p = applyOps(fresh(), [
      { op: "patchSong", patch: { swing: { amount: 2 / 3, unit: 8 } } },
      add("melody", n(60, 0, 240), n(62, 240, 240), n(64, 480, 240), n(65, 720, 240)),
    ]);
    const song = compileProject(p);
    // A beat is 0.5 s: the pair divides 1/3 s + 1/6 s, and the notes still meet end to end.
    expect(song.notes.map((x) => x.time)).toEqual([0, 0.333333, 0.5, 0.833333]);
    expect(song.notes.map((x) => x.duration)).toEqual([0.333333, 0.166667, 0.333333, 0.166667]);
  });

  it("plays a groove's timing and accents", () => {
    const p = applyOps(fresh(), [
      {
        op: "patchSong",
        patch: {
          groove: { unit: 8, offsets: [0, 24, 0, 24, 0, 24, 0, 24], accents: [1.2, 0.5, 1, 0.5, 1, 0.5, 1, 0.5] },
        },
      },
      add("melody", n(60, 0, 240), n(62, 240, 240)),
    ]);
    const song = compileProject(p);
    expect(song.notes.map((x) => x.time)).toEqual([0, 0.275]);
    expect(song.notes.map((x) => x.velocity)).toEqual([0.84, 0.35]);
  });

  it("straight leaves out swing, groove and offsets", () => {
    const p = applyOps(fresh(), [
      {
        op: "patchSong",
        patch: { swing: { amount: 0.66, unit: 8 }, groove: { unit: 8, offsets: [0, 30], accents: [1, 0.5] } },
      },
      add("melody", n(60, 0, 240, { offset: 10 }), n(62, 240, 240, { offset: -10 })),
    ]);
    expect(times(compileProject(p, { straight: true }))).toEqual([
      [60, 0, 0.25],
      [62, 0.25, 0.25],
    ]);
    expect(compileProject(p, { straight: true }).notes.map((x) => x.velocity)).toEqual([0.7, 0.7]);
  });

  it("follows a tempo change, and says so in the song", () => {
    const p = applyOps(fresh(), [
      {
        op: "patchSong",
        patch: {
          tempo: [
            { tick: 0, bpm: 120 },
            { tick: 1920, bpm: 60 },
          ],
        },
      },
      add("melody", n(60, 0), n(62, 1920), n(64, 2400)),
    ]);
    const song = compileProject(p);
    expect(times(song)).toEqual([
      [60, 0, 0.5],
      [62, 2, 1],
      [64, 3, 1],
    ]);
    expect(song.bpm).toBe(120);
    expect(song.tempoMap).toEqual([
      { time: 0, bpm: 120 },
      { time: 2, bpm: 60 },
    ]);
    // Practice counts along through the change: beat 4 at 2 s, beat 5 at 3 s.
    const beats = beatMapOf(song)!;
    expect(beats.beatAt(2)).toBeCloseTo(4, 9);
    expect(beats.beatAt(3)).toBeCloseTo(5, 9);
  });

  it("counts a song's tempo in the beat its time signature names", () => {
    // 6/8 at 80 quarter notes a minute is 160 eighths a minute, six to the bar.
    const song = compileProject(fresh({ bpm: 80, meter: [6, 8], bars: 2 }));
    expect(song).toMatchObject({ bpm: 160, timeSignature: [6, 8] });
    const beats = beatMapOf(song)!;
    expect(beats.beatsPerBar).toBe(6);
    expect(beats.secondsAt(6)).toBeCloseTo(song.duration! / 2, 9);
  });

  it("cuts a note short where the same pitch is struck again on the same track", () => {
    const p = applyOps(fresh(), [
      add("melody", n(60, 0, 1920), n(60, 480, 480), n(64, 0, 1920)),
      add("chords", n(60, 240, 1920)),
    ]);
    const song = compileProject(p);
    const melody = song.notes.filter((x) => x.track === "melody" && x.pitch === 60);
    expect(melody.map((x) => [x.time, x.duration])).toEqual([
      [0, 0.5],
      [0.5, 0.5],
    ]);
    // Another pitch, and another track, are not touched.
    expect(song.notes.find((x) => x.pitch === 64)!.duration).toBe(2);
    expect(song.notes.find((x) => x.track === "chords")!.duration).toBe(2);
  });

  it("keeps the longer of two notes of one pitch that start together", () => {
    const p = applyOps(fresh(), [add("melody", n(60, 0, 240), n(60, 0, 960))]);
    expect(times(compileProject(p))).toEqual([[60, 0, 1]]);
  });

  it("leaves out muted tracks, and compiles only the named tracks when asked", () => {
    let p = applyOps(fresh(), [add("melody", n(72, 0)), add("chords", n(60, 0)), add("bass", n(36, 0))]);
    p = applyOps(p, [{ op: "patchTrack", trackId: "chords", patch: { muted: true } }]);
    expect(compileProject(p).notes.map((x) => x.track)).toEqual(["bass", "melody"]);
    expect(compileProject(p).tracks!.map((t) => t.id)).toEqual(["melody", "bass"]);
    expect(compileProject(p, { tracks: ["bass"] }).notes.map((x) => x.track)).toEqual(["bass"]);
    // Soloing a muted track still lets it be heard.
    expect(compileProject(p, { tracks: ["chords"] }).notes.map((x) => x.track)).toEqual(["chords"]);
  });

  it("compiles a range, shifted to start at zero", () => {
    const p = applyOps(fresh(), [
      add("melody", n(60, 0), n(62, 1920), n(64, 2400, 1920), n(65, 3840)),
      {
        op: "setChords",
        range: { start: 0, end: 7680 },
        chords: [
          { tick: 0, dur: 3840, symbol: "C", origin: "manual" },
          { tick: 3840, dur: 1920, symbol: "F", origin: "manual" },
        ],
      },
      {
        op: "setSections",
        sections: [
          { id: "a", name: "A", tick: 0, dur: 2880 },
          { id: "b", name: "B", tick: 2880, dur: 4800 },
        ],
      },
    ]);
    const song = compileProject(p, { range: { start: 1920, end: 3840 } });
    // The note at 2400 would run past the end of the range, so it is cut there.
    expect(times(song)).toEqual([
      [62, 0, 0.5],
      [64, 0.5, 1.5],
    ]);
    expect(song.duration).toBe(2);
    expect(song.chords).toEqual([{ time: 0, duration: 2, symbol: "C" }]);
    expect(song.sections).toEqual([
      { name: "A", start: 0, end: 1 },
      { name: "B", start: 1, end: 2 },
    ]);
  });

  it("carries chords, sections and key across", () => {
    const p = applyOps(fresh({ key: { tonic: "A", mode: "minor" } }), [
      {
        op: "setChords",
        range: { start: 0, end: 3840 },
        chords: [
          { tick: 0, dur: 1920, symbol: "Am", origin: "manual" },
          { tick: 1920, dur: 1920, symbol: "F/A", origin: "manual" },
        ],
      },
      { op: "setSections", sections: [{ id: "a", name: "Verse", tick: 0, dur: 3840 }] },
      { op: "patchSong", patch: { author: "Me" } },
    ]);
    const song = compileProject(p);
    expect(song.key).toBe("A minor");
    expect(song.artist).toBe("Me");
    expect(song.chords).toEqual([
      { time: 0, duration: 2, symbol: "Am" },
      { time: 2, duration: 2, symbol: "F/A" },
    ]);
    expect(song.sections).toEqual([{ name: "Verse", start: 0, end: 4 }]);
  });

  it("never compiles a pending rhythm or a parked idea", () => {
    const p = applyOps(fresh(), [
      { op: "setPending", pending: { trackId: "melody", slots: [{ tick: 0, dur: 240, vel: 0.7 }] } },
      {
        op: "putIdea",
        idea: { id: "i", kind: "melody", label: "x", createdAt: "", source: "author", ops: [add("melody", n(60, 0))] },
      },
    ]);
    expect(compileProject(p).notes).toEqual([]);
  });

  describe("drums", () => {
    const beat = {
      id: "beat",
      name: "Beat",
      stepsPerBar: 16,
      bars: 1 as const,
      lanes: {
        kick: [1, 0, 0, 0, 0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0, 0, 0],
        hat: [0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0],
      },
    };
    const withBeat = (p: Project, tick = 0, repeats = 1) =>
      applyOps(p, [
        { op: "putPattern", trackId: "drums", pattern: beat },
        { op: "placeClip", trackId: "drums", patternId: "beat", tick, repeats },
      ]);

    it("lays a pattern out step by step, as many times as the clip repeats", () => {
      const song = compileProject(withBeat(fresh(), 1920, 2));
      expect(song.drums!.kit).toBe("synth");
      expect(song.drums!.hits).toEqual([
        { pad: "kick", time: 2, velocity: 1 },
        { pad: "hat", time: 2.5, velocity: 0.5 },
        { pad: "kick", time: 3, velocity: 0.8 },
        { pad: "hat", time: 3.5, velocity: 0.5 },
        { pad: "kick", time: 4, velocity: 1 },
        { pad: "hat", time: 4.5, velocity: 0.5 },
        { pad: "kick", time: 5, velocity: 0.8 },
        { pad: "hat", time: 5.5, velocity: 0.5 },
      ]);
    });

    it("fits a pattern's columns to the bar it lands on", () => {
      // Twelve columns over a bar of 6/8 (1440 ticks): 120 ticks a column.
      let p = fresh({ bpm: 120, meter: [6, 8] });
      p = applyOps(p, [
        {
          op: "putPattern",
          trackId: "drums",
          pattern: {
            id: "six",
            name: "Six",
            stepsPerBar: 12,
            bars: 1,
            lanes: { kick: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0] },
          },
        },
        { op: "placeClip", trackId: "drums", patternId: "six", tick: 0, repeats: 1 },
      ]);
      expect(compileProject(p).drums!.hits.map((h) => h.time)).toEqual([0, 0.75]);
    });

    it("plays a two-bar pattern across two bars", () => {
      const lane = new Array(32).fill(0);
      lane[0] = 1;
      lane[16] = 0.6;
      let p = applyOps(fresh(), [
        {
          op: "putPattern",
          trackId: "drums",
          pattern: { id: "two", name: "Two", stepsPerBar: 16, bars: 2, lanes: { snare: lane } },
        },
        { op: "placeClip", trackId: "drums", patternId: "two", tick: 0, repeats: 2 },
      ]);
      expect(compileProject(p).drums!.hits.map((h) => [h.time, h.velocity])).toEqual([
        [0, 1],
        [2, 0.6],
        [4, 1],
        [6, 0.6],
      ]);
      p = applyOps(p, [{ op: "patchTrack", trackId: "drums", patch: { muted: true } }]);
      expect(compileProject(p).drums).toBeUndefined();
    });

    it("adds free hits with their feel, and swings the pattern with the song", () => {
      let p = withBeat(fresh());
      p = applyOps(p, [
        {
          op: "addHits",
          trackId: "drums",
          hits: [
            { pad: "crash", tick: 0, vel: 0.9, origin: "tapped" },
            { pad: "snare", tick: 480, vel: 0.7, offset: 48, origin: "tapped" },
          ],
        },
      ]);
      const hits = compileProject(p).drums!.hits;
      expect(hits.find((h) => h.pad === "snare")!.time).toBe(0.55);
      expect(hits.filter((h) => h.time === 0).map((h) => h.pad)).toEqual(["crash", "kick"]);
      p = applyOps(p, [{ op: "patchTrack", trackId: "drums", patch: { feel: 0 } }]);
      expect(compileProject(p).drums!.hits.find((h) => h.pad === "snare")!.time).toBe(0.5);
    });
  });
});

/** Pair every note of one song with a note of another: same pitch and hand, in time order. */
function paired(a: Note[], b: Note[]): [Note, Note][] {
  const key = (x: Note) => `${x.pitch}:${x.hand}`;
  const groups = new Map<string, Note[]>();
  for (const x of b) groups.set(key(x), [...(groups.get(key(x)) ?? []), x]);
  for (const list of groups.values()) list.sort((x, y) => x.time - y.time);
  const taken = new Map<string, number>();
  return [...a]
    .sort((x, y) => x.time - y.time)
    .map((x) => {
      const i = taken.get(key(x)) ?? 0;
      taken.set(key(x), i + 1);
      const match = groups.get(key(x))?.[i];
      if (!match) throw new Error(`no partner for pitch ${x.pitch} at ${x.time}`);
      return [x, match];
    });
}

describe("projectFromSong", () => {
  it("files each note on the grid and keeps how far off it was", () => {
    const song: Song = normalize({
      format: "piano-song/v1",
      id: "s",
      title: "S",
      bpm: 120,
      notes: [
        { pitch: 60, time: 0, duration: 0.5, hand: "R" },
        { pitch: 62, time: 0.51, duration: 0.25, hand: "R", velocity: 0.9 },
        { pitch: 48, time: 0.99, duration: 1, hand: "L" },
      ],
    });
    const p = projectFromSong(song, { id: "p", now: NOW });
    const [melody, chords, drums] = p.tracks as [NoteTrack, NoteTrack, DrumTrack];
    expect(p.tracks.map((t) => [t.id, t.kind])).toEqual([
      ["melody", "notes"],
      ["chords", "notes"],
      ["drums", "drums"],
    ]);
    expect([melody.hand, melody.role, chords.hand, chords.role]).toEqual(["R", "melody", "L", "chords"]);
    // 0.51 s is tick 489.6: filed at 480 with an offset of 10. 0.99 s is 950.4: filed at 960, offset −10.
    expect(melody.notes).toEqual([
      { id: 1, pitch: 60, tick: 0, dur: 480, vel: 0.7, origin: "imported" },
      { id: 2, pitch: 62, tick: 480, dur: 240, vel: 0.9, origin: "imported", offset: 10 },
    ]);
    expect(chords.notes).toEqual([
      { id: 3, pitch: 48, tick: 960, dur: 960, vel: 0.7, origin: "imported", offset: -10 },
    ]);
    expect(drums.hits).toEqual([]);
    expect(p).toMatchObject({
      title: "S",
      tempo: [{ tick: 0, bpm: 120 }],
      meter: [{ tick: 0, numerator: 4, denominator: 4 }],
      seq: 4,
    });
    expect(p.source).toMatchObject({ kind: "song", ref: "s" });
    expect(p.source!.gridGuessed).toBeUndefined();
    expect(p.lengthTicks).toBe(1920);
    expect(checkProject(p)).toEqual([]);
  });

  it("can file on a finer grid", () => {
    const song: Song = normalize({
      format: "piano-song/v1",
      id: "s",
      title: "S",
      bpm: 120,
      notes: [{ pitch: 60, time: 0.0625, duration: 0.1, hand: "R" }],
    });
    expect((projectFromSong(song).tracks[0] as NoteTrack).notes[0]).toMatchObject({ tick: 120, offset: -60 });
    expect((projectFromSong(song, { ppqGrid: 32 }).tracks[0] as NoteTrack).notes[0]).toMatchObject({ tick: 60 });
    expect("offset" in (projectFromSong(song, { ppqGrid: 32 }).tracks[0] as NoteTrack).notes[0]).toBe(false);
  });

  it("takes the key from the song, or works it out and says so", () => {
    const base = { format: "piano-song/v1" as const, id: "s", title: "S", bpm: 100 };
    const scale = [57, 59, 60, 62, 64, 65, 67, 69, 64, 60, 57].map((pitch, i) => ({
      pitch,
      time: i * 0.5,
      duration: i === 10 ? 2 : 0.5,
      hand: "R" as const,
    }));
    const named = projectFromSong(normalize({ ...base, key: "D dorian", notes: scale }));
    expect(named.key).toEqual([{ tick: 0, tonic: "D", mode: "dorian" }]);
    expect(named.source!.warnings).toBeUndefined();
    const guessed = projectFromSong(normalize({ ...base, notes: scale }));
    expect(guessed.key).toEqual([{ tick: 0, tonic: "A", mode: "minor" }]);
    expect(guessed.source!.warnings![0].text).toMatch(/A minor is the best fit/);
  });

  it("keeps a v2 song's tracks, chords, sections, drums and tempo changes", () => {
    const p0 = applyOps(newProject({ id: "orig", title: "Orig", bpm: 120, now: NOW }), [
      {
        op: "patchSong",
        patch: {
          tempo: [
            { tick: 0, bpm: 120 },
            { tick: 3840, bpm: 90 },
          ],
        },
      },
      add("melody", n(72, 0), n(74, 480), n(76, 4320)),
      add("bass", n(36, 0, 1920), n(41, 3840, 1920)),
      {
        op: "setChords",
        range: { start: 0, end: 7680 },
        chords: [
          { tick: 0, dur: 3840, symbol: "C", origin: "manual" },
          { tick: 3840, dur: 3840, symbol: "F", origin: "manual" },
        ],
      },
      {
        op: "setSections",
        sections: [
          { id: "a", name: "A", tick: 0, dur: 3840 },
          { id: "b", name: "B", tick: 3840, dur: 3840 },
        ],
      },
      {
        op: "addHits",
        trackId: "drums",
        hits: [
          { pad: "kick", tick: 0, vel: 1, origin: "tapped" },
          { pad: "snare", tick: 4320, vel: 0.8, origin: "tapped" },
        ],
      },
      { op: "patchTrack", trackId: "bass", patch: { sound: "soft", volume: 0.5 } },
    ]);
    const song = compileProject(p0);
    const p = projectFromSong(song, { id: "back", now: NOW });
    expect(checkProject(p)).toEqual([]);
    expect(ProjectSchema.safeParse(p).success).toBe(true);
    expect(p.tempo).toEqual([
      { tick: 0, bpm: 120 },
      { tick: 3840, bpm: 90 },
    ]);
    expect(p.tracks.map((t) => t.id)).toEqual(["melody", "chords", "bass", "drums"]);
    const bass = p.tracks[2] as NoteTrack;
    expect(bass).toMatchObject({ role: "bass", hand: "L", sound: "soft", volume: 0.5 });
    expect(bass.notes.map((x) => [x.pitch, x.tick, x.dur])).toEqual([
      [36, 0, 1920],
      [41, 3840, 1920],
    ]);
    expect((p.tracks[0] as NoteTrack).notes.map((x) => [x.pitch, x.tick])).toEqual([
      [72, 0],
      [74, 480],
      [76, 4320],
    ]);
    expect(p.chords.map((c) => [c.symbol, c.tick, c.dur])).toEqual([
      ["C", 0, 3840],
      ["F", 3840, 3840],
    ]);
    expect(p.sections.map((s) => [s.name, s.tick, s.dur])).toEqual([
      ["A", 0, 3840],
      ["B", 3840, 3840],
    ]);
    expect((p.tracks[3] as DrumTrack).hits.map((h) => [h.pad, h.tick])).toEqual([
      ["kick", 0],
      ["snare", 4320],
    ]);
    // And round again: the same song.
    expect(compileProject(p).notes).toEqual(song.notes);
    expect(compileProject(p).drums).toEqual(song.drums);
    expect(compileProject(p).tempoMap).toEqual(song.tempoMap);
  });

  it("gives a song that starts with a pickup a whole first bar", () => {
    // First downbeat at 0.5 s (one beat in, at 120): three beats of lead are added to make a bar.
    const song: Song = normalize({
      format: "piano-song/v2",
      id: "s",
      title: "S",
      bpm: 120,
      gridOffset: 0.5,
      notes: [
        { pitch: 60, time: 0, duration: 0.5, hand: "R" },
        { pitch: 64, time: 0.5, duration: 0.5, hand: "R" },
      ],
    });
    const notes = (projectFromSong(song).tracks[0] as NoteTrack).notes;
    expect(notes.map((x) => x.tick)).toEqual([1440, 1920]);
  });

  // ── Acceptance criterion 8 ──
  it("Rewrite the Stars: every note comes back within 2 ms of its start and its length", () => {
    const p = projectFromSong(rewrite, { id: "rts", now: NOW });
    expect(checkProject(p)).toEqual([]);
    expect(ProjectSchema.safeParse(p).success).toBe(true);
    expect(p.tempo).toEqual([{ tick: 0, bpm: 125 }]);
    expect(p.source!.gridGuessed).toBeUndefined();
    const back = compileProject(p);
    expect(back.notes).toHaveLength(rewrite.notes.length);
    let worstStart = 0;
    let worstLength = 0;
    for (const [a, b] of paired(rewrite.notes, back.notes)) {
      worstStart = Math.max(worstStart, Math.abs(a.time - b.time));
      worstLength = Math.max(worstLength, Math.abs(a.duration - b.duration));
      expect(b.velocity).toBe(a.velocity);
    }
    expect(worstStart).toBeLessThan(0.002);
    expect(worstLength).toBeLessThan(0.002);
    // Right hand to the melody track, left hand to the chords track.
    expect(back.notes.every((x) => x.track === (x.hand === "R" ? "melody" : "chords"))).toBe(true);
    expect(back.sections!.map((s) => s.name)).toEqual(rewrite.sections!.map((s) => s.name));
    expect(back).toMatchObject({ bpm: 125, timeSignature: [4, 4], title: "Rewrite the Stars" });
    // Most of it was played on the grid: few notes needed an offset of more than a few ticks.
    const all = p.tracks.flatMap((t) => (t.kind === "notes" ? t.notes : []));
    expect(all.filter((x) => Math.abs(x.offset ?? 0) > 10).length).toBeLessThan(all.length * 0.05);
  });

  it("Divenire: a free-time song gets a guessed grid, says so, and still comes back note for note", () => {
    const p = projectFromSong(divenire, { id: "div", now: NOW });
    expect(checkProject(p)).toEqual([]);
    expect(p.source!.gridGuessed).toBe(true);
    expect(p.source!.warnings![0].text).toMatch(/free time/);
    expect(Number.isInteger(p.tempo[0].bpm)).toBe(true);
    const back = compileProject(p);
    expect(back.notes).toHaveLength(divenire.notes.length);
    for (const [a, b] of paired(divenire.notes, back.notes)) {
      expect(Math.abs(a.time - b.time)).toBeLessThan(0.002);
      expect(Math.abs(a.duration - b.duration)).toBeLessThan(0.002);
    }
  });
});
