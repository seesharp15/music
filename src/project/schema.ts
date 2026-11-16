/**
 * What a stored project must look like. Every project read from storage or from a file passes
 * `parseProject` before anything else sees it: the shape is checked by zod, and the rules a shape
 * cannot express (unique ids, sorted notes, chords that do not overlap) by `checkProject`.
 */
import { z } from "zod";
import type { Idea } from "../assist/core/types";
import { DRUM_PADS, MAX_PITCH, MIN_PITCH, SOUND_IDS } from "../song/ids";
import type { EditOp, Project } from "./types";

export const PROJECT_FORMAT = "piano-project/v1";

const tick = z.number().int().nonnegative();
const length = z.number().int().positive();
const unit = z.number().min(0).max(1);
const pitch = z.number().int().min(MIN_PITCH).max(MAX_PITCH);
const id = z.number().int().nonnegative();
const name = z.string().min(1);

const Hand = z.enum(["L", "R"]);
const Origin = z.enum(["manual", "played", "tapped", "hummed", "imported", "suggested"]);
const TrackRole = z.enum(["melody", "chords", "bass", "counter", "free"]);
const Sound = z.enum(SOUND_IDS);
const Pad = z.enum(DRUM_PADS);
const Mode = z.enum(["major", "minor", "dorian", "mixolydian", "lydian", "phrygian"]);

const noteFields = {
  pitch,
  tick,
  dur: length,
  vel: unit,
  offset: z.number().optional(),
  hand: Hand.optional(),
  origin: Origin,
  edited: z.boolean().optional(),
  sid: z.string().optional(),
  conf: unit.optional(),
};
const PNote = z.strictObject({ id, ...noteFields });

const hitFields = { pad: Pad, tick, vel: unit, offset: z.number().optional(), origin: Origin };
const Hit = z.strictObject({ id, ...hitFields });

const chordFields = {
  tick,
  dur: length,
  symbol: name,
  origin: Origin,
  edited: z.boolean().optional(),
  sid: z.string().optional(),
  conf: unit.optional(),
};
const Chord = z.strictObject({ id, ...chordFields });

const DrumPattern = z.strictObject({
  id: name,
  name: z.string(),
  stepsPerBar: z.number().int().positive(),
  bars: z.union([z.literal(1), z.literal(2), z.literal(4)]),
  lanes: z.partialRecord(Pad, z.array(unit)),
});

const NoteTrack = z.strictObject({
  kind: z.literal("notes"),
  id: name,
  name: z.string(),
  role: TrackRole,
  hand: Hand,
  sound: Sound,
  volume: unit,
  muted: z.boolean(),
  locked: z.boolean(),
  feel: unit,
  notes: z.array(PNote),
});

const DrumTrack = z.strictObject({
  kind: z.literal("drums"),
  id: name,
  name: z.string(),
  kit: z.string(),
  volume: unit,
  muted: z.boolean(),
  locked: z.boolean(),
  feel: unit,
  patterns: z.array(DrumPattern),
  clips: z.array(z.strictObject({ id, patternId: name, tick, repeats: z.number().int().positive() })),
  hits: z.array(Hit),
});

const Track = z.discriminatedUnion("kind", [NoteTrack, DrumTrack]);

const Section = z.strictObject({
  id: name,
  name: z.string(),
  tick,
  dur: length,
  color: z.string().optional(),
  checked: z.boolean().optional(),
});

const Groove = z.strictObject({
  unit: z.union([z.literal(8), z.literal(16)]),
  offsets: z.array(z.number()),
  accents: z.array(z.number().nonnegative()),
});

const Brief = z.strictObject({
  mood: z.string().optional(),
  genre: z.string().optional(),
  references: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

const Tempo = z.strictObject({ tick, bpm: z.number().min(10).max(400) });
const Meter = z.strictObject({
  tick,
  numerator: z.number().int().min(1).max(32),
  denominator: z.union([z.literal(2), z.literal(4), z.literal(8), z.literal(16)]),
});
const KeyEvent = z.strictObject({ tick, tonic: z.string().regex(/^[A-G][#b]?$/), mode: Mode });
const Swing = z.strictObject({ amount: z.number().min(0.25).max(0.85), unit: z.union([z.literal(8), z.literal(16)]) });
const Pending = z.strictObject({
  trackId: name,
  slots: z.array(z.strictObject({ tick, dur: length, vel: unit })),
});
const Range = z.strictObject({ start: tick, end: tick });

const trackPatch = z.strictObject({
  name: z.string().optional(),
  role: TrackRole.optional(),
  hand: Hand.optional(),
  sound: Sound.optional(),
  volume: unit.optional(),
  muted: z.boolean().optional(),
  locked: z.boolean().optional(),
  feel: unit.optional(),
  kit: z.string().optional(),
});

// An idea holds edit operations, and one edit operation holds an idea: the two are defined together.
const IdeaSchema: z.ZodType<Idea> = z.lazy(() =>
  z.strictObject({
    id: name,
    kind: z.enum(["melody", "chords", "bass", "accompaniment", "drums", "take", "rhythm"]),
    label: z.string(),
    createdAt: z.string(),
    source: z.enum(["local", "ai", "hum", "tap", "import", "author"]),
    ops: z.array(EditOpSchema),
    parentId: z.string().optional(),
    rationale: z.string().optional(),
    takeId: z.string().optional(),
  }),
);

const songPatch = z.strictObject({
  title: z.string().optional(),
  author: z.string().optional(),
  tempo: z.array(Tempo).optional(),
  meter: z.array(Meter).optional(),
  key: z.array(KeyEvent).optional(),
  swing: Swing.optional(),
  groove: Groove.optional(),
  handSpan: z.number().int().min(1).max(36).optional(),
  lengthTicks: tick.optional(),
  brief: Brief.optional(),
});

/** One edit operation, as stored inside an idea. `applyOps` checks the values; this checks the shape. */
export const EditOpSchema: z.ZodType<EditOp> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.strictObject({ op: z.literal("addNotes"), trackId: name, notes: z.array(z.strictObject(noteFields)) }),
    z.strictObject({ op: z.literal("removeNotes"), trackId: name, ids: z.array(id) }),
    z.strictObject({
      op: z.literal("patchNotes"),
      trackId: name,
      ids: z.array(id),
      patch: z.strictObject(noteFields).partial(),
    }),
    z.strictObject({
      op: z.literal("shiftNotes"),
      trackId: name,
      ids: z.array(id),
      ticks: z.number().int(),
      semitones: z.number().int(),
    }),
    z.strictObject({ op: z.literal("setChords"), range: Range, chords: z.array(z.strictObject(chordFields)) }),
    z.strictObject({ op: z.literal("addHits"), trackId: name, hits: z.array(z.strictObject(hitFields)) }),
    z.strictObject({ op: z.literal("removeHits"), trackId: name, ids: z.array(id) }),
    z.strictObject({
      op: z.literal("patchHits"),
      trackId: name,
      ids: z.array(id),
      patch: z.strictObject(hitFields).partial(),
    }),
    z.strictObject({ op: z.literal("putPattern"), trackId: name, pattern: DrumPattern }),
    z.strictObject({ op: z.literal("removePattern"), trackId: name, patternId: name }),
    z.strictObject({
      op: z.literal("placeClip"),
      trackId: name,
      patternId: name,
      tick,
      repeats: z.number().int().positive(),
    }),
    z.strictObject({ op: z.literal("removeClip"), trackId: name, id }),
    z.strictObject({ op: z.literal("addTrack"), track: Track, index: z.number().int().nonnegative().optional() }),
    z.strictObject({ op: z.literal("removeTrack"), trackId: name }),
    z.strictObject({ op: z.literal("patchTrack"), trackId: name, patch: trackPatch }),
    z.strictObject({ op: z.literal("setSections"), sections: z.array(Section) }),
    z.strictObject({ op: z.literal("insertTime"), tick, dur: length }),
    z.strictObject({ op: z.literal("deleteTime"), tick, dur: length }),
    z.strictObject({ op: z.literal("copyRange"), from: Range, to: tick }),
    z.strictObject({ op: z.literal("patchSong"), patch: songPatch }),
    z.strictObject({ op: z.literal("putIdea"), idea: IdeaSchema }),
    z.strictObject({ op: z.literal("removeIdea"), id: name }),
    // Clearing is `pending: undefined`, which JSON drops: a missing key reads back as the same thing.
    z
      .strictObject({ op: z.literal("setPending"), pending: Pending.optional() })
      .transform((o) => ({ op: o.op, pending: o.pending })),
  ]),
);

const Source = z.strictObject({
  kind: z.enum(["audio", "youtube", "midi", "song"]),
  ref: z.string().optional(),
  engines: z.record(z.string(), z.string()).optional(),
  importedAt: z.string(),
  gridGuessed: z.boolean().optional(),
  level: z.enum(["lead", "easy", "intermediate", "full"]).optional(),
  analysisBlobId: z.string().optional(),
  warnings: z.array(z.strictObject({ tick: tick.optional(), text: z.string() })).optional(),
});

const Shape = z.strictObject({
  format: z.literal(PROJECT_FORMAT),
  id: name,
  title: z.string(),
  author: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  seq: z.number().int().nonnegative(),
  lengthTicks: tick,
  tempo: z.array(Tempo).min(1),
  meter: z.array(Meter).min(1),
  key: z.array(KeyEvent),
  swing: Swing,
  groove: Groove.optional(),
  handSpan: z.number().int().min(1).max(36),
  sections: z.array(Section),
  chords: z.array(Chord),
  tracks: z.array(Track),
  brief: Brief.optional(),
  ideas: z.array(IdeaSchema),
  pending: Pending.optional(),
  source: Source.optional(),
});

/**
 * The rules a project keeps that its shape alone does not say. Returns one line per broken rule;
 * empty means sound. `applyOps` leaves every one of these true.
 */
export function checkProject(p: Project): string[] {
  const problems: string[] = [];
  const say = (text: string) => void (problems.length < 20 && problems.push(text));

  for (const [label, events] of [
    ["tempo", p.tempo],
    ["meter", p.meter],
  ] as const) {
    if (events[0]?.tick !== 0) say(`${label}: the first entry must be at tick 0`);
    for (let i = 1; i < events.length; i++) {
      if (events[i].tick <= events[i - 1].tick) say(`${label}: entries must be in order, one per tick`);
    }
  }
  for (let i = 1; i < p.key.length; i++) if (p.key[i].tick <= p.key[i - 1].tick) say("key: entries must be in order");

  const ids = new Set<number>();
  const claim = (n: number, what: string) => {
    if (ids.has(n)) say(`${what}: id ${n} is used twice`);
    if (n >= p.seq) say(`${what}: id ${n} is not below seq (${p.seq})`);
    ids.add(n);
  };
  let end = 0;
  const reach = (t: number) => void (end = Math.max(end, t));

  for (let i = 0; i < p.chords.length; i++) {
    const c = p.chords[i];
    claim(c.id, "chord");
    reach(c.tick + c.dur);
    const prev = p.chords[i - 1];
    if (prev && c.tick < prev.tick) say("chords must be in tick order");
    if (prev && c.tick < prev.tick + prev.dur) say(`chords ${prev.id} and ${c.id} overlap`);
  }

  const trackIds = new Set<string>();
  for (const t of p.tracks) {
    if (trackIds.has(t.id)) say(`track id "${t.id}" is used twice`);
    trackIds.add(t.id);
    if (t.kind === "notes") {
      for (let i = 0; i < t.notes.length; i++) {
        claim(t.notes[i].id, `track ${t.id}`);
        reach(t.notes[i].tick + t.notes[i].dur);
        if (i && t.notes[i].tick < t.notes[i - 1].tick) say(`track ${t.id}: notes must be in tick order`);
      }
    } else {
      const patterns = new Set<string>();
      for (const pat of t.patterns) {
        if (patterns.has(pat.id)) say(`track ${t.id}: pattern id "${pat.id}" is used twice`);
        patterns.add(pat.id);
        for (const [pad, lane] of Object.entries(pat.lanes)) {
          if (lane.length !== pat.stepsPerBar * pat.bars) say(`pattern ${pat.id}: the ${pad} lane is the wrong length`);
        }
      }
      for (const c of t.clips) {
        claim(c.id, `track ${t.id}`);
        reach(c.tick);
        if (!patterns.has(c.patternId)) say(`track ${t.id}: clip ${c.id} uses a pattern that does not exist`);
      }
      for (let i = 0; i < t.hits.length; i++) {
        claim(t.hits[i].id, `track ${t.id}`);
        reach(t.hits[i].tick);
        if (i && t.hits[i].tick < t.hits[i - 1].tick) say(`track ${t.id}: hits must be in tick order`);
      }
    }
  }

  const sectionIds = new Set<string>();
  for (let i = 0; i < p.sections.length; i++) {
    const s = p.sections[i];
    if (sectionIds.has(s.id)) say(`section id "${s.id}" is used twice`);
    sectionIds.add(s.id);
    reach(s.tick + s.dur);
    if (i && s.tick < p.sections[i - 1].tick) say("sections must be in tick order");
  }
  const ideaIds = new Set<string>();
  for (const idea of p.ideas) {
    if (ideaIds.has(idea.id)) say(`idea id "${idea.id}" is used twice`);
    ideaIds.add(idea.id);
  }
  if (p.pending && !p.tracks.some((t) => t.id === p.pending!.trackId)) say("pending: its track does not exist");
  if (p.lengthTicks < end) say(`lengthTicks (${p.lengthTicks}) is shorter than the music (${end})`);
  return problems;
}

/** A stored project: the right shape, and every rule kept. */
export const ProjectSchema: z.ZodType<Project> = Shape.superRefine((p, ctx) => {
  for (const message of checkProject(p as Project)) ctx.addIssue({ code: "custom", message });
}) as z.ZodType<Project>;

/**
 * Bring an older stored project up to the current format. There is only one version so far, so this
 * fills in what early builds may have left out and passes everything else through for the schema to
 * judge. Never throws.
 */
export function migrate(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const p = { ...(raw as Record<string, unknown>) };
  if (p.format !== PROJECT_FORMAT) return p;
  p.ideas ??= [];
  p.sections ??= [];
  p.chords ??= [];
  p.key ??= [];
  p.handSpan ??= 14;
  p.swing ??= { amount: 0.5, unit: 8 };
  return p;
}

export type ParsedProject = { ok: true; project: Project } | { ok: false; errors: string[] };

/** Migrate and validate anything that claims to be a project. Never throws. */
export function parseProject(raw: unknown): ParsedProject {
  if (!raw || typeof raw !== "object") return { ok: false, errors: ["This is not a project: it is not an object."] };
  const format = (raw as { format?: unknown }).format;
  if (format !== PROJECT_FORMAT) {
    return {
      ok: false,
      errors: [
        typeof format === "string"
          ? `This is not a project this version can open: its format is "${format}", not "${PROJECT_FORMAT}".`
          : `This is not a project: it has no "format" field saying "${PROJECT_FORMAT}".`,
      ],
    };
  }
  const result = ProjectSchema.safeParse(migrate(raw));
  if (result.success) return { ok: true, project: result.data };
  return {
    ok: false,
    errors: result.error.issues.slice(0, 20).map((issue) => {
      const where = issue.path.map(String).join(".");
      return where ? `${where}: ${issue.message}` : issue.message;
    }),
  };
}
