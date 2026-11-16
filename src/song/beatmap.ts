import type { Song } from "./types";

/**
 * Where the beats of a song fall, in seconds: how Practice counts along. The same idea as a TimeMap,
 * for the playback format. See docs/plan/contracts.md §1.
 */
export interface BeatMap {
  /** Fractional beat index at a time; beat 0 is the first downbeat. */
  beatAt(seconds: number): number;
  secondsAt(beat: number): number;
  beatsPerBar: number;
}

/**
 * Constant tempo when the song has only `bpm`; piecewise when it has `tempoMap`; null when it has
 * neither (free time: no honest grid to draw).
 *
 * For a constant tempo with no offset, `beatAt(t)` is exactly `t / (60 / bpm)` and `secondsAt(b)` is
 * exactly `b * (60 / bpm)`: the arithmetic Practice used before it had a BeatMap, bit for bit.
 */
export function beatMapOf(song: Pick<Song, "bpm" | "timeSignature" | "gridOffset" | "tempoMap">): BeatMap | null {
  const beatsPerBar = song.timeSignature?.[0] ?? 4;
  const offset = song.gridOffset ?? 0;
  const changes = (song.tempoMap ?? []).filter((e) => e.bpm > 0).sort((a, b) => a.time - b.time);

  if (!changes.length) {
    if (!song.bpm) return null;
    const beat = 60 / song.bpm;
    if (offset === 0) return { beatAt: (t) => t / beat, secondsAt: (b) => b * beat, beatsPerBar };
    return { beatAt: (t) => (t - offset) / beat, secondsAt: (b) => offset + b * beat, beatsPerBar };
  }

  // Segments of constant tempo. The first tempo also governs anything before it.
  const segs = changes.map((e) => ({ time: e.time, length: 60 / e.bpm, beat: 0 }));
  for (let i = 1; i < segs.length; i++) {
    segs[i].beat = segs[i - 1].beat + (segs[i].time - segs[i - 1].time) / segs[i - 1].length;
  }
  const raw = (t: number) => {
    let i = segs.length - 1;
    while (i > 0 && segs[i].time > t) i--;
    return segs[i].beat + (t - segs[i].time) / segs[i].length;
  };
  // Beat 0 is the first downbeat, wherever the tempo map puts it.
  const zero = raw(offset);
  return {
    beatAt: (t) => raw(t) - zero,
    secondsAt(b) {
      const target = b + zero;
      let i = segs.length - 1;
      while (i > 0 && segs[i].beat > target) i--;
      return segs[i].time + (target - segs[i].beat) * segs[i].length;
    },
    beatsPerBar,
  };
}
