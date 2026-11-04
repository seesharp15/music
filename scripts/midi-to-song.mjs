#!/usr/bin/env node
// Convert a MIDI file into a piano-song/v1 JSON file.
// Usage: node scripts/midi-to-song.mjs in.mid out.json --id x --title "X" [--artist A] [--source URL] [--split 60]
import { readFileSync, writeFileSync } from "node:fs";
import midiPkg from "@tonejs/midi";

const { Midi } = midiPkg;

const args = process.argv.slice(2);
const positional = [];
const opts = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) opts[args[i].slice(2)] = args[++i];
  else positional.push(args[i]);
}
const [input, output] = positional;
if (!input || !output || !opts.id || !opts.title) {
  console.error(
    'Usage: midi-to-song <in.mid> <out.json> --id <id> --title "<title>" [--artist A] [--source URL] [--split 60]',
  );
  process.exit(1);
}

const midi = new Midi(readFileSync(input));
const split = Number(opts.split ?? 60);
const tracks = midi.tracks.filter((t) => t.notes.length > 0);
const byTrack = tracks.length >= 2;

const round = (x) => Math.round(x * 1000) / 1000;
const notes = [];
tracks.forEach((track, ti) => {
  for (const n of track.notes) {
    const hand = byTrack ? (ti === 0 ? "R" : "L") : n.midi < split ? "L" : "R";
    notes.push({
      pitch: n.midi,
      time: round(n.time),
      duration: round(Math.max(n.duration, 0.05)),
      hand,
      velocity: round(n.velocity),
    });
  }
});
notes.sort((a, b) => a.time - b.time || a.pitch - b.pitch);

const tempo = midi.header.tempos[0]?.bpm;
const ts = midi.header.timeSignatures[0]?.timeSignature;
const song = {
  format: "piano-song/v1",
  id: opts.id,
  title: opts.title,
  ...(opts.artist && { artist: opts.artist }),
  ...(opts.source && { source: opts.source }),
  ...(tempo && { bpm: Math.round(tempo) }),
  ...(ts && { timeSignature: ts }),
  duration: round(Math.max(...notes.map((n) => n.time + n.duration))),
  sections: [],
  notes,
};

writeFileSync(output, JSON.stringify(song, null, 1) + "\n");
console.log(`Wrote ${notes.length} notes (${song.duration}s) to ${output}`);
