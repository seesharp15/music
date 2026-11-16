import { afterEach, describe, expect, it, vi } from "vitest";
import type { Player } from "./audio/player";
import { mixOf, restoreSession, saveSession } from "./session";

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

/** Just enough of a player to see what a restore asks of it. */
function fakePlayer(duration = 200) {
  const calls: Record<string, unknown> = {};
  const player = {
    duration,
    setRate: vi.fn((r) => (calls.rate = r)),
    setMix: vi.fn((m) => (calls.mix = m)),
    setLoop: vi.fn((l) => (calls.loop = l)),
    setWindow: vi.fn((w) => (calls.window = w)),
    seek: vi.fn((t) => (calls.time = t)),
  };
  return { player: player as unknown as Player, calls };
}

describe("restoring a session", () => {
  it("puts back position, speed, loop, zoom and the hands' volumes", () => {
    const saved = {
      time: 42,
      rate: 0.75,
      loop: { enabled: true, start: 10, end: 20 },
      window: { start: 5, end: 30 },
      mix: { L: { volume: 0.6, muted: false }, R: { volume: 1, muted: true } },
    };
    sessionStorage.setItem("piano-tutor:session:song", JSON.stringify(saved));
    const { player, calls } = fakePlayer();
    restoreSession(player, "song");
    expect(calls).toEqual(saved);
  });

  it("reads a session saved when hands were On / Soft / Off", () => {
    sessionStorage.setItem("piano-tutor:session:song", JSON.stringify({ time: 3, levels: { L: "soft", R: "off" } }));
    const { player, calls } = fakePlayer();
    restoreSession(player, "song");
    expect(calls.mix).toEqual({ L: { volume: 0.47, muted: false }, R: { volume: 1, muted: true } });
  });

  it("does nothing for a song never opened, or a session that will not parse", () => {
    const a = fakePlayer();
    restoreSession(a.player, "song");
    expect(a.calls).toEqual({});
    sessionStorage.setItem("piano-tutor:session:song", "{not json");
    const b = fakePlayer();
    restoreSession(b.player, "song");
    expect(b.calls).toEqual({});
  });

  it("falls back to where the Library last saw the song, unless it had reached the end", () => {
    localStorage.setItem(
      "piano-tutor:recent",
      JSON.stringify([{ id: "song", at: "2026-01-01", time: 61, duration: 200 }]),
    );
    const a = fakePlayer(200);
    restoreSession(a.player, "song");
    expect(a.calls).toEqual({ time: 61 });
    localStorage.setItem(
      "piano-tutor:recent",
      JSON.stringify([{ id: "song", at: "2026-01-01", time: 199.5, duration: 200 }]),
    );
    const b = fakePlayer(200);
    restoreSession(b.player, "song");
    expect(b.calls).toEqual({});
  });
});

describe("mixOf", () => {
  it("prefers the new shape, falls back to the old one, and otherwise gives nothing", () => {
    const mix = { L: { volume: 0.5, muted: false }, R: { volume: 1, muted: false } };
    expect(mixOf({ mix, levels: { L: "off", R: "off" } })).toEqual(mix);
    expect(mixOf({ levels: { L: "on", R: "soft" } })?.R.volume).toBe(0.47);
    expect(mixOf({})).toBeNull();
    expect(mixOf({ mix: "nonsense" })).toBeNull();
  });
});

describe("saving a session", () => {
  const playerAt = (time: number) =>
    ({
      duration: 200,
      currentTime: () => time,
      state: { rate: 1, loop: { enabled: false, start: 0, end: 200 }, window: null, mix: mixOf({ levels: {} }) },
    }) as unknown as Player;

  it("writes the hands' volumes", () => {
    saveSession(playerAt(0), "song");
    expect(JSON.parse(sessionStorage.getItem("piano-tutor:session:song")!).mix.L).toEqual({ volume: 1, muted: false });
  });

  it("lists the song for the Library once a second of it has gone by", () => {
    saveSession(playerAt(0.4), "song");
    expect(localStorage.getItem("piano-tutor:recent")).toBeNull();
    saveSession(playerAt(12), "song");
    expect(JSON.parse(localStorage.getItem("piano-tutor:recent")!)[0]).toMatchObject({
      id: "song",
      time: 12,
      duration: 200,
    });
  });
});
