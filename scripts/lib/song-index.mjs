// The song bank's index: what is worked out from each song file, and what a person decides.
// Used by scripts/songs-index.mjs and scripts/midi-to-song.mjs.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const PREVIEW_SLICES = 48;

/** Fields a person sets; the indexer never touches them. */
export const AUTHORED = ["genre", "tags", "difficulty", "addedAt"];
/** Fields worked out from the song file; never edited by hand. */
export const DERIVED = ["duration", "bpm", "key", "noteCount", "range", "preview"];

const round = (x, places) => Math.round(x * 10 ** places) / 10 ** places;

/** The notes the app would actually play: the same filter as `normalize` in src/song/normalize.ts. */
const playable = (song) => song.notes.filter((n) => n.duration > 0 && n.pitch >= 21 && n.pitch <= 108);

/**
 * How busy the song is over time, as 48 numbers from 0 to 1 for the card thumbnail. Each slice holds
 * the total time notes sound within it — a chord counts once per note — scaled so the busiest slice
 * is 1.
 */
export function preview(notes, duration, slices = PREVIEW_SLICES) {
  const out = new Array(slices).fill(0);
  if (!(duration > 0)) return out;
  const width = duration / slices;
  for (const n of notes) {
    const end = Math.min(n.time + n.duration, duration);
    const first = Math.max(0, Math.floor(n.time / width));
    const last = Math.min(slices - 1, Math.floor((end - 1e-9) / width));
    for (let i = first; i <= last; i++) {
      out[i] += Math.max(0, Math.min(end, (i + 1) * width) - Math.max(n.time, i * width));
    }
  }
  const max = Math.max(...out);
  return out.map((v) => (max > 0 ? round(v / max, 2) : 0));
}

/** Everything the index says about a song that can be read off the song itself. */
export function derive(song) {
  const notes = playable(song);
  const lastEnd = notes.reduce((m, n) => Math.max(m, n.time + n.duration), 0);
  const duration = round(song.duration ?? lastEnd, 2);
  const pitches = notes.map((n) => n.pitch);
  return {
    duration,
    ...(song.bpm ? { bpm: song.bpm } : {}),
    ...(song.key ? { key: song.key } : {}),
    noteCount: notes.length,
    ...(notes.length ? { range: [Math.min(...pitches), Math.max(...pitches)] } : {}),
    preview: preview(notes, duration),
  };
}

const ORDER = ["id", "title", "artist", "file", ...AUTHORED, ...DERIVED];

/** One index entry: identity and authored fields kept, derived fields replaced. */
export function refreshEntry(entry, song) {
  const kept = Object.fromEntries(Object.entries(entry).filter(([k]) => !DERIVED.includes(k)));
  const merged = { ...kept, ...derive(song) };
  const ordered = {};
  for (const k of ORDER) if (merged[k] !== undefined) ordered[k] = merged[k];
  for (const k of Object.keys(merged)) if (!(k in ordered)) ordered[k] = merged[k]; // anything unknown, last
  return ordered;
}

/** One entry per line, so adding a song is a one-line diff. */
export function formatIndex(entries) {
  return `[\n${entries.map((e) => `  ${JSON.stringify(e)}`).join(",\n")}\n]\n`;
}

/** Read the index at `indexPath`, refresh every entry from its song file, and return both texts. */
export function rebuildIndex(indexPath) {
  const before = readFileSync(indexPath, "utf8");
  const entries = JSON.parse(before).map((entry) => {
    const song = JSON.parse(readFileSync(join(dirname(indexPath), entry.file), "utf8"));
    if (song.id !== entry.id)
      throw new Error(`${entry.file}: its id is "${song.id}" but the index calls it "${entry.id}"`);
    return refreshEntry(entry, song);
  });
  return { before, after: formatIndex(entries), entries };
}

/** Add an entry, or replace the one with the same id, then refresh the whole index. */
export function upsertEntry(indexPath, entry) {
  const entries = JSON.parse(readFileSync(indexPath, "utf8"));
  const at = entries.findIndex((e) => e.id === entry.id);
  if (at >= 0) entries[at] = { ...entries[at], ...entry };
  else entries.push(entry);
  writeFileSync(indexPath, formatIndex(entries));
  const { after } = rebuildIndex(indexPath);
  writeFileSync(indexPath, after);
}
