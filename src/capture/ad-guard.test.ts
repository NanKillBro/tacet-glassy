import { AD_PLAYING_CLASS, isAdPlayingElement, isPlayingSomethingElse } from "@/capture/ad-guard";
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

describe("isPlayingSomethingElse", () => {
  it("trusts the player when it says it is showing an ad", () => {
    expect(isPlayingSomethingElse({ isAd: true, video_id: "track" }, "track")).toBe(true);
  });

  it("catches an ad the player only reveals through its id", () => {
    expect(isPlayingSomethingElse({ video_id: "ad-creative" }, "track")).toBe(true);
  });

  it("passes the track it was asked for", () => {
    expect(isPlayingSomethingElse({ video_id: "track", isAd: false }, "track")).toBe(false);
  });

  describe("edge cases", () => {
    it("says nothing when the player will not say", () => {
      expect(isPlayingSomethingElse(null, "track")).toBe(false);
    });

    it("says nothing when there is no requested track to compare against", () => {
      expect(isPlayingSomethingElse({ video_id: "whatever" }, null)).toBe(false);
      expect(isPlayingSomethingElse({ video_id: "whatever" }, "")).toBe(false);
    });

    it("ignores a malformed video_id rather than treating it as a mismatch", () => {
      expect(isPlayingSomethingElse({ video_id: 42 }, "track")).toBe(false);
      expect(isPlayingSomethingElse({}, "track")).toBe(false);
    });

    // isAd is checked before video_id so a player that reports an ad without
    // changing its id is still caught.
    it("catches an ad that keeps the track's own id", () => {
      expect(isPlayingSomethingElse({ isAd: true, video_id: "track" }, "track")).toBe(true);
    });
  });
});
