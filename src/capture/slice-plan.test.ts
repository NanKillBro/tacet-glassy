import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKER_COUNT,
  MIN_SLICE_SECONDS,
  OPEN_ENDED_SECONDS,
  planSlices,
  planWholeTrack,
  workerCountFor,
} from "@/capture/slice-plan";

describe("planSlices", () => {
  it("splits a normal track across the default worker count", () => {
    const slices = planSlices(240, DEFAULT_WORKER_COUNT);
    expect(slices).toHaveLength(4);
    expect(slices[0]).toEqual({ index: 0, fromSeconds: 0, toSeconds: 60 });
    expect(slices[3]).toEqual({ index: 3, fromSeconds: 180, toSeconds: 240 });
  });

  it("covers the track with no gaps", () => {
    const slices = planSlices(201.4);
    for (let i = 1; i < slices.length; i++) {
      expect(slices[i].fromSeconds).toBe(slices[i - 1].toSeconds);
    }
    expect(slices[0].fromSeconds).toBe(0);
    expect(slices.at(-1)?.toSeconds).toBe(201.4);
  });

  describe("edge cases", () => {
    it("returns nothing for a zero or negative duration", () => {
      expect(planSlices(0)).toEqual([]);
      expect(planSlices(-5)).toEqual([]);
    });

    it("returns nothing for a non-finite duration", () => {
      expect(planSlices(Number.NaN)).toEqual([]);
      expect(planSlices(Number.POSITIVE_INFINITY)).toEqual([]);
    });

    it("uses a single worker for a track too short to slice", () => {
      const slices = planSlices(20, 4);
      expect(slices).toHaveLength(1);
      expect(slices[0]).toEqual({ index: 0, fromSeconds: 0, toSeconds: 20 });
    });

    it("scales the worker count down for a medium track", () => {
      expect(planSlices(MIN_SLICE_SECONDS * 2, 4)).toHaveLength(2);
    });

    it("clamps a nonsense worker count to at least one", () => {
      expect(planSlices(240, 0)).toHaveLength(1);
      expect(planSlices(240, -3)).toHaveLength(1);
    });
  });

  describe("invariants", () => {
    it("ends exactly on the duration, without floating point drift", () => {
      for (const duration of [201.4, 240.7, 187.333, 359.5]) {
        expect(planSlices(duration).at(-1)?.toSeconds).toBe(duration);
      }
    });

    it("never produces an empty or inverted slice", () => {
      for (const duration of [31, 60, 100.5, 240.7, 600]) {
        for (const slice of planSlices(duration)) {
          expect(slice.toSeconds).toBeGreaterThan(slice.fromSeconds);
        }
      }
    });

    it("indexes slices contiguously from zero", () => {
      expect(planSlices(240).map(s => s.index)).toEqual([0, 1, 2, 3]);
    });
  });
});

describe("workerCountFor", () => {
  it("never exceeds the requested maximum", () => {
    expect(workerCountFor(3600, 4)).toBe(4);
  });

  it("is zero only for an unusable duration", () => {
    expect(workerCountFor(0, 4)).toBe(0);
    expect(workerCountFor(240, 4)).toBeGreaterThan(0);
  });
});

describe("planWholeTrack", () => {
  it("is a single slice from zero", () => {
    const [slice, ...rest] = planWholeTrack();
    expect(rest).toHaveLength(0);
    expect(slice.index).toBe(0);
    expect(slice.fromSeconds).toBe(0);
  });

  it("ends far beyond any real track, so the worker's own duration wins", () => {
    expect(planWholeTrack()[0].toSeconds).toBe(OPEN_ENDED_SECONDS);
    expect(OPEN_ENDED_SECONDS).toBeGreaterThan(60 * 60);
  });

  it("needs no duration at all", () => {
    expect(() => planWholeTrack()).not.toThrow();
    expect(planWholeTrack()).toHaveLength(1);
  });
});
