import { describe, expect, it } from "vitest";
import { decideCacheLookup, isRecordComplete } from "@/orchestrator/cache-lookup";

function record(framesDone: number, totalFrames: number) {
  return { framesDone, totalFrames };
}

describe("isRecordComplete", () => {
  it("is complete when framesDone equals totalFrames", () => {
    expect(isRecordComplete(record(1000, 1000))).toBe(true);
  });

  it("is incomplete when framesDone is less than totalFrames", () => {
    expect(isRecordComplete(record(500, 1000))).toBe(false);
  });

  describe("edge cases", () => {
    it("a zero-frame record is complete", () => {
      expect(isRecordComplete(record(0, 0))).toBe(true);
    });
  });
});

describe("decideCacheLookup", () => {
  it("returns alias-hit when the videoId alias resolves to a complete record", () => {
    expect(decideCacheLookup(record(1000, 1000), null)).toBe("alias-hit");
  });

  it("returns content-hit when there is no alias but the content key resolves to a complete record", () => {
    expect(decideCacheLookup(null, record(1000, 1000))).toBe("content-hit");
  });

  it("returns miss when neither record exists", () => {
    expect(decideCacheLookup(null, null)).toBe("miss");
  });

  it("prefers alias-hit over content-hit when both are complete", () => {
    expect(decideCacheLookup(record(1000, 1000), record(1000, 1000))).toBe("alias-hit");
  });

  it("falls through to content-hit when the alias record is present but incomplete", () => {
    expect(decideCacheLookup(record(200, 1000), record(1000, 1000))).toBe("content-hit");
  });

  it("returns miss when the alias record is present but incomplete and there is no content record", () => {
    expect(decideCacheLookup(record(200, 1000), null)).toBe("miss");
  });

  it("returns miss when both records are present but incomplete", () => {
    expect(decideCacheLookup(record(200, 1000), record(300, 1000))).toBe("miss");
  });

  describe("edge cases", () => {
    it("treats a zero-frame alias record as a hit", () => {
      expect(decideCacheLookup(record(0, 0), null)).toBe("alias-hit");
    });
  });
});
