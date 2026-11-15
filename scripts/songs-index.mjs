#!/usr/bin/env node
// Refresh the derived fields of public/songs/index.json from the song files.
//   node scripts/songs-index.mjs           rewrite the index
//   node scripts/songs-index.mjs --check   fail if the index is out of date (used in CI)
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rebuildIndex } from "./lib/song-index.mjs";

const indexPath = fileURLToPath(new URL("../public/songs/index.json", import.meta.url));
const check = process.argv.includes("--check");

const { before, after, entries } = rebuildIndex(indexPath);
if (before === after) {
  console.log(`Song index is up to date (${entries.length} songs).`);
} else if (check) {
  console.error("public/songs/index.json is out of date. Run `npm run songs:index` and commit the result.");
  process.exit(1);
} else {
  writeFileSync(indexPath, after);
  console.log(`Rewrote the song index (${entries.length} songs).`);
}
