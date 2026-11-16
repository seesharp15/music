/**
 * What a song file must look like. Used where a song comes from outside the app's own build — a file
 * the user picks, a stored user song — never on the bank's own files, so Practice does not carry it.
 * (It also must not import anything Practice loads first: see the note in src/library/catalog.ts.)
 */
import { z } from "zod";
import { DRUM_PADS, SOUND_IDS } from "./ids";
import type { Song } from "./types";

const seconds = z.number().finite();
const Hand = z.enum(["L", "R"]);

const Note = z.object({
  pitch: z.number().int(),
  time: seconds.nonnegative(),
  duration: seconds,
  hand: Hand,
  velocity: z.number().min(0).max(1).optional(),
  track: z.string().optional(),
});

export const SongSchema = z.object({
  format: z.enum(["piano-song/v1", "piano-song/v2"]),
  id: z.string().min(1),
  title: z.string(),
  artist: z.string().optional(),
  arranger: z.string().optional(),
  source: z.string().optional(),
  bpm: z.number().positive().optional(),
  timeSignature: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
  duration: seconds.nonnegative().optional(),
  sections: z.array(z.object({ name: z.string(), start: seconds, end: seconds })).optional(),
  notes: z.array(Note),
  key: z.string().optional(),
  gridOffset: seconds.optional(),
  tempoMap: z.array(z.object({ time: seconds, bpm: z.number().positive() })).optional(),
  tracks: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        role: z.enum(["melody", "chords", "bass", "counter", "free"]),
        sound: z.enum(SOUND_IDS).optional(),
        volume: z.number().min(0).max(1).optional(),
      }),
    )
    .optional(),
  chords: z.array(z.object({ time: seconds, duration: seconds, symbol: z.string() })).optional(),
  drums: z
    .object({
      kit: z.string(),
      volume: z.number().min(0).max(1).optional(),
      hits: z.array(z.object({ pad: z.enum(DRUM_PADS), time: seconds, velocity: z.number().min(0).max(1).optional() })),
    })
    .optional(),
  pedal: z.array(z.object({ time: seconds, down: z.boolean() })).optional(),
  origin: z
    .object({
      kind: z.enum(["bank", "studio", "import"]),
      projectId: z.string().optional(),
      createdAt: z.string().optional(),
    })
    .optional(),
});

export type ParsedSong = { ok: true; song: Song } | { ok: false; errors: string[] };

/**
 * Validate anything that claims to be a song. Never throws. The song comes back as it was written:
 * like a bank song, it is normalized when it is loaded to be played (`normalize`), not here.
 */
export function parseSong(raw: unknown): ParsedSong {
  if (!raw || typeof raw !== "object") return { ok: false, errors: ["This is not a song: it is not an object."] };
  const format = (raw as { format?: unknown }).format;
  if (format !== "piano-song/v1" && format !== "piano-song/v2") {
    return {
      ok: false,
      errors: [
        typeof format === "string"
          ? `This is not a song this version can open: its format is "${format}".`
          : 'This is not a song: it has no "format" field saying "piano-song/v1" or "piano-song/v2".',
      ],
    };
  }
  const result = SongSchema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.slice(0, 20).map((issue) => {
        const where = issue.path.map(String).join(".");
        return where ? `${where}: ${issue.message}` : issue.message;
      }),
    };
  }
  return { ok: true, song: result.data as Song };
}
