import { deriveRegionStems } from "@/separation/region-stems";
import { describe, expect, it } from "vitest";

// -- Test helpers -----------------------------------------------------------------

function track(values: number[]): Float32Array {
  return new Float32Array(values);
}

const IDENTITY = { mean: 0, std: 1 };

// -- Tests -----------------------------------------------------------------

describe("deriveRegionStems", () => {
  describe("happy path", () => {
    it("returns vocals unchanged and instrumental as original minus vocals under identity normalization", () => {
      const original = [track([10, 20, 30, 40, 50]), track([50, 40, 30, 20, 10])];
      const vocalsRegion = [track([1, 2, 3]), track([5, 4, 3])];

      const { vocals, instrumental } = deriveRegionStems(original, 1, vocalsRegion, IDENTITY);

      expect(Array.from(vocals[0])).toEqual([1, 2, 3]);
      expect(Array.from(vocals[1])).toEqual([5, 4, 3]);
      expect(Array.from(instrumental[0])).toEqual([19, 28, 37]);
      expect(Array.from(instrumental[1])).toEqual([35, 26, 17]);
    });

    it("denormalizes vocals using mean and std before deriving the instrumental", () => {
      const original = [track([10, 10, 10])];
      const vocalsRegion = [track([1, 2, 3])];
      const normalization = { mean: 5, std: 2 };

      const { vocals, instrumental } = deriveRegionStems(original, 0, vocalsRegion, normalization);

      expect(Array.from(vocals[0])).toEqual([1 * 2 + 5, 2 * 2 + 5, 3 * 2 + 5]);
      expect(Array.from(instrumental[0])).toEqual([10 - 7, 10 - 9, 10 - 11]);
    });

    it("slices the original track at an offset in the middle", () => {
      const original = [track([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])];
      const vocalsRegion = [track([0, 0, 0])];

      const { instrumental } = deriveRegionStems(original, 4, vocalsRegion, IDENTITY);
      expect(Array.from(instrumental[0])).toEqual([4, 5, 6]);
    });

    it("handles mono input", () => {
      const original = [track([1, 2, 3])];
      const vocalsRegion = [track([1, 1, 1])];
      const { vocals, instrumental } = deriveRegionStems(original, 0, vocalsRegion, IDENTITY);
      expect(vocals.length).toBe(1);
      expect(Array.from(instrumental[0])).toEqual([0, 1, 2]);
    });
  });

  describe("edge cases", () => {
    it("handles a region at the very start", () => {
      const original = [track([9, 8, 7])];
      const vocalsRegion = [track([1, 1])];
      const { instrumental } = deriveRegionStems(original, 0, vocalsRegion, IDENTITY);
      expect(Array.from(instrumental[0])).toEqual([8, 7]);
    });

    it("handles a region that exactly reaches the end of the track", () => {
      const original = [track([9, 8, 7])];
      const vocalsRegion = [track([1, 1])];
      const { instrumental } = deriveRegionStems(original, 1, vocalsRegion, IDENTITY);
      expect(Array.from(instrumental[0])).toEqual([7, 6]);
    });

    it("handles a zero-length region", () => {
      const original = [track([1, 2, 3])];
      const vocalsRegion = [track([])];
      const { vocals, instrumental } = deriveRegionStems(original, 1, vocalsRegion, IDENTITY);
      expect(vocals[0].length).toBe(0);
      expect(instrumental[0].length).toBe(0);
    });
  });

  describe("error paths", () => {
    it("throws when the vocals region has a different channel count than the original", () => {
      const original = [track([1, 2, 3]), track([1, 2, 3])];
      const vocalsRegion = [track([1, 2, 3])];
      expect(() => deriveRegionStems(original, 0, vocalsRegion, IDENTITY)).toThrow(/channel/i);
    });

    it("throws when the vocals region's channels disagree in length", () => {
      const original = [track([1, 2, 3]), track([1, 2, 3])];
      const vocalsRegion = [track([1, 2]), track([1, 2, 3])];
      expect(() => deriveRegionStems(original, 0, vocalsRegion, IDENTITY)).toThrow(/length/i);
    });

    it("throws when the region start is negative", () => {
      const original = [track([1, 2, 3])];
      const vocalsRegion = [track([1])];
      expect(() => deriveRegionStems(original, -1, vocalsRegion, IDENTITY)).toThrow(/bounds/i);
    });

    it("throws when the region extends past the end of the original track", () => {
      const original = [track([1, 2, 3])];
      const vocalsRegion = [track([1, 2])];
      expect(() => deriveRegionStems(original, 2, vocalsRegion, IDENTITY)).toThrow(/bounds/i);
    });
  });
});
