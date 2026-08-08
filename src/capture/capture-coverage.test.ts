import { describe, expect, it } from "vitest";
import {
  COVERAGE_TOLERANCE_S,
  MAX_CAPTURE_ATTEMPTS,
  decideRetry,
  judgeCapture,
  missingSeconds,
} from "@/capture/capture-coverage";
import type { CaptureCoverage } from "@/capture/capture-coverage";

const TRACK_S = 215.1;

function coverage(overrides: Partial<CaptureCoverage> = {}): CaptureCoverage {
  return { reachedSeconds: TRACK_S, trackDurationSeconds: TRACK_S, byteLength: 5_614_250, ...overrides };
}

describe("judgeCapture", () => {
  it("accepts a capture that reached the end", () => {
    expect(judgeCapture(coverage())).toBe("complete");
  });

  it("accepts one that stopped inside the tolerance", () => {
    expect(judgeCapture(coverage({ reachedSeconds: TRACK_S - COVERAGE_TOLERANCE_S }))).toBe("complete");
  });

  it("refuses one that stopped outside it", () => {
    expect(judgeCapture(coverage({ reachedSeconds: TRACK_S - COVERAGE_TOLERANCE_S - 0.1 }))).toBe("short");
  });

  describe("regressions", () => {
    it("regression: refuses the 55s capture of a 215s track", () => {
      expect(judgeCapture(coverage({ reachedSeconds: 55, byteLength: 1_437_540 }))).toBe("short");
      expect(missingSeconds(coverage({ reachedSeconds: 55 }))).toBeCloseTo(160.1, 1);
    });
  });

  describe("edge cases", () => {
    it("calls an empty capture unusable rather than short", () => {
      expect(judgeCapture(coverage({ byteLength: 0 }))).toBe("unusable");
    });

    it("refuses to judge a track whose duration never resolved", () => {
      expect(judgeCapture(coverage({ trackDurationSeconds: Number.NaN }))).toBe("unusable");
      expect(judgeCapture(coverage({ trackDurationSeconds: 0 }))).toBe("unusable");
      expect(judgeCapture(coverage({ trackDurationSeconds: Number.POSITIVE_INFINITY }))).toBe("unusable");
    });

    it("treats an unreadable reach as short, not complete", () => {
      expect(judgeCapture(coverage({ reachedSeconds: Number.NaN }))).toBe("short");
    });

    it("accepts a capture that overshot the duration", () => {
      expect(judgeCapture(coverage({ reachedSeconds: TRACK_S + 4 }))).toBe("complete");
      expect(missingSeconds(coverage({ reachedSeconds: TRACK_S + 4 }))).toBe(0);
    });
  });

  describe("invariants", () => {
    it("never calls a capture complete when a whole minute is missing", () => {
      for (const duration of [90, 215.1, 402, 611]) {
        expect(judgeCapture(coverage({ reachedSeconds: duration - 60, trackDurationSeconds: duration }))).toBe("short");
      }
    });
  });
});

describe("decideRetry", () => {
  it("retries a first failure", () => {
    expect(decideRetry(1)).toBe("retry");
  });

  it("gives up once the attempts are spent", () => {
    expect(decideRetry(MAX_CAPTURE_ATTEMPTS)).toBe("give-up");
    expect(decideRetry(MAX_CAPTURE_ATTEMPTS + 1)).toBe("give-up");
  });

  it("bounds the retries", () => {
    let attempts = 0;
    while (decideRetry(attempts) === "retry") {
      attempts++;
      expect(attempts).toBeLessThanOrEqual(MAX_CAPTURE_ATTEMPTS);
    }
    expect(attempts).toBe(MAX_CAPTURE_ATTEMPTS);
  });
});
