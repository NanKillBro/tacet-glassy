import { PLAYER_BAR_AD_ATTRIBUTE, PLAYER_BAR_SELECTOR, playerBarShowsAd } from "@/capture/ad-guard";
import { describe, expect, it } from "vitest";

function elementWithAttributes(attributes: string[]): { hasAttribute(name: string): boolean } {
  return { hasAttribute: name => attributes.includes(name) };
}

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

  describe("regressions", () => {
    it("regression: reads the same bar and attribute Better Lyrics reads", () => {
      expect(PLAYER_BAR_SELECTOR).toBe("ytmusic-player-bar");
      expect(PLAYER_BAR_AD_ATTRIBUTE).toBe("is-advertisement");
    });

    it("regression: a player id that disagrees with the url is not an ad signal", () => {
      expect(playerBarShowsAd(elementWithAttributes([]))).toBe(false);
    });
  });
});
