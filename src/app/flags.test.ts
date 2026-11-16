import { afterEach, describe, expect, it } from "vitest";
import { flag, setStoredFlag, storedFlag } from "./flags";

afterEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("flags", () => {
  it("are off unless asked for", () => {
    expect(flag("studio")).toBe(false);
  });

  it("turn on from the query string", () => {
    window.history.replaceState(null, "", "/?flags=studio,%20assist#/play/x");
    expect(flag("studio")).toBe(true);
    expect(flag("assist")).toBe(true);
    expect(flag("hum")).toBe(false);
  });

  it("turn on from storage", () => {
    localStorage.setItem("piano-tutor:flags", "hum, import");
    expect(flag("hum")).toBe(true);
    expect(flag("import")).toBe(true);
    expect(flag("studio")).toBe(false);
  });

  it("can be kept on this device and taken off again, leaving the others alone", () => {
    localStorage.setItem("piano-tutor:flags", "hum");
    expect(storedFlag("studio")).toBe(false);
    expect(setStoredFlag("studio", true)).toBe(true);
    expect(localStorage.getItem("piano-tutor:flags")).toBe("hum,studio");
    expect(storedFlag("studio")).toBe(true);
    expect(flag("studio")).toBe(true);
    // Keeping it twice does not list it twice.
    setStoredFlag("studio", true);
    expect(localStorage.getItem("piano-tutor:flags")).toBe("hum,studio");
    setStoredFlag("studio", false);
    expect(localStorage.getItem("piano-tutor:flags")).toBe("hum");
    setStoredFlag("hum", false);
    expect(localStorage.getItem("piano-tutor:flags")).toBeNull();
  });

  it("a flag in the address is not one kept on the device", () => {
    window.history.replaceState(null, "", "/?flags=studio");
    expect(flag("studio")).toBe(true);
    expect(storedFlag("studio")).toBe(false);
  });
});
