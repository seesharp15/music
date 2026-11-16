import { describe, expect, it } from "vitest";
import { keySpan } from "../components/keyboard";
import {
  initialState,
  keyVelocity,
  LONG_PRESS_MS,
  step,
  type Env,
  type Input,
  type Intent,
  type PointerKind,
} from "./interaction";
import { frame, keyRect, noteRect, type NoteBox, type View } from "./view";

/** A phone-sized canvas showing C4 to B5; a quarter note is 40 px tall; the line is on tick 960. */
const view: View = {
  width: 390,
  height: 600,
  barGutter: 26,
  chordGutter: 46,
  lane: 0,
  kbH: 140,
  tick: 960,
  ticksPerPx: 12,
  keyLo: keySpan(60)[0],
  keyHi: keySpan(60)[0] + 14,
};
// E4 on beat 3 of bar 1, G4 on beat 1 of bar 2, and a long C5.
const notes: NoteBox[] = [
  { id: 1, pitch: 64, tick: 960, dur: 480 },
  { id: 2, pitch: 67, tick: 1920, dur: 480 },
  { id: 3, pitch: 72, tick: 1440, dur: 960 },
];
const env = (patch: Partial<Env> = {}): Env => ({
  view,
  tool: "select",
  readOnly: false,
  notes,
  selection: new Set(),
  snap: 120,
  addToSelection: false,
  ...patch,
});

const centre = (id: number) => {
  const r = noteRect(
    view,
    notes.find((n) => n.id === id)!,
  );
  return { x: r.x + r.w / 2, y: (r.top + r.bottom) / 2 + 6 };
};
const keyX = (pitch: number) => {
  const k = keyRect(view, pitch);
  return k.x + k.w / 2;
};
const EMPTY = { x: keyX(70), y: 60 };

type Ev = [
  kind: "down" | "move" | "up" | "cancel",
  x: number,
  y: number,
  more?: { id?: number; shift?: boolean; alt?: boolean; t?: number },
];

/** Run a sequence of pointer events through the machine and collect what it asks for. */
function run(events: (Ev | Input)[], e: Env = env(), pointer: PointerKind = "mouse"): Intent[] {
  let state = initialState();
  const out: Intent[] = [];
  let t = 0;
  for (const ev of events) {
    const input: Input = Array.isArray(ev)
      ? {
          kind: ev[0],
          x: ev[1],
          y: ev[2],
          id: ev[3]?.id ?? 1,
          t: ev[3]?.t ?? (t += 16),
          pointer,
          shift: ev[3]?.shift,
          alt: ev[3]?.alt,
        }
      : ev;
    const next = step(state, input, e);
    state = next.state;
    out.push(...next.intents);
  }
  return out;
}
const types = (intents: Intent[]) => intents.map((i) => i.type);
const last = <T extends Intent["type"]>(intents: Intent[], type: T) =>
  [...intents].reverse().find((i): i is Extract<Intent, { type: T }> => i.type === type);

describe("taps", () => {
  it("on a note selects it and sounds it", () => {
    const p = centre(1);
    expect(
      run([
        ["down", p.x, p.y],
        ["up", p.x, p.y],
      ]),
    ).toEqual([
      { type: "select", ids: [1], mode: "replace" },
      { type: "audition", pitch: 64 },
    ]);
  });

  it("with Shift, or with 'add to selection' on, adds or removes it", () => {
    const p = centre(2);
    expect(
      run([
        ["down", p.x, p.y, { shift: true }],
        ["up", p.x, p.y],
      ])[0],
    ).toEqual({ type: "select", ids: [2], mode: "toggle" });
    expect(
      run(
        [
          ["down", p.x, p.y],
          ["up", p.x, p.y],
        ],
        env({ addToSelection: true }),
      )[0],
    ).toEqual({
      type: "select",
      ids: [2],
      mode: "toggle",
    });
  });

  it("on empty space clears the selection with the Select tool, and does nothing when there is none", () => {
    const tap: Ev[] = [
      ["down", EMPTY.x, EMPTY.y],
      ["up", EMPTY.x, EMPTY.y],
    ];
    expect(run(tap, env({ selection: new Set([1]) }))).toEqual([{ type: "select", ids: [], mode: "replace" }]);
    expect(run(tap)).toEqual([]);
  });

  it("on empty space with the Draw tool adds a note on that key, filling the grid cell touched", () => {
    // y = 60 is tick 960 + (276 − 60) × 12 = 3552: the sixteenth that starts at 3480.
    expect(
      run(
        [
          ["down", EMPTY.x, EMPTY.y],
          ["up", EMPTY.x, EMPTY.y],
        ],
        env({ tool: "draw" }),
      ),
    ).toEqual([{ type: "add", pitch: 70, tick: 3480 }]);
  });

  it("in the bar gutter moves the cursor there; in the chord gutter opens the chord at that place", () => {
    expect(
      run([
        ["down", 10, 236],
        ["up", 10, 236],
      ]),
    ).toEqual([{ type: "cursor", tick: 1440 }]);
    expect(
      run([
        ["down", 40, 236],
        ["up", 40, 236],
      ]),
    ).toEqual([{ type: "chord", tick: 1440 }]);
  });

  it("a small wobble is still a tap", () => {
    const p = centre(1);
    expect(
      types(
        run([
          ["down", p.x, p.y],
          ["move", p.x + 2, p.y + 2],
          ["up", p.x + 2, p.y + 2],
        ]),
      ),
    ).toEqual(["select", "audition"]);
    expect(
      types(
        run(
          [
            ["down", p.x, p.y],
            ["move", p.x + 7, p.y + 5],
            ["up", p.x + 7, p.y + 5],
          ],
          env(),
          "touch",
        ),
      ),
    ).toEqual(["select", "audition"]);
  });
});

describe("moving", () => {
  it("dragging a note two keys right and one beat later moves it by exactly that", () => {
    const p = centre(1);
    const to = { x: keyX(66), y: p.y - 40 };
    const out = run([
      ["down", p.x, p.y],
      ["move", (p.x + to.x) / 2, p.y - 20],
      ["move", to.x, to.y],
      ["up", to.x, to.y],
    ]);
    expect(out[0]).toEqual({ type: "select", ids: [1], mode: "replace" });
    expect(last(out, "move")).toEqual({ type: "move", ids: [1], dTick: 480, dPitch: 2, copy: false });
    // The preview follows the drag and is cleared at the end; each new key is sounded once.
    expect(out.filter((i) => i.type === "audition")).toEqual([
      { type: "audition", pitch: 65 },
      { type: "audition", pitch: 66 },
    ]);
    expect(out.at(-2)).toEqual({ type: "preview", drag: null });
  });

  it("snaps to the grid, and a drag that ends where it began changes nothing", () => {
    const p = centre(1);
    const nearly = run([
      ["down", p.x, p.y],
      ["move", p.x, p.y - 13],
      ["up", p.x, p.y - 13],
    ]);
    expect(last(nearly, "move")).toMatchObject({ dTick: 120, dPitch: 0 });
    const back = run([
      ["down", p.x, p.y],
      ["move", p.x, p.y - 30],
      ["move", p.x, p.y - 3],
      ["up", p.x, p.y - 3],
    ]);
    expect(types(back)).not.toContain("move");
  });

  it("dragging a selected note moves the whole selection; nothing leaves the piano or the start of the song", () => {
    const p = centre(1);
    const sel = env({ selection: new Set([1, 2]) });
    const out = run(
      [
        ["down", p.x, p.y],
        ["move", p.x - 300, p.y + 900],
        ["up", p.x - 300, p.y + 900],
      ],
      sel,
    );
    expect(types(out)).not.toContain("select");
    // Both notes go together: as far left as the keys shown, and no earlier than tick 0.
    expect(last(out, "move")).toEqual({ type: "move", ids: [1, 2], dTick: -960, dPitch: -4, copy: false });
  });

  it("with Alt it is a copy, even when dropped where it started", () => {
    const p = centre(1);
    const out = run([
      ["down", p.x, p.y, { alt: true }],
      ["move", p.x, p.y - 40, { alt: true }],
      ["up", p.x, p.y - 40],
    ]);
    expect(last(out, "move")).toMatchObject({ copy: true, dTick: 480 });
  });

  it("Escape abandons it", () => {
    const p = centre(1);
    const out = run([["down", p.x, p.y], ["move", p.x, p.y - 40], { kind: "escape" }, ["up", p.x, p.y - 40]]);
    expect(types(out)).not.toContain("move");
    expect(out.at(-1)).toEqual({ type: "preview", drag: null });
  });
});

describe("resizing", () => {
  const r = noteRect(view, notes[2]); // the long C5
  const handle = { x: r.x + r.w / 2, y: r.top + 3 };

  it("dragging a note's top edge up makes it longer, by grid steps", () => {
    const out = run([
      ["down", handle.x, handle.y],
      ["move", handle.x, handle.y - 21],
      ["up", handle.x, handle.y - 21],
    ]);
    expect(last(out, "resize")).toEqual({ type: "resize", ids: [3], dDur: 240 });
    expect(last(out, "preview")).toEqual({ type: "preview", drag: null });
  });

  it("it cannot be made shorter than one grid step", () => {
    const out = run([
      ["down", handle.x, handle.y],
      ["move", handle.x, handle.y + 300],
      ["up", handle.x, handle.y + 300],
    ]);
    expect(last(out, "resize")).toEqual({ type: "resize", ids: [3], dDur: -840 });
  });
});

describe("the Erase tool", () => {
  const erase = env({ tool: "erase" });
  it("a tap removes the note under it", () => {
    const p = centre(2);
    expect(
      run(
        [
          ["down", p.x, p.y],
          ["up", p.x, p.y],
        ],
        erase,
      ).at(-1),
    ).toEqual({ type: "erase", ids: [2] });
  });

  it("a sweep removes every note it crosses, as one erase at the end", () => {
    const a = centre(1);
    const b = centre(2);
    const out = run(
      [
        ["down", EMPTY.x, 300],
        ["move", a.x, a.y],
        ["move", b.x, b.y],
        ["move", EMPTY.x, 20],
        ["up", EMPTY.x, 20],
      ],
      erase,
      "touch",
    );
    expect(out.filter((i) => i.type === "erase")).toEqual([{ type: "erase", ids: [1, 2] }]);
    expect(types(out)).not.toContain("scroll");
    const ghosts = out.filter((i): i is Extract<Intent, { type: "preview" }> => i.type === "preview" && !!i.drag);
    expect(ghosts.at(-1)!.drag).toMatchObject({ erase: true });
  });
});

describe("drags across empty space", () => {
  it("with a mouse and the Select tool, draw a box and select what it touches", () => {
    const out = run([
      ["down", keyX(62), 300],
      ["move", keyX(69), 150],
      ["up", keyX(69), 150],
    ]);
    expect(out[0]).toMatchObject({ type: "box", box: { x0: keyX(62), y0: 300, x1: keyX(69), y1: 150 } });
    expect(out.slice(-2)).toEqual([
      { type: "box", box: null },
      { type: "select", ids: [1, 2], mode: "replace" },
    ]);
  });

  it("with a finger, scroll — and the cursor settles when the finger lifts", () => {
    const out = run(
      [
        ["down", EMPTY.x, 100],
        ["move", EMPTY.x, 130],
        ["move", EMPTY.x, 160],
        ["up", EMPTY.x, 160],
      ],
      env(),
      "touch",
    );
    expect(out).toEqual([{ type: "scroll", px: 30 }, { type: "scroll", px: 30 }, { type: "scrollEnd" }]);
  });

  it("a finger held still, then dragged, draws a box", () => {
    const out = run(
      [
        ["down", keyX(62), 300, { t: 0 }],
        { kind: "time", t: LONG_PRESS_MS },
        ["move", keyX(69), 150],
        ["up", keyX(69), 150],
      ],
      env(),
      "touch",
    );
    expect(types(out)).toEqual(["box", "box", "box", "select"]);
    expect(out.at(-1)).toEqual({ type: "select", ids: [1, 2], mode: "replace" });
  });

  it("with the Draw tool, a mouse drag scrolls too", () => {
    expect(
      types(
        run(
          [
            ["down", EMPTY.x, 100],
            ["move", EMPTY.x, 140],
            ["up", EMPTY.x, 140],
          ],
          env({ tool: "draw" }),
        ),
      ),
    ).toEqual(["scroll", "scrollEnd"]);
  });

  it("the gutters always scroll", () => {
    expect(
      types(
        run(
          [
            ["down", 10, 100],
            ["move", 10, 150],
            ["up", 10, 150],
          ],
          env({ tool: "erase" }),
        ),
      ),
    ).toEqual(["scroll", "scrollEnd"]);
  });
});

describe("two fingers", () => {
  it("pinch to zoom about the point between them; a finger that stays down afterwards does nothing", () => {
    let state = initialState();
    const feed = (kind: "down" | "move" | "up", id: number, x: number, y: number) => {
      const next = step(state, { kind, id, x, y, t: 0, pointer: "touch" }, env());
      state = next.state;
      return next.intents;
    };
    feed("down", 1, 200, 100);
    expect(feed("down", 2, 200, 300)).toEqual([]);
    // Fingers apart: the spread doubles, so half as much music is shown.
    expect(feed("move", 2, 200, 500)).toEqual([{ type: "zoom", factor: 0.5, y: 300 }]);
    expect(feed("up", 2, 200, 500)).toEqual([]);
    expect(feed("move", 1, 200, 160)).toEqual([]);
    expect(feed("up", 1, 200, 160)).toEqual([{ type: "scrollEnd" }]);
    // And the next touch is an ordinary one again.
    const p = centre(1);
    feed("down", 3, p.x, p.y);
    expect(types(feed("up", 3, p.x, p.y))).toEqual(["select", "audition"]);
  });

  it("a second finger abandons a move in progress", () => {
    const p = centre(1);
    let state = initialState();
    const out: Intent[] = [];
    for (const input of [
      { kind: "down", id: 1, x: p.x, y: p.y },
      { kind: "move", id: 1, x: p.x, y: p.y - 60 },
      { kind: "down", id: 2, x: p.x + 80, y: 100 },
      { kind: "up", id: 1, x: p.x, y: p.y - 60 },
      { kind: "up", id: 2, x: p.x + 80, y: 100 },
    ] as const) {
      const next = step(state, { ...input, t: 0, pointer: "touch" }, env());
      state = next.state;
      out.push(...next.intents);
    }
    expect(types(out)).not.toContain("move");
    expect(out).toContainEqual({ type: "preview", drag: null });
  });
});

describe("the wheel", () => {
  it("scrolls, and with Ctrl or ⌘ zooms about the pointer", () => {
    expect(run([{ kind: "wheel", x: 200, y: 100, dy: 60, zoom: false }])).toEqual([{ type: "scroll", px: -60 }]);
    const [zoom] = run([{ kind: "wheel", x: 200, y: 100, dy: 240, zoom: true }]);
    expect(zoom).toMatchObject({ type: "zoom", y: 100 });
    expect((zoom as { factor: number }).factor).toBeCloseTo(Math.E, 9);
  });
});

describe("the keyboard", () => {
  const f = frame(view);
  const white = f.bottom + view.kbH * 0.85;

  it("a key goes down when touched and comes up when let go, whatever tool is in hand", () => {
    for (const tool of ["select", "draw", "erase"] as const) {
      const out = run(
        [
          ["down", keyX(64), white],
          ["up", keyX(64), white],
        ],
        env({ tool }),
      );
      expect(out).toEqual([
        { type: "keyDown", id: 1, pitch: 64, velocity: keyVelocity(view, 64, white) },
        { type: "keyUp", id: 1 },
      ]);
    }
  });

  it("touched nearer its tip, a key is struck harder", () => {
    const soft = keyVelocity(view, 64, f.bottom + 10);
    const hard = keyVelocity(view, 64, f.bottom + view.kbH - 4);
    expect(soft).toBeLessThan(0.5);
    expect(hard).toBeGreaterThan(0.9);
    expect(keyVelocity(view, 61, f.bottom + 3 + (view.kbH - 3) * 0.62)).toBeCloseTo(0.95, 2);
  });

  it("three fingers hold three keys at once", () => {
    let state = initialState();
    const out: Intent[] = [];
    for (const [kind, id, pitch] of [
      ["down", 1, 60],
      ["down", 2, 64],
      ["down", 3, 67],
      ["up", 2, 64],
      ["up", 1, 60],
      ["up", 3, 67],
    ] as const) {
      const next = step(state, { kind, id, x: keyX(pitch), y: white, t: 0, pointer: "touch" }, env());
      state = next.state;
      out.push(...next.intents);
    }
    expect(out.map((i) => (i.type === "keyDown" ? `+${i.pitch}` : i.type === "keyUp" ? `-${i.id}` : "?"))).toEqual([
      "+60",
      "+64",
      "+67",
      "-2",
      "-1",
      "-3",
    ]);
    expect(state.keys.size).toBe(0);
  });

  it("sliding along the keys plays each one reached", () => {
    const out = run([
      ["down", keyX(60), white],
      ["move", keyX(62), white],
      ["move", keyX(62) + 1, white],
      ["up", keyX(62), white],
    ]);
    expect(types(out)).toEqual(["keyDown", "keyUp", "keyDown", "keyUp"]);
    expect(out[2]).toMatchObject({ pitch: 62 });
  });

  it("a key can be held while a note is tapped with another finger", () => {
    const p = centre(1);
    let state = initialState();
    const all: Intent[] = [];
    for (const input of [
      { kind: "down", id: 1, x: keyX(60), y: white },
      { kind: "down", id: 2, x: p.x, y: p.y },
      { kind: "up", id: 2, x: p.x, y: p.y },
      { kind: "up", id: 1, x: keyX(60), y: white },
    ] as const) {
      const next = step(state, { ...input, t: 0, pointer: "touch" }, env());
      state = next.state;
      all.push(...next.intents);
    }
    expect(types(all)).toEqual(["keyDown", "select", "audition", "keyUp"]);
  });
});

describe("a read-only project", () => {
  const ro = env({ readOnly: true, notes: [] });
  it("can be scrolled and played on, and nothing else", () => {
    const p = centre(1);
    expect(
      run(
        [
          ["down", p.x, p.y],
          ["up", p.x, p.y],
        ],
        ro,
      ),
    ).toEqual([]);
    expect(
      types(
        run(
          [
            ["down", p.x, p.y],
            ["move", p.x, p.y - 50],
            ["up", p.x, p.y - 50],
          ],
          ro,
        ),
      ),
    ).toEqual(["scroll", "scrollEnd"]);
    expect(
      run(
        [
          ["down", EMPTY.x, EMPTY.y],
          ["up", EMPTY.x, EMPTY.y],
        ],
        { ...ro, tool: "draw" },
      ),
    ).toEqual([]);
    expect(
      types(
        run(
          [
            ["down", p.x, p.y],
            ["move", p.x, p.y - 50],
            ["up", p.x, p.y - 50],
          ],
          { ...ro, tool: "erase" },
        ),
      ),
    ).toEqual(["scroll", "scrollEnd"]);
  });
});
