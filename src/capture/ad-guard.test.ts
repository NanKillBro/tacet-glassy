import { AD_PLAYING_CLASS, isAdPlayingElement } from "@/capture/ad-guard";
import { describe, expect, it } from "vitest";

function elementWithClasses(classes: string[]): { classList: { contains(className: string): boolean } } {
  return { classList: { contains: className => classes.includes(className) } };
}

describe("isAdPlayingElement", () => {
  it("is true when the movie player carries the ad-playing class", () => {
    expect(isAdPlayingElement(elementWithClasses([AD_PLAYING_CLASS]))).toBe(true);
  });

  it("is false when the movie player has other classes but not ad-playing", () => {
    expect(isAdPlayingElement(elementWithClasses(["ytp-large-play-button"]))).toBe(false);
  });

  describe("edge cases", () => {
    it("is false when the movie player has no classes at all", () => {
      expect(isAdPlayingElement(elementWithClasses([]))).toBe(false);
    });

    it("is false when the element is null, e.g. the player has not mounted yet", () => {
      expect(isAdPlayingElement(null)).toBe(false);
    });
  });

  describe("invariants", () => {
    it("is a pure function: identical input produces identical output", () => {
      const element = elementWithClasses([AD_PLAYING_CLASS]);
      expect(isAdPlayingElement(element)).toBe(isAdPlayingElement(element));
    });
  });
});
