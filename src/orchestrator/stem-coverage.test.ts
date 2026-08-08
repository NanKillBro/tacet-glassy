import { describe, expect, it } from "vitest";
import { STEM_COVERAGE_TOLERANCE_S, judgeStemCoverage, stemDurationSeconds } from "@/orchestrator/stem-coverage";

const TRACK_S = 215.1;

describe("judgeStemCoverage", () => {
  it("accepts stems as long as the track", () => {
    expect(judgeStemCoverage(TRACK_S, TRACK_S)).toBe("fits");
  });

  it("accepts stems inside the tolerance", () => {
    expect(judgeStemCoverage(TRACK_S - STEM_COVERAGE_TOLERANCE_S, TRACK_S)).toBe("fits");
  });

  it("refuses stems outside it", () => {
    expect(judgeStemCoverage(TRACK_S - STEM_COVERAGE_TOLERANCE_S - 0.1, TRACK_S)).toBe("short");
  });

  describe("regressions", () => {
    it("regression: refuses 55s of stems against a 215s track", () => {
      expect(judgeStemCoverage(55, TRACK_S)).toBe("short");
    });

    it("regression: accepts the drift a good separation actually lands on", () => {
      expect(judgeStemCoverage(TRACK_S - 0.09, TRACK_S)).toBe("fits");
    });
  });

  describe("edge cases", () => {
    it("refuses to judge a track whose duration is not known", () => {
      for (const duration of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
        expect(judgeStemCoverage(TRACK_S, duration)).toBe("unknown");
      }
    });

    it("calls empty stems short rather than unknown", () => {
      expect(judgeStemCoverage(0, TRACK_S)).toBe("short");
      expect(judgeStemCoverage(Number.NaN, TRACK_S)).toBe("short");
    });

    it("accepts stems longer than the track", () => {
      expect(judgeStemCoverage(TRACK_S + 10, TRACK_S)).toBe("fits");
    });
  });

  describe("invariants", () => {
    it("never accepts stems missing a whole minute", () => {
      for (const duration of [90, 215.1, 402, 611]) {
        expect(judgeStemCoverage(duration - 60, duration)).toBe("short");
      }
    });
  });
});

describe("stemDurationSeconds", () => {
  it("converts frames at a sample rate", () => {
    expect(stemDurationSeconds(44100 * 215, 44100)).toBeCloseTo(215, 5);
  });

  it("refuses a sample rate that cannot divide", () => {
    expect(stemDurationSeconds(44100, 0)).toBeNaN();
    expect(stemDurationSeconds(44100, Number.NaN)).toBeNaN();
  });

  it("reports empty stems as zero, which judges as short", () => {
    expect(stemDurationSeconds(0, 44100)).toBe(0);
    expect(judgeStemCoverage(stemDurationSeconds(0, 44100), TRACK_S)).toBe("short");
  });
});
