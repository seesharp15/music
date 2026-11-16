import { describe, expect, it, vi } from "vitest";
import { readMidi } from "./midi-in";

const handlers = () => ({ noteOn: vi.fn(), noteOff: vi.fn(), pedal: vi.fn() });

describe("reading a MIDI keyboard", () => {
  it("note on carries the pitch and how hard the key was struck", () => {
    const h = handlers();
    readMidi([0x90, 60, 127], h);
    readMidi([0x93, 72, 64], h); // any channel
    expect(h.noteOn.mock.calls).toEqual([
      [60, 1],
      [72, 64 / 127],
    ]);
  });

  it("note off, and a note on with no velocity, both let the key go", () => {
    const h = handlers();
    readMidi([0x80, 60, 40], h);
    readMidi([0x90, 62, 0], h);
    expect(h.noteOff.mock.calls).toEqual([[60], [62]]);
    expect(h.noteOn).not.toHaveBeenCalled();
  });

  it("controller 64 is the sustain pedal: down from half way", () => {
    const h = handlers();
    readMidi([0xb0, 64, 127], h);
    readMidi([0xb0, 64, 63], h);
    readMidi([0xb0, 1, 127], h); // the modulation wheel is not a pedal
    expect(h.pedal.mock.calls).toEqual([[true], [false]]);
  });

  it("ignores what it does not understand", () => {
    const h = handlers();
    readMidi(null, h);
    readMidi([0xf8], h);
    readMidi([0xe0, 0, 64], h);
    expect(h.noteOn).not.toHaveBeenCalled();
    expect(h.noteOff).not.toHaveBeenCalled();
    expect(h.pedal).not.toHaveBeenCalled();
  });
});
