import { describe, expect, it } from "vitest";
import {
  COVERAGE_TOLERANCE_S,
  MAX_AHEAD_ATTEMPTS,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  decideRetry,
  judgeCapture,
  missingSeconds,
  retryDelayMs,
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
  describe("a track the listener is on", () => {
    it("never gives up, however many attempts have failed", () => {
      for (const attempts of [1, 3, 10, 500]) {
        expect(decideRetry(attempts, false)).toBe("retry");
      }
    });
  });

  describe("a track being warmed ahead", () => {
    it("retries a first failure", () => {
      expect(decideRetry(1, true)).toBe("retry");
    });

    it("gives up once the attempts are spent", () => {
      expect(decideRetry(MAX_AHEAD_ATTEMPTS, true)).toBe("give-up");
      expect(decideRetry(MAX_AHEAD_ATTEMPTS + 1, true)).toBe("give-up");
    });

    it("bounds the retries", () => {
      let attempts = 0;
      while (decideRetry(attempts, true) === "retry") {
        attempts++;
        expect(attempts).toBeLessThanOrEqual(MAX_AHEAD_ATTEMPTS);
      }
      expect(attempts).toBe(MAX_AHEAD_ATTEMPTS);
    });
  });
});

describe("retryDelayMs", () => {
  it("backs off exponentially from the base delay", () => {
    expect(retryDelayMs(1)).toBe(RETRY_BASE_DELAY_MS);
    expect(retryDelayMs(2)).toBe(RETRY_BASE_DELAY_MS * 2);
    expect(retryDelayMs(3)).toBe(RETRY_BASE_DELAY_MS * 4);
  });

  it("caps, so an uncapturable track does not spin and does not stall forever", () => {
    expect(retryDelayMs(100)).toBe(RETRY_MAX_DELAY_MS);
  });

  describe("invariants", () => {
    it("never decreases and never exceeds the cap", () => {
      let previous = 0;
      for (let attempts = 1; attempts <= 40; attempts++) {
        const delay = retryDelayMs(attempts);
        expect(delay).toBeGreaterThanOrEqual(previous);
        expect(delay).toBeLessThanOrEqual(RETRY_MAX_DELAY_MS);
        previous = delay;
      }
    });

    it("is always a usable positive delay", () => {
      for (const attempts of [0, 1, 2, 9]) {
        expect(retryDelayMs(attempts)).toBeGreaterThan(0);
      }
    });
  });
});
