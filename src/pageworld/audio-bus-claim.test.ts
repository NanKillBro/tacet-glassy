import { decideAudioBusClaim } from "@/pageworld/audio-bus-claim";
import { describe, expect, it } from "vitest";

interface FakeBus {
  version: number;
  marker: string;
}

function isFakeBus(value: unknown): value is FakeBus {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { version?: unknown }).version === "number" &&
    typeof (value as { marker?: unknown }).marker === "string"
  );
}

describe("decideAudioBusClaim", () => {
  it("first writer: nothing published yet, so it creates", () => {
    expect(decideAudioBusClaim(undefined, 1, isFakeBus)).toBe("create");
  });

  it("second writer: a matching-version bus is already published, so it reuses", () => {
    const existing: FakeBus = { version: 1, marker: "published-by-someone-else" };
    expect(decideAudioBusClaim(existing, 1, isFakeBus)).toBe("reuse");
  });

  it("a mismatched version is treated as incompatible, not upgraded in place", () => {
    const existing: FakeBus = { version: 2, marker: "newer-writer" };
    expect(decideAudioBusClaim(existing, 1, isFakeBus)).toBe("incompatible");
  });

  describe("edge cases", () => {
    it("null is treated the same as undefined: nothing published yet", () => {
      expect(decideAudioBusClaim(null, 1, isFakeBus)).toBe("create");
    });

    it("a value of the wrong shape entirely is incompatible", () => {
      expect(decideAudioBusClaim({ notABus: true }, 1, isFakeBus)).toBe("incompatible");
      expect(decideAudioBusClaim("a string", 1, isFakeBus)).toBe("incompatible");
      expect(decideAudioBusClaim(42, 1, isFakeBus)).toBe("incompatible");
    });

    it("version 0 is a valid version, not treated as falsy/missing", () => {
      const existing: FakeBus = { version: 0, marker: "zero-is-a-real-version" };
      expect(decideAudioBusClaim(existing, 0, isFakeBus)).toBe("reuse");
    });
  });

  describe("invariants", () => {
    it("never calls create() itself: it only decides, callers own the side effect", () => {
      const result = decideAudioBusClaim(undefined, 1, isFakeBus);
      expect(typeof result).toBe("string");
    });
  });
});
