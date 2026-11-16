import { beforeEach, describe, expect, it } from "vitest";
import { inputLatencyMs, setInputLatencyMs } from "./latency";

const KEY = "piano-tutor:latency";

describe("inputLatencyMs", () => {
  beforeEach(() => localStorage.clear());

  it("is 0 until this device has been calibrated", () => {
    expect(inputLatencyMs()).toBe(0);
  });
  it("reads what the calibration screen wrote", () => {
    setInputLatencyMs(42.5);
    expect(inputLatencyMs()).toBe(42.5);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ ms: 42.5 });
  });
  it("reads a bare number too", () => {
    localStorage.setItem(KEY, "30");
    expect(inputLatencyMs()).toBe(30);
  });
  it("treats anything unbelievable as not calibrated", () => {
    for (const bad of ["nonsense", '"fast"', "-5", "5000", "null", "{}", '{"ms":"12"}', "NaN"]) {
      localStorage.setItem(KEY, bad);
      expect(inputLatencyMs(), bad).toBe(0);
    }
  });
  it("keeps what it stores within reason", () => {
    setInputLatencyMs(9999);
    expect(inputLatencyMs()).toBe(500);
    setInputLatencyMs(-3);
    expect(inputLatencyMs()).toBe(0);
  });
});
