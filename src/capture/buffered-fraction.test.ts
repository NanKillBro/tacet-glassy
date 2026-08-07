import { describe, expect, it } from "vitest";
import { computeBufferedFraction } from "@/capture/buffered-fraction";

describe("computeBufferedFraction", () => {
  it("returns the ratio of buffered end to duration", () => {
    expect(computeBufferedFraction(30, 120)).toBe(0.25);
  });

  describe("edge cases", () => {
    it("returns 0 when nothing has buffered yet", () => {
      expect(computeBufferedFraction(0, 120)).toBe(0);
    });

    it("returns 1 once fully buffered", () => {
      expect(computeBufferedFraction(120, 120)).toBe(1);
    });

    it("clamps to 1 when the buffered end overruns duration slightly", () => {
      expect(computeBufferedFraction(121, 120)).toBe(1);
    });

    it("clamps to 0 for a negative buffered end", () => {
      expect(computeBufferedFraction(-5, 120)).toBe(0);
    });

    it("returns NaN when duration is NaN", () => {
      expect(computeBufferedFraction(10, Number.NaN)).toBeNaN();
    });

    it("returns NaN when duration is zero", () => {
      expect(computeBufferedFraction(10, 0)).toBeNaN();
    });

    it("returns NaN when duration is negative", () => {
      expect(computeBufferedFraction(10, -5)).toBeNaN();
    });

    it("returns NaN when duration is infinite", () => {
      expect(computeBufferedFraction(10, Number.POSITIVE_INFINITY)).toBeNaN();
    });
  });

  describe("invariants", () => {
    it("the result is always within [0, 1] or NaN", () => {
      const cases: Array<[number, number]> = [
        [0, 10],
        [10, 10],
        [15, 10],
        [-3, 10],
      ];
      for (const [end, duration] of cases) {
        const result = computeBufferedFraction(end, duration);
        expect(Number.isNaN(result) || (result >= 0 && result <= 1)).toBe(true);
      }
    });
  });
});
