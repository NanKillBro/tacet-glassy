import { describe, expect, it } from "vitest";
import { bufferedRangeEnd, bufferedRangeStart, decideHop, MAX_STALLS } from "@/capture/edge-hopper";

const base = { bufferedEnd: 0, cursor: 0, sliceEnd: 60, trackDuration: 240, stalls: 0 };

function fakeRanges(ranges: Array<[number, number]>): TimeRanges {
  return {
    length: ranges.length,
    start: (i: number) => ranges[i][0],
    end: (i: number) => ranges[i][1],
  } as TimeRanges;
}

describe("decideHop", () => {
  it("seeks to the buffered edge when the window has extended", () => {
    expect(decideHop({ ...base, bufferedEnd: 12, cursor: 0 })).toEqual({ action: "seek", to: 12, cursor: 12 });
  });

  it("reports done once the edge covers the slice", () => {
    expect(decideHop({ ...base, bufferedEnd: 60, cursor: 55 })).toEqual({ action: "done" });
  });

  it("waits while the edge has not moved enough to be worth a seek", () => {
    expect(decideHop({ ...base, bufferedEnd: 10.1, cursor: 10 })).toEqual({ action: "wait" });
  });

  it("nudges after repeated stalls to re-trigger the fetch", () => {
    expect(decideHop({ ...base, bufferedEnd: 10, cursor: 10, stalls: 4 })).toEqual({
      action: "nudge",
      to: 10.1,
    });
  });

  it("gives up once stalls exhaust the budget", () => {
    expect(decideHop({ ...base, bufferedEnd: 10, cursor: 10, stalls: MAX_STALLS })).toEqual({ action: "give-up" });
  });

  describe("edge cases", () => {
    it("accepts an edge that lands just short of the slice end", () => {
      expect(decideHop({ ...base, bufferedEnd: 59.5, cursor: 55 })).toEqual({ action: "done" });
    });

    it("never seeks to the very end of the track, which would trigger autoplay", () => {
      const decision = decideHop({ ...base, bufferedEnd: 239.9, cursor: 100, sliceEnd: 400, trackDuration: 240 });
      expect(decision).toEqual({ action: "seek", to: 239.9, cursor: 239.9 });
      if (decision.action === "seek") expect(decision.to).toBeLessThan(240);
    });

    it("clamps a nudge to the end guard", () => {
      const decision = decideHop({
        ...base,
        bufferedEnd: 239.95,
        cursor: 239.95,
        sliceEnd: 400,
        trackDuration: 240,
        stalls: 4,
      });
      expect(decision).toEqual({ action: "nudge", to: 239.9 });
    });

    it("prefers done over give-up when both could apply", () => {
      expect(decideHop({ ...base, bufferedEnd: 60, cursor: 10, stalls: MAX_STALLS })).toEqual({ action: "done" });
    });
  });

  describe("regressions", () => {
    it("regression: does not nudge on the very first poll", () => {
      expect(decideHop({ ...base, stalls: 0 })).toEqual({ action: "wait" });
    });
  });
});

describe("bufferedRangeStart", () => {
  it("reports where the containing range actually begins", () => {
    expect(bufferedRangeStart(fakeRanges([[57.5, 130]]), 60)).toBe(57.5);
  });

  it("falls back to the requested point when nothing is buffered", () => {
    expect(bufferedRangeStart(fakeRanges([]), 60)).toBe(60);
  });

  it("ignores ranges that do not contain the point", () => {
    expect(
      bufferedRangeStart(
        fakeRanges([
          [0, 10],
          [120, 180],
        ]),
        60
      )
    ).toBe(60);
  });
});

describe("bufferedRangeEnd", () => {
  it("reports the contiguous edge from the cursor", () => {
    expect(bufferedRangeEnd(fakeRanges([[0, 42]]), 10)).toBe(42);
  });

  it("picks the range containing the cursor, not the last one", () => {
    expect(
      bufferedRangeEnd(
        fakeRanges([
          [0, 42],
          [100, 150],
        ]),
        10
      )
    ).toBe(42);
  });
});
