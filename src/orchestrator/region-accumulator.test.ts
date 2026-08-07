import { describe, expect, it } from "vitest";
import { createRegionAccumulator } from "@/orchestrator/region-accumulator";

function ramp(length: number, start: number): Float32Array {
  return Float32Array.from({ length }, (_, i) => start + i);
}

describe("createRegionAccumulator", () => {
  it("writes a single region covering the whole buffer at offset zero", () => {
    const acc = createRegionAccumulator(4, 1);
    acc.addRegion(0, [ramp(4, 0)], [ramp(4, 100)]);

    expect(Array.from(acc.vocals[0])).toEqual([0, 1, 2, 3]);
    expect(Array.from(acc.instrumental[0])).toEqual([100, 101, 102, 103]);
  });

  it("writes sequential regions at their given offsets", () => {
    const acc = createRegionAccumulator(6, 1);
    acc.addRegion(0, [ramp(3, 0)], [ramp(3, 0)]);
    acc.addRegion(3, [ramp(3, 10)], [ramp(3, 20)]);

    expect(Array.from(acc.vocals[0])).toEqual([0, 1, 2, 10, 11, 12]);
    expect(Array.from(acc.instrumental[0])).toEqual([0, 1, 2, 20, 21, 22]);
  });

  it("handles multi-channel regions independently per channel", () => {
    const acc = createRegionAccumulator(2, 2);
    acc.addRegion(0, [ramp(2, 0), ramp(2, 50)], [ramp(2, 100), ramp(2, 150)]);

    expect(Array.from(acc.vocals[0])).toEqual([0, 1]);
    expect(Array.from(acc.vocals[1])).toEqual([50, 51]);
    expect(Array.from(acc.instrumental[0])).toEqual([100, 101]);
    expect(Array.from(acc.instrumental[1])).toEqual([150, 151]);
  });

  describe("edge cases", () => {
    it("a zero-length track produces empty buffers", () => {
      const acc = createRegionAccumulator(0, 1);
      expect(acc.vocals[0].length).toBe(0);
      expect(acc.instrumental[0].length).toBe(0);
    });

    it("regions arriving out of order still land at their given offsets", () => {
      const acc = createRegionAccumulator(6, 1);
      acc.addRegion(3, [ramp(3, 10)], [ramp(3, 20)]);
      acc.addRegion(0, [ramp(3, 0)], [ramp(3, 0)]);

      expect(Array.from(acc.vocals[0])).toEqual([0, 1, 2, 10, 11, 12]);
    });

    it("a region narrower than the trailing space leaves the remainder as zero", () => {
      const acc = createRegionAccumulator(5, 1);
      acc.addRegion(0, [ramp(2, 7)], [ramp(2, 9)]);

      expect(Array.from(acc.vocals[0])).toEqual([7, 8, 0, 0, 0]);
    });
  });

  describe("invariants", () => {
    it("the exposed buffers always have length equal to totalFrames", () => {
      const acc = createRegionAccumulator(10, 2);
      expect(acc.vocals[0].length).toBe(10);
      expect(acc.vocals[1].length).toBe(10);
      expect(acc.instrumental[0].length).toBe(10);
      expect(acc.instrumental[1].length).toBe(10);
    });
  });

  describe("error paths", () => {
    it("throws when a region's channel count does not match", () => {
      const acc = createRegionAccumulator(4, 2);
      expect(() => acc.addRegion(0, [ramp(4, 0)], [ramp(4, 0), ramp(4, 0)])).toThrow(/channel/i);
    });
  });
});
