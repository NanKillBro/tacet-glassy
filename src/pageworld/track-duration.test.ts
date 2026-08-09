import { describe, expect, it } from "vitest";
import { chooseTrackDuration, parseClockDuration } from "@/pageworld/track-duration";

describe("parseClockDuration", () => {
  it("takes the total, not the elapsed", () => {
    expect(parseClockDuration("0:15 / 5:15")).toBe(315);
    expect(parseClockDuration("0:00 / 3:36")).toBe(216);
  });

  it("handles hours on either side", () => {
    expect(parseClockDuration("1:02:03 / 1:05:00")).toBe(3900);
    expect(parseClockDuration("59:59 / 1:00:00")).toBe(3600);
  });

  it("tolerates surrounding whitespace and spacing round the slash", () => {
    expect(parseClockDuration("  2:10/4:20  ")).toBe(260);
    expect(parseClockDuration("2:10   /   4:20")).toBe(260);
  });

  describe("edge cases", () => {
    it("rejects text that is not a clock", () => {
      expect(parseClockDuration("")).toBeNaN();
      expect(parseClockDuration("Play")).toBeNaN();
      expect(parseClockDuration("3:36")).toBeNaN();
    });

    it("rejects a zero total", () => {
      expect(parseClockDuration("0:00 / 0:00")).toBeNaN();
    });

    it("rejects an impossible seconds field rather than misreading it", () => {
      expect(parseClockDuration("0:00 / 3:76")).toBeNaN();
    });
  });
});

describe("chooseTrackDuration", () => {
  it("prefers the clock", () => {
    expect(chooseTrackDuration(315, 49.9)).toBe(315);
  });

  it("falls back to the player when the clock is unreadable", () => {
    expect(chooseTrackDuration(Number.NaN, 215.16)).toBe(215.16);
  });

  it("reports nothing when neither is usable", () => {
    expect(chooseTrackDuration(Number.NaN, 0)).toBe(0);
    expect(chooseTrackDuration(0, Number.NaN)).toBe(0);
  });

  describe("regressions", () => {
    it("regression: a buffered-length getDuration no longer wins over the real track", () => {
      expect(chooseTrackDuration(315, 49.9)).toBe(315);
      expect(chooseTrackDuration(222, 315)).toBe(222);
    });
  });
});
