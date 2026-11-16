import { describe, expect, it } from "vitest";
import { ago } from "./MySongs";

describe("when a song was last changed", () => {
  const now = new Date(2026, 10, 16, 9, 0);
  it("counts in calendar days, not hours", () => {
    expect(ago(new Date(2026, 10, 16, 0, 5).toISOString(), now)).toBe("today");
    expect(ago(new Date(2026, 10, 15, 23, 55).toISOString(), now)).toBe("yesterday");
    expect(ago(new Date(2026, 10, 13, 12, 0).toISOString(), now)).toBe("3 days ago");
  });
  it("gives the date once it is a fortnight old, and nothing for a date it cannot read", () => {
    expect(ago(new Date(2026, 9, 1).toISOString(), now)).toMatch(/2026/);
    expect(ago("not a date", now)).toBe("");
  });
});
