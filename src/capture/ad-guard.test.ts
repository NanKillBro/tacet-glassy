import {
  AD_SHOWING_CLASS,
  PLAYER_BAR_AD_ATTRIBUTE,
  isPlayingSomethingElse,
  moviePlayerShowsAd,
  playerBarShowsAd,
} from "@/capture/ad-guard";
import { describe, expect, it } from "vitest";

function elementWithClasses(classes: string[]): { classList: { contains(className: string): boolean } } {
  return { classList: { contains: className => classes.includes(className) } };
}

function elementWithAttributes(attributes: string[]): { hasAttribute(name: string): boolean } {
  return { hasAttribute: name => attributes.includes(name) };
}

describe("moviePlayerShowsAd", () => {
  it("is true when the movie player carries the ad-showing class", () => {
    expect(moviePlayerShowsAd(elementWithClasses([AD_SHOWING_CLASS]))).toBe(true);
  });

  it("is false during a track", () => {
    expect(moviePlayerShowsAd(elementWithClasses(["playing-mode", "ytp-large-play-button"]))).toBe(false);
  });

  describe("regressions", () => {
    it("regression: does not read the dead ytp-ad-playing class", () => {
      expect(AD_SHOWING_CLASS).not.toBe("ytp-ad-playing");
      expect(moviePlayerShowsAd(elementWithClasses(["ytp-ad-playing"]))).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("is false when the player has no classes at all", () => {
      expect(moviePlayerShowsAd(elementWithClasses([]))).toBe(false);
    });

    it("is false before the player has mounted", () => {
      expect(moviePlayerShowsAd(null)).toBe(false);
    });
  });
});

describe("playerBarShowsAd", () => {
  it("is true when the player bar is marked as an advertisement", () => {
    expect(playerBarShowsAd(elementWithAttributes([PLAYER_BAR_AD_ATTRIBUTE]))).toBe(true);
  });

  it("is false during a track", () => {
    expect(playerBarShowsAd(elementWithAttributes(["player-page-open"]))).toBe(false);
  });

  describe("edge cases", () => {
    it("is false before the bar has mounted", () => {
      expect(playerBarShowsAd(null)).toBe(false);
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

    it("treats a null isAd as no information rather than as a verdict", () => {
      expect(isPlayingSomethingElse({ isAd: null, video_id: "track" }, "track")).toBe(false);
      expect(isPlayingSomethingElse({ isAd: null, video_id: "other" }, "track")).toBe(true);
    });
  });
});
