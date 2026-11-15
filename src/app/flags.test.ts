import { afterEach, describe, expect, it } from "vitest";
import { flag } from "./flags";

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
});
