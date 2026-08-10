import { resolveOptionIndex, selectKeyAction, wrapIndex } from "@/settings/select-state";
import { describe, expect, it } from "vitest";

const VARIANTS = ["fp32", "fp16"];

describe("resolveOptionIndex", () => {
  it("finds the index of a known value", () => {
    expect(resolveOptionIndex(VARIANTS, "fp32")).toBe(0);
    expect(resolveOptionIndex(VARIANTS, "fp16")).toBe(1);
  });

  describe("edge cases", () => {
    it("falls back to the first option for an unknown value", () => {
      expect(resolveOptionIndex(VARIANTS, "fp8")).toBe(0);
    });

    it("falls back to the first option for an empty value", () => {
      expect(resolveOptionIndex(VARIANTS, "")).toBe(0);
    });

    it("returns zero when there are no options at all", () => {
      expect(resolveOptionIndex([], "fp32")).toBe(0);
    });

    it("takes the first of a duplicated value", () => {
      expect(resolveOptionIndex(["a", "b", "a"], "a")).toBe(0);
    });
  });

  describe("invariants", () => {
    it("never returns an index past the end of a non-empty list", () => {
      for (const value of ["fp32", "fp16", "nope", ""]) {
        expect(resolveOptionIndex(VARIANTS, value)).toBeLessThan(VARIANTS.length);
      }
    });
  });
});

describe("wrapIndex", () => {
  it("steps forward", () => {
    expect(wrapIndex(3, 0, 1)).toBe(1);
    expect(wrapIndex(3, 1, 1)).toBe(2);
  });

  it("steps backward", () => {
    expect(wrapIndex(3, 2, -1)).toBe(1);
    expect(wrapIndex(3, 1, -1)).toBe(0);
  });

  it("wraps past the end back to the start", () => {
    expect(wrapIndex(3, 2, 1)).toBe(0);
  });

  it("wraps before the start back to the end", () => {
    expect(wrapIndex(3, 0, -1)).toBe(2);
  });

  describe("edge cases", () => {
    it("returns -1 when there is nothing to focus", () => {
      expect(wrapIndex(0, 0, 1)).toBe(-1);
      expect(wrapIndex(0, -1, -1)).toBe(-1);
    });

    it("treats a single option as a fixed point", () => {
      expect(wrapIndex(1, 0, 1)).toBe(0);
      expect(wrapIndex(1, 0, -1)).toBe(0);
    });

    it("treats an unknown origin as the first option", () => {
      expect(wrapIndex(3, -1, 1)).toBe(1);
      expect(wrapIndex(3, -1, -1)).toBe(2);
    });

    it("handles a step larger than the list", () => {
      expect(wrapIndex(3, 0, 7)).toBe(1);
      expect(wrapIndex(3, 0, -7)).toBe(2);
    });
  });

  describe("invariants", () => {
    it("always lands inside the list", () => {
      for (let from = 0; from < 4; from++) {
        for (const step of [-2, -1, 1, 2]) {
          const index = wrapIndex(4, from, step);
          expect(index).toBeGreaterThanOrEqual(0);
          expect(index).toBeLessThan(4);
        }
      }
    });

    it("forward then backward returns where it started", () => {
      for (let from = 0; from < 5; from++) {
        expect(wrapIndex(5, wrapIndex(5, from, 1), -1)).toBe(from);
      }
    });
  });
});

describe("selectKeyAction", () => {
  it("opens a closed listbox with either arrow", () => {
    expect(selectKeyAction("ArrowDown", false)).toBe("open");
    expect(selectKeyAction("ArrowUp", false)).toBe("open");
  });

  it("moves focus once open", () => {
    expect(selectKeyAction("ArrowDown", true)).toBe("focus-next");
    expect(selectKeyAction("ArrowUp", true)).toBe("focus-previous");
  });

  it("jumps to the ends once open", () => {
    expect(selectKeyAction("Home", true)).toBe("focus-first");
    expect(selectKeyAction("End", true)).toBe("focus-last");
  });

  it("closes on Escape", () => {
    expect(selectKeyAction("Escape", true)).toBe("close");
  });

  describe("edge cases", () => {
    it("ignores keys that do nothing while closed", () => {
      for (const key of ["Escape", "Home", "End"]) {
        expect(selectKeyAction(key, false)).toBeNull();
      }
    });

    it("ignores unrelated keys in both states", () => {
      for (const key of ["a", "Tab", "Enter", " ", "ArrowLeft", "ArrowRight", ""]) {
        expect(selectKeyAction(key, true)).toBeNull();
        expect(selectKeyAction(key, false)).toBeNull();
      }
    });

    it("is case sensitive, matching KeyboardEvent.key", () => {
      expect(selectKeyAction("escape", true)).toBeNull();
      expect(selectKeyAction("arrowdown", false)).toBeNull();
    });
  });

  describe("invariants", () => {
    it("never asks a closed listbox to move focus", () => {
      for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Escape"]) {
        const action = selectKeyAction(key, false);
        expect(action === null || !action.startsWith("focus-")).toBe(true);
      }
    });

    it("never asks a closed listbox to close", () => {
      for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Escape"]) {
        expect(selectKeyAction(key, false)).not.toBe("close");
      }
    });

    it("never asks an open listbox to open again", () => {
      for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Escape"]) {
        expect(selectKeyAction(key, true)).not.toBe("open");
      }
    });
  });
});
