import { describe, expect, it } from "vitest";
import {
  MINIMUM_USABLE_COVERAGE,
  STEM_COVERAGE_TOLERANCE_S,
  OVERRUN_TOLERANCE_S,
  decideShortStems,
  judgeStemCoverage,
  overrunsTrack,
  stemDurationSeconds,
} from "@/orchestrator/stem-coverage";
import type { StemFit } from "@/orchestrator/stem-coverage";

const ALL_FITS: StemFit[] = ["fits", "short", "unusable", "unknown"];

const TRACK_S = 215.1;

describe("judgeStemCoverage", () => {
  it("accepts stems as long as the track", () => {
    expect(judgeStemCoverage(TRACK_S, TRACK_S)).toBe("fits");
  });

  it("accepts stems inside the tolerance", () => {
    expect(judgeStemCoverage(TRACK_S - STEM_COVERAGE_TOLERANCE_S, TRACK_S)).toBe("fits");
  });

  it("calls stems just outside the tolerance short rather than unusable", () => {
    expect(judgeStemCoverage(TRACK_S - STEM_COVERAGE_TOLERANCE_S - 0.1, TRACK_S)).toBe("short");
  });

  it("calls stems covering less than the usable fraction unusable", () => {
    expect(judgeStemCoverage(TRACK_S * MINIMUM_USABLE_COVERAGE - 0.1, TRACK_S)).toBe("unusable");
  });

  describe("regressions", () => {
    it("regression: 211.1s against a 219.0s track is short, which is retried once and then used", () => {
      expect(judgeStemCoverage(211.1, 219)).toBe("short");
    });

    it("regression: 55s of stems against a 215s track is unusable, never played", () => {
      expect(judgeStemCoverage(55, TRACK_S)).toBe("unusable");
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

    it("calls empty stems unusable rather than unknown", () => {
      expect(judgeStemCoverage(0, TRACK_S)).toBe("unusable");
      expect(judgeStemCoverage(Number.NaN, TRACK_S)).toBe("unusable");
    });

    it("accepts stems longer than the track", () => {
      expect(judgeStemCoverage(TRACK_S + 10, TRACK_S)).toBe("fits");
    });

    it("holds the short and unusable boundary exactly at the usable fraction", () => {
      expect(judgeStemCoverage(TRACK_S * MINIMUM_USABLE_COVERAGE, TRACK_S)).toBe("short");
    });
  });

  describe("invariants", () => {
    it("never accepts stems missing a whole minute", () => {
      for (const duration of [90, 215.1, 402, 611]) {
        expect(judgeStemCoverage(duration - 60, duration)).not.toBe("fits");
      }
    });

    it("never calls a tail of a few seconds unusable, at any track length", () => {
      for (const duration of [90, 215.1, 402, 611]) {
        expect(judgeStemCoverage(duration - 8, duration)).not.toBe("unusable");
      }
    });
  });
});

describe("decideShortStems", () => {
  it("engages straight away when the stems cover the track", () => {
    expect(decideShortStems("fits", false)).toBe("engage");
  });

  it("engages when the track length is unknown, since there is nothing to judge against", () => {
    expect(decideShortStems("unknown", false)).toBe("engage");
  });

  it("captures again the first time the stems come back short", () => {
    expect(decideShortStems("short", false)).toBe("reacquire");
    expect(decideShortStems("unusable", false)).toBe("reacquire");
  });

  it("uses slightly short stems rather than leaving the track without any", () => {
    expect(decideShortStems("short", true)).toBe("engage");
  });

  it("gives up honestly when a fresh capture still covers almost none of the track", () => {
    expect(decideShortStems("unusable", true)).toBe("fail");
  });

  describe("invariants", () => {
    it("regression: never asks for a second reacquisition, which is what looped forever", () => {
      for (const fit of ALL_FITS) {
        expect(decideShortStems(fit, true)).not.toBe("reacquire");
      }
    });

    it("always reaches engage or fail once a track has been reacquired", () => {
      for (const fit of ALL_FITS) {
        expect(["engage", "fail"]).toContain(decideShortStems(fit, true));
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

  it("reports empty stems as zero, which judges as unusable", () => {
    expect(stemDurationSeconds(0, 44100)).toBe(0);
    expect(judgeStemCoverage(stemDurationSeconds(0, 44100), TRACK_S)).toBe("unusable");
  });
});

describe("overrunsTrack", () => {
  it("accepts stems that match the track", () => {
    expect(overrunsTrack(187.7, 188)).toBe(false);
    expect(overrunsTrack(215, 215)).toBe(false);
  });

  it("flags stems that span more than the track", () => {
    expect(overrunsTrack(314.89, 109.79)).toBe(true);
    expect(overrunsTrack(315, 188)).toBe(true);
  });

  describe("edge cases", () => {
    it("tolerates a small overrun rather than crying wolf", () => {
      expect(overrunsTrack(188 + OVERRUN_TOLERANCE_S - 1, 188)).toBe(false);
    });

    it("needs both the absolute and the ratio test to trip", () => {
      expect(overrunsTrack(40, 25)).toBe(false);
      expect(overrunsTrack(400, 250)).toBe(true);
    });

    it("says nothing when the track duration is unknown", () => {
      expect(overrunsTrack(300, Number.NaN)).toBe(false);
      expect(overrunsTrack(300, 0)).toBe(false);
      expect(overrunsTrack(Number.NaN, 200)).toBe(false);
    });
  });
});
