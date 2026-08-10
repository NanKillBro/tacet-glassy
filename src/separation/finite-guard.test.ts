import { describeNonFinite, inspectFinite } from "@/separation/finite-guard";
import { describe, expect, it } from "vitest";

describe("inspectFinite", () => {
  it("passes audio that is entirely finite", () => {
    const report = inspectFinite([Float32Array.from([0, 0.5, -0.5, 1]), Float32Array.from([-1, 0.25, 0, 0.75])]);
    expect(report.finite).toBe(true);
    expect(report.nonFiniteCount).toBe(0);
    expect(report.firstIndex).toBe(-1);
    expect(report.total).toBe(8);
  });

  it("catches NaN, which is what a half precision overflow leaves behind", () => {
    const report = inspectFinite([Float32Array.from([0, Number.NaN, 0.5])]);
    expect(report.finite).toBe(false);
    expect(report.nonFiniteCount).toBe(1);
    expect(report.firstIndex).toBe(1);
  });

  it("catches both infinities", () => {
    const report = inspectFinite([Float32Array.from([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])]);
    expect(report.finite).toBe(false);
    expect(report.nonFiniteCount).toBe(2);
  });

  it("counts across every channel", () => {
    const report = inspectFinite([Float32Array.from([0, Number.NaN]), Float32Array.from([Number.NaN, Number.NaN])]);
    expect(report.nonFiniteCount).toBe(3);
    expect(report.total).toBe(4);
  });

  describe("edge cases", () => {
    it("treats no channels as finite", () => {
      expect(inspectFinite([])).toEqual({ finite: true, nonFiniteCount: 0, firstIndex: -1, total: 0 });
    });

    it("treats empty channels as finite", () => {
      const report = inspectFinite([new Float32Array(0), new Float32Array(0)]);
      expect(report.finite).toBe(true);
      expect(report.total).toBe(0);
    });

    it("accepts negative zero and the float32 extremes", () => {
      const report = inspectFinite([Float32Array.from([-0, 3.4028234663852886e38, -3.4028234663852886e38])]);
      expect(report.finite).toBe(true);
    });

    it("reports the first bad index within a channel even when a later channel is worse", () => {
      const report = inspectFinite([Float32Array.from([0, 0, Number.NaN]), Float32Array.from([Number.NaN])]);
      expect(report.firstIndex).toBe(2);
    });
  });

  describe("invariants", () => {
    it("never reports more non-finite samples than it inspected", () => {
      const report = inspectFinite([Float32Array.from([Number.NaN, Number.NaN])]);
      expect(report.nonFiniteCount).toBeLessThanOrEqual(report.total);
    });

    it("agrees with itself: finite is exactly a zero count", () => {
      for (const channels of [
        [Float32Array.from([1, 2])],
        [Float32Array.from([1, Number.NaN])],
        [new Float32Array(0)],
      ]) {
        const report = inspectFinite(channels);
        expect(report.finite).toBe(report.nonFiniteCount === 0);
      }
    });

    it("does not modify the audio it inspects", () => {
      const channel = Float32Array.from([0, Number.NaN, 0.5]);
      inspectFinite([channel]);
      expect(channel[0]).toBe(0);
      expect(Number.isNaN(channel[1])).toBe(true);
      expect(channel[2]).toBe(0.5);
    });
  });
});

describe("describeNonFinite", () => {
  it("names the chunk, the count and the share", () => {
    const message = describeNonFinite({ finite: false, nonFiniteCount: 5, firstIndex: 3, total: 10 }, 7);
    expect(message).toContain("chunk 7");
    expect(message).toContain("5 non-finite samples");
    expect(message).toContain("50.0%");
    expect(message).toContain("index 3");
  });

  describe("edge cases", () => {
    it("does not divide by zero on an empty report", () => {
      const message = describeNonFinite({ finite: true, nonFiniteCount: 0, firstIndex: -1, total: 0 }, 0);
      expect(message).toContain("0.0%");
    });
  });
});
