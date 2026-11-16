import { describe, expect, it } from "vitest";
import { projectFileName, readFile, slug, songFileName, writeProjectFile, writeSongFile } from "./file";
import { projectMeta } from "./meta";
import { newProject } from "./new";
import { applyOps } from "./ops";
import { randomOp, rng } from "./testing/random";
import type { Project } from "./types";

function busy(seed: number): Project {
  const r = rng(seed);
  let p = newProject({ id: `p${seed}`, title: "Für Elise (my version)", now: new Date("2026-11-16T12:00:00Z") });
  for (let i = 0; i < 150; i++) {
    const op = randomOp(p, r, i);
    // A patch that removes a field is written as `undefined`, which a file cannot hold; it has done
    // its work by the time the project is saved, so it does not matter here.
    p = applyOps(p, [op]);
  }
  return p;
}

describe("project files", () => {
  // Acceptance criterion 13 (the browser half is in e2e/storage.spec.ts).
  it.each([1, 2, 3, 4])("seed %i: writing a project and reading it back gives a deep-equal project", (seed) => {
    const p = busy(seed);
    const read = readFile(writeProjectFile(p));
    expect(read.ok && read.kind).toBe("project");
    if (read.ok && read.kind === "project") expect(read.project).toEqual(JSON.parse(JSON.stringify(p)));
  });

  it("names files after the song", () => {
    expect(slug("Für Elise (my version)")).toBe("fur-elise-my-version");
    expect(slug("  ")).toBe("untitled");
    expect(slug("日本語")).toBe("untitled");
    expect(projectFileName({ title: "My Song" })).toBe("my-song.piano-project.json");
    expect(songFileName({ title: "My Song" })).toBe("my-song.piano-song.json");
  });

  it("reads a song file too", () => {
    const text = writeSongFile({
      format: "piano-song/v2",
      id: "u-x",
      title: "S",
      notes: [{ pitch: 60, time: 0, duration: 1, hand: "R" }],
    });
    const read = readFile(text);
    expect(read.ok && read.kind).toBe("song");
  });

  const refusals: [string, string, RegExp][] = [
    ["an empty file", "", /empty/],
    ["text that is not JSON", "hello there", /not valid JSON/],
    ["JSON cut off part-way", '{"format":"piano-project/v1","id":"x","tit', /not valid JSON/],
    ["a list", "[1,2,3]", /does not hold a single song or project/],
    ["a number", "42", /does not hold a single song or project/],
    ["JSON of something else", '{"name":"package","version":"1.0.0"}', /no "format" field/],
    ["a format from the future", '{"format":"piano-project/v7"}', /"piano-project\/v7".*cannot open/],
    [
      "a project missing most of itself",
      '{"format":"piano-project/v1","id":"x"}',
      /project file is damaged — title: .*more problems/,
    ],
    [
      "a song with a broken note",
      '{"format":"piano-song/v1","id":"x","title":"T","notes":[{"pitch":"C"}]}',
      /song file is damaged — notes\.0\.pitch/,
    ],
  ];
  it.each(refusals)("refuses %s with a message that names the problem", (_name, text, pattern) => {
    const read = readFile(text);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.message).toMatch(pattern);
  });

  it("refuses a project with one bad value, naming it", () => {
    const p = JSON.parse(writeProjectFile(busy(1))) as Project;
    p.tempo[0].bpm = -5;
    const read = readFile(JSON.stringify(p));
    expect(!read.ok && read.message).toMatch(/project file is damaged — tempo\.0\.bpm/);
    expect(!read.ok && read.errors).toHaveLength(1);
  });
});

describe("projectMeta", () => {
  it("counts bars and draws the thumbnail", () => {
    const p = applyOps(newProject({ id: "x", title: "T", bars: 4 }), [
      { op: "addNotes", trackId: "melody", notes: [{ pitch: 60, tick: 0, dur: 1920, vel: 0.7, origin: "manual" }] },
    ]);
    const meta = projectMeta(p);
    expect(meta).toMatchObject({ id: "x", title: "T", bars: 4, updatedAt: p.updatedAt });
    expect(meta.preview).toHaveLength(48);
    expect(meta.preview.slice(0, 12)).toEqual(new Array(12).fill(1));
    expect(meta.preview[12]).toBe(0);
  });
  it("counts a last part-bar, and bars of different lengths", () => {
    const waltz = newProject({ meter: [3, 4], bars: 5 });
    expect(projectMeta(waltz).bars).toBe(5);
    expect(projectMeta(applyOps(waltz, [{ op: "patchSong", patch: { lengthTicks: 5 * 1440 + 1 } }])).bars).toBe(6);
    expect(projectMeta({ ...waltz, lengthTicks: 0 }).bars).toBe(0);
  });
});
