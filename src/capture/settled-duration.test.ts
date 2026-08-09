import { describe, expect, it } from "vitest";
import { DURATION_AGREEMENT_S, settledTrackDuration } from "@/capture/settled-duration";

describe("settledTrackDuration", () => {
  it("accepts a length both the element and the player bar agree on", () => {
    expect(settledTrackDuration(215, 215)).toBe(215);
  });

  it("withholds a length the element has not caught up to", () => {
    expect(settledTrackDuration(15, 215)).toBeNull();
  });

  it("reports the element's own clock, which is what the buffered ranges are on", () => {
    expect(settledTrackDuration(215.4, 215)).toBe(215.4);
  });

  describe("regressions", () => {
    it("withholds the ad's length once the player bar names the real track", () => {
      expect(settledTrackDuration(15.02, 215)).toBeNull();
    });

    it("accepts a gapless append, where the element's clock covers two tracks", () => {
      expect(settledTrackDuration(515, 200)).toBe(515);
    });

    it("accepts a genuinely short interlude rather than treating it as a stale element", () => {
      expect(settledTrackDuration(24, 24)).toBe(24);
      expect(settledTrackDuration(24, 24.4)).toBe(24);
    });
  });

  describe("edge cases", () => {
    it("falls back to the element when the player bar cannot be read", () => {
      expect(settledTrackDuration(215, Number.NaN)).toBe(215);
      expect(settledTrackDuration(215, 0)).toBe(215);
      expect(settledTrackDuration(215, -3)).toBe(215);
    });

    it("has nothing to offer when the element has no duration", () => {
      expect(settledTrackDuration(Number.NaN, 215)).toBeNull();
      expect(settledTrackDuration(Number.POSITIVE_INFINITY, 215)).toBeNull();
      expect(settledTrackDuration(0, 215)).toBeNull();
      expect(settledTrackDuration(-1, 215)).toBeNull();
    });

    it("tolerates a rounding disagreement of up to a second", () => {
      expect(settledTrackDuration(215 - DURATION_AGREEMENT_S, 215)).toBe(214);
      expect(settledTrackDuration(215 - DURATION_AGREEMENT_S - 0.01, 215)).toBeNull();
    });
  });

  describe("invariants", () => {
    it("never invents a length of its own", () => {
      for (const element of [12, 215, 515.5]) {
        for (const clock of [Number.NaN, 0, 10, element, element + 100]) {
          const settled = settledTrackDuration(element, clock);
          expect(settled === null || settled === element).toBe(true);
        }
      }
    });

    it("is monotonic in the element's length for a fixed player bar reading", () => {
      let seenSettled = false;
      for (const element of [1, 10, 100, 214, 215, 400]) {
        const settled = settledTrackDuration(element, 215) !== null;
        if (settled) seenSettled = true;
        expect(settled || !seenSettled).toBe(true);
      }
    });
  });
});
