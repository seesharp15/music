import { describe, expect, it } from "vitest";
import { newProject } from "./new";
import { applyOps } from "./ops";
import { checkProject, EditOpSchema, migrate, parseProject, ProjectSchema } from "./schema";
import type { Project } from "./types";

const base = () =>
  applyOps(newProject({ id: "p1", now: new Date("2026-11-16T12:00:00Z") }), [
    {
      op: "addNotes",
      trackId: "melody",
      notes: [
        { pitch: 60, tick: 0, dur: 240, vel: 0.7, origin: "manual" },
        { pitch: 62, tick: 240, dur: 240, vel: 0.7, origin: "hummed", conf: 0.8 },
      ],
    },
    {
      op: "setChords",
      range: { start: 0, end: 3840 },
      chords: [
        { tick: 0, dur: 1920, symbol: "C", origin: "manual" },
        { tick: 1920, dur: 1920, symbol: "G7", origin: "suggested", sid: "s1" },
      ],
    },
    {
      op: "putPattern",
      trackId: "drums",
      pattern: { id: "a", name: "A", stepsPerBar: 16, bars: 1, lanes: { kick: new Array(16).fill(0) } },
    },
    { op: "placeClip", trackId: "drums", patternId: "a", tick: 0, repeats: 2 },
    {
      op: "putIdea",
      idea: {
        id: "i1",
        kind: "melody",
        label: "Kept",
        createdAt: "2026-11-16",
        source: "local",
        ops: [
          {
            op: "addNotes",
            trackId: "melody",
            notes: [{ pitch: 64, tick: 0, dur: 240, vel: 0.7, origin: "suggested" }],
          },
          { op: "setPending", pending: undefined },
        ],
      },
    },
  ]);
/** A copy that can be damaged. */
const copy = (): Project => JSON.parse(JSON.stringify(base()));

describe("ProjectSchema", () => {
  it("accepts a project, and gives it back unchanged", () => {
    const p = copy();
    const parsed = parseProject(p);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.project).toEqual(p);
    expect(checkProject(base())).toEqual([]);
  });

  it("survives a trip through JSON, ideas and their operations included", () => {
    const parsed = parseProject(JSON.parse(JSON.stringify(base())));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.project.ideas[0].ops).toHaveLength(2);
  });

  const damage: [string, (p: Project) => void, RegExp][] = [
    [
      "a note off the keyboard",
      (p) => void ((p.tracks[0] as { notes: { pitch: number }[] }).notes[0].pitch = 200),
      /tracks\.0\.notes\.0\.pitch/,
    ],
    [
      "a note with no length",
      (p) => void ((p.tracks[0] as { notes: { dur: number }[] }).notes[0].dur = 0),
      /notes\.0\.dur/,
    ],
    ["a missing title", (p) => void delete (p as Partial<Project>).title, /title/],
    ["no tempo", (p) => void (p.tempo = []), /tempo/],
    ["a tempo that starts late", (p) => void (p.tempo[0].tick = 480), /tempo: the first entry must be at tick 0/],
    ["a track of an unknown kind", (p) => void ((p.tracks[0] as { kind: string }).kind = "strings"), /tracks\.0/],
    ["an unknown field", (p) => void ((p as unknown as Record<string, unknown>).virus = true), /virus|[Uu]nrecognized/],
    ["a duplicate note id", (p) => void ((p.tracks[0] as { notes: { id: number }[] }).notes[1].id = 1), /used twice/],
    ["an id at or above seq", (p) => void (p.seq = 1), /not below seq/],
    ["notes out of order", (p) => void (p.tracks[0] as { notes: unknown[] }).notes.reverse(), /tick order/],
    ["overlapping chords", (p) => void (p.chords[0].dur = 3000), /overlap/],
    [
      "a clip of a missing pattern",
      (p) => void ((p.tracks[3] as { clips: { patternId: string }[] }).clips[0].patternId = "zz"),
      /pattern that does not exist/,
    ],
    [
      "a lane of the wrong length",
      (p) => void ((p.tracks[3] as { patterns: { lanes: Record<string, number[]> }[] }).patterns[0].lanes.kick = [1]),
      /wrong length/,
    ],
    ["a length shorter than the music", (p) => void (p.lengthTicks = 10), /shorter than the music/],
    ["two tracks with one id", (p) => void (p.tracks[1].id = "melody"), /used twice/],
    ["a pending rhythm for a missing track", (p) => void (p.pending = { trackId: "gone", slots: [] }), /pending/],
    [
      "an idea holding nonsense",
      (p) => void ((p.ideas[0] as unknown as { ops: unknown[] }).ops = [{ op: "explode" }]),
      /ideas\.0\.ops/,
    ],
    ["a key that is not a note", (p) => void (p.key[0].tonic = "H"), /key\.0\.tonic/],
  ];
  it.each(damage)("refuses %s, and says where", (_name, hurt, pattern) => {
    const p = copy();
    hurt(p);
    const parsed = parseProject(p);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.join("\n")).toMatch(pattern);
  });

  it("refuses what is not a project at all, by name", () => {
    for (const bad of [
      null,
      42,
      "hello",
      [],
      {},
      { format: "piano-song/v1", notes: [] },
      { format: "piano-project/v9" },
    ]) {
      const parsed = parseProject(bad);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.errors[0]).toMatch(/not a project/);
    }
    const song = parseProject({ format: "piano-song/v1" });
    if (!song.ok) expect(song.errors[0]).toContain("piano-song/v1");
  });

  it("never throws, whatever it is given", () => {
    const p = copy() as unknown as Record<string, unknown>;
    for (const key of Object.keys(p)) {
      for (const junk of [null, 7, "x", [], {}, [null], [[]]]) {
        expect(() => parseProject({ ...p, [key]: junk })).not.toThrow();
      }
    }
  });
});

describe("migrate", () => {
  it("fills in what an early project may lack", () => {
    const p = copy() as unknown as Record<string, unknown>;
    delete p.ideas;
    delete p.handSpan;
    delete p.swing;
    const parsed = parseProject(p);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.project).toMatchObject({ ideas: [], handSpan: 14, swing: { amount: 0.5, unit: 8 } });
  });
  it("leaves anything else as it finds it", () => {
    expect(migrate(null)).toBeNull();
    expect(migrate("x")).toBe("x");
    expect(migrate({ format: "other" })).toEqual({ format: "other" });
    const p = copy();
    expect(migrate(p)).toEqual(p);
    expect(ProjectSchema.safeParse(migrate(p)).success).toBe(true);
  });
});

describe("EditOpSchema", () => {
  it("accepts well-formed operations and refuses malformed ones", () => {
    expect(EditOpSchema.safeParse({ op: "insertTime", tick: 0, dur: 480 }).success).toBe(true);
    expect(EditOpSchema.safeParse({ op: "setPending" }).success).toBe(true);
    expect(EditOpSchema.safeParse({ op: "patchNotes", trackId: "m", ids: [1], patch: { vel: 0.5 } }).success).toBe(
      true,
    );
    expect(EditOpSchema.safeParse({ op: "insertTime", tick: 0 }).success).toBe(false);
    expect(EditOpSchema.safeParse({ op: "nope" }).success).toBe(false);
    expect(EditOpSchema.safeParse({ op: "addNotes", trackId: "m", notes: [{ pitch: 60 }] }).success).toBe(false);
  });
});
