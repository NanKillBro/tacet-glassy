import { describe, expect, it } from "vitest";
import { ARMED_LABEL, shouldShowActivePill } from "@/ui/armed-affordance";

describe("shouldShowActivePill", () => {
  it("shows the pill once vocals are actually coming out", () => {
    expect(shouldShowActivePill(-1, false)).toBe(true);
    expect(shouldShowActivePill(-0.4, false)).toBe(true);
  });

  it("withholds the pill while separation is still running", () => {
    expect(shouldShowActivePill(-1, true)).toBe(false);
  });

  it("keeps the pill off at rest", () => {
    expect(shouldShowActivePill(0, false)).toBe(false);
    expect(shouldShowActivePill(0, true)).toBe(false);
  });

  describe("invariants", () => {
    it("never shows the pill while busy, at any level", () => {
      for (const value of [0, -0.05, -0.5, -0.95, -1]) {
        expect(shouldShowActivePill(value, true)).toBe(false);
      }
    });

    it("armed and engaged are distinguishable at every level", () => {
      for (const value of [-0.2, -0.6, -1]) {
        expect(shouldShowActivePill(value, true)).not.toBe(shouldShowActivePill(value, false));
      }
    });
  });

  describe("edge cases", () => {
    it("treats negative zero as rest", () => {
      expect(shouldShowActivePill(-0, false)).toBe(false);
    });
  });
});

describe("ARMED_LABEL", () => {
  it("reads as a promise about what happens next, not as a stage", () => {
    expect(ARMED_LABEL).toBe("Karaoke starts when this finishes");
  });
});
