import { MAX_MIX_LEVEL, MIN_MIX_LEVEL, clampMixLevel, gainsForMixLevel } from "@/pageworld/gain-law";
import { describe, expect, it } from "vitest";

describe("gainsForMixLevel", () => {
  it.each([
    [0, 0],
    [0.5, 0.5],
    [1, 1],
    [1.5, 1.5],
    [2, 2],
  ])("k=%s produces vocalsGain=%s and instrumentalGain=1", (k, expectedVocalsGain) => {
    const gains = gainsForMixLevel(k);
    expect(gains.vocalsGain).toBe(expectedVocalsGain);
    expect(gains.instrumentalGain).toBe(1);
  });

  it("instrumental gain never moves regardless of k", () => {
    for (const k of [0, 0.25, 1, 1.75, 2]) {
      expect(gainsForMixLevel(k).instrumentalGain).toBe(1);
    }
  });

  describe("edge cases", () => {
    it("clamps a negative mixLevel to the minimum", () => {
      expect(gainsForMixLevel(-1).vocalsGain).toBe(MIN_MIX_LEVEL);
    });

    it("clamps a mixLevel above the maximum", () => {
      expect(gainsForMixLevel(3).vocalsGain).toBe(MAX_MIX_LEVEL);
    });

    it("clamps a large negative value to the minimum", () => {
      expect(gainsForMixLevel(-100).vocalsGain).toBe(MIN_MIX_LEVEL);
    });

    it("clamps Infinity to the maximum", () => {
      expect(gainsForMixLevel(Number.POSITIVE_INFINITY).vocalsGain).toBe(MAX_MIX_LEVEL);
    });

    it("clamps -Infinity to the minimum", () => {
      expect(gainsForMixLevel(Number.NEGATIVE_INFINITY).vocalsGain).toBe(MIN_MIX_LEVEL);
    });

    it("passes through the exact boundary values unchanged", () => {
      expect(clampMixLevel(MIN_MIX_LEVEL)).toBe(MIN_MIX_LEVEL);
      expect(clampMixLevel(MAX_MIX_LEVEL)).toBe(MAX_MIX_LEVEL);
    });
  });

  describe("regressions", () => {
    it("rejects NaN instead of silently producing a non-finite gain", () => {
      expect(() => gainsForMixLevel(Number.NaN)).toThrow();
    });
  });

  describe("invariants", () => {
    it("is a pure function: identical input produces identical output", () => {
      expect(gainsForMixLevel(0.7)).toEqual(gainsForMixLevel(0.7));
    });

    it("never returns a gain outside [0, 2]", () => {
      for (const k of [-50, -1, 0, 0.3, 1, 1.9, 2, 50]) {
        const gains = gainsForMixLevel(k);
        expect(gains.vocalsGain).toBeGreaterThanOrEqual(MIN_MIX_LEVEL);
        expect(gains.vocalsGain).toBeLessThanOrEqual(MAX_MIX_LEVEL);
      }
    });
  });
});
