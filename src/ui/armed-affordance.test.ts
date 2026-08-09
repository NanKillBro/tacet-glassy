import { describe, expect, it } from "vitest";
import { ARMED_LABEL, labelWhileBusy, shouldShowActivePill } from "@/ui/armed-affordance";

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

describe("labelWhileBusy", () => {
  it("keeps the stage's own wording when nothing is armed", () => {
    expect(labelWhileBusy("Separating vocals…", false)).toBe("Separating vocals…");
    expect(labelWhileBusy("Downloading the separation model…", false)).toBe("Downloading the separation model…");
  });

  it("promises the outcome once armed, whatever the stage is", () => {
    expect(labelWhileBusy("Separating vocals…", true)).toBe(ARMED_LABEL);
    expect(labelWhileBusy("Downloading the separation model…", true)).toBe(ARMED_LABEL);
    expect(labelWhileBusy("Checking for cached vocals…", true)).toBe(ARMED_LABEL);
  });

  describe("edge cases", () => {
    it("does not invent a label from an empty stage", () => {
      expect(labelWhileBusy("", false)).toBe("");
    });
  });
});
