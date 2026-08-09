import { isAdPlaying } from "@/capture/ad-state";
import { describe, expect, it } from "vitest";

function fakeDocument(options: { barAttributes?: string[] | null } = {}): Document {
  const { barAttributes = [] } = options;
  const playerBar = barAttributes && {
    hasAttribute: (name: string) => barAttributes.includes(name),
  };

  return {
    querySelector: (selector: string) => (selector === "ytmusic-player-bar" ? playerBar : null),
  } as unknown as Document;
}

describe("isAdPlaying", () => {
  it("is false during a track", () => {
    expect(isAdPlaying(fakeDocument())).toBe(false);
  });

  it("is true on the player bar's is-advertisement attribute", () => {
    expect(isAdPlaying(fakeDocument({ barAttributes: ["is-advertisement"] }))).toBe(true);
  });

  describe("regressions", () => {
    it("regression: a player id disagreeing with the url is not an ad", () => {
      expect(isAdPlaying(fakeDocument({ barAttributes: [] }))).toBe(false);
    });

    it("regression: reads only the signal Better Lyrics reads", () => {
      expect(isAdPlaying(fakeDocument({ barAttributes: ["ad-showing", "player-page-open"] }))).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("is false before the bar has mounted", () => {
      expect(isAdPlaying(fakeDocument({ barAttributes: null }))).toBe(false);
    });
  });
});
