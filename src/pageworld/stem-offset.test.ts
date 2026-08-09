import { describe, expect, it } from "vitest";
import { OFFSET_TOLERANCE_S, resolveStemStart } from "@/pageworld/stem-offset";

const STEMS = 200;

function resolve(playerTimeSeconds: number, elementTimeSeconds: number, stemDurationSeconds = STEMS) {
  return resolveStemStart({ playerTimeSeconds, elementTimeSeconds, stemDurationSeconds });
}

describe("resolveStemStart", () => {
  it("uses the player's clock when both agree", () => {
    expect(resolve(30, 30)).toEqual({ kind: "start", offsetSeconds: 30, source: "player" });
  });

  it("uses the player's clock when the element is on a concatenated stream", () => {
    expect(resolve(5.32, 226.84)).toEqual({ kind: "start", offsetSeconds: 5.32, source: "player" });
  });

  it("falls back to the element when the player gives nothing", () => {
    expect(resolve(Number.NaN, 42)).toEqual({ kind: "start", offsetSeconds: 42, source: "element" });
  });

  describe("regressions", () => {
    it("regression: a gapless append no longer starts the stems 221s in", () => {
      const start = resolve(5.32, 226.84, 314.89);
      expect(start).toEqual({ kind: "start", offsetSeconds: 5.32, source: "player" });
    });

    it("regression: a position past the stems bypasses instead of clamping into silence", () => {
      const start = resolve(226.84, 226.84, 187.66);
      expect(start.kind).toBe("bypass");
    });
  });

  describe("edge cases", () => {
    it("starts at zero at the top of a track", () => {
      expect(resolve(0, 0)).toEqual({ kind: "start", offsetSeconds: 0, source: "player" });
    });

    it("treats a negative player time as unusable and falls back", () => {
      expect(resolve(-1, 10)).toEqual({ kind: "start", offsetSeconds: 10, source: "element" });
    });

    it("bypasses when neither clock is readable", () => {
      expect(resolve(Number.NaN, Number.NaN).kind).toBe("bypass");
    });

    it("bypasses when there are no stems", () => {
      expect(resolve(10, 10, 0).kind).toBe("bypass");
      expect(resolve(10, 10, Number.NaN).kind).toBe("bypass");
    });

    it("allows a position slightly past the end, within tolerance", () => {
      const start = resolve(STEMS + OFFSET_TOLERANCE_S - 0.1, 0);
      expect(start).toEqual({ kind: "start", offsetSeconds: STEMS, source: "player" });
    });

    it("rejects a position past the tolerance", () => {
      expect(resolve(STEMS + OFFSET_TOLERANCE_S + 0.1, 0).kind).toBe("bypass");
    });
  });

  describe("invariants", () => {
    it("never returns an offset outside the stems", () => {
      for (const position of [0, 1, 99, 199.9, STEMS, STEMS + 1]) {
        const start = resolve(position, position);
        if (start.kind !== "start") continue;
        expect(start.offsetSeconds).toBeGreaterThanOrEqual(0);
        expect(start.offsetSeconds).toBeLessThanOrEqual(STEMS);
      }
    });

    it("ignores the element entirely whenever the player is readable", () => {
      for (const elementTime of [0, 50, 226.84, 10_000]) {
        expect(resolve(12, elementTime)).toEqual({ kind: "start", offsetSeconds: 12, source: "player" });
      }
    });
  });
});
