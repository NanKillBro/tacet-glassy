import { STRIDE_SAMPLES } from "@/separation/chunker";
import { computeResumeChunkIndex } from "@/separation/resume";
import { describe, expect, it } from "vitest";

describe("computeResumeChunkIndex", () => {
  it("returns chunk 0 and zero committed frames for framesDone = 0", () => {
    expect(computeResumeChunkIndex(0)).toEqual({ resumeChunkIndex: 0, committedFrames: 0 });
  });

  it("returns the exact chunk index when framesDone lands on a stride boundary", () => {
    expect(computeResumeChunkIndex(STRIDE_SAMPLES)).toEqual({ resumeChunkIndex: 1, committedFrames: STRIDE_SAMPLES });
    expect(computeResumeChunkIndex(STRIDE_SAMPLES * 4)).toEqual({
      resumeChunkIndex: 4,
      committedFrames: STRIDE_SAMPLES * 4,
    });
  });

  describe("edge cases", () => {
    it("floors down to the last fully committed stride boundary when framesDone is mid-region", () => {
      const framesDone = STRIDE_SAMPLES * 2 + 500;
      expect(computeResumeChunkIndex(framesDone)).toEqual({
        resumeChunkIndex: 2,
        committedFrames: STRIDE_SAMPLES * 2,
      });
    });

    it("floors just below a boundary to the previous chunk", () => {
      const framesDone = STRIDE_SAMPLES * 3 - 1;
      expect(computeResumeChunkIndex(framesDone)).toEqual({
        resumeChunkIndex: 2,
        committedFrames: STRIDE_SAMPLES * 2,
      });
    });

    it("never returns committedFrames greater than framesDone", () => {
      for (const framesDone of [1, STRIDE_SAMPLES - 1, STRIDE_SAMPLES + 1, STRIDE_SAMPLES * 10 + 7]) {
        const { committedFrames } = computeResumeChunkIndex(framesDone);
        expect(committedFrames).toBeLessThanOrEqual(framesDone);
      }
    });
  });

  describe("error paths", () => {
    it("throws for a negative framesDone", () => {
      expect(() => computeResumeChunkIndex(-1)).toThrow(/framesDone/);
    });

    it("throws for NaN", () => {
      expect(() => computeResumeChunkIndex(Number.NaN)).toThrow(/framesDone/);
    });

    it("throws for infinity", () => {
      expect(() => computeResumeChunkIndex(Number.POSITIVE_INFINITY)).toThrow(/framesDone/);
    });
  });
});
