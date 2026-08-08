import { isAdPlaying } from "@/capture/ad-state";
import { describe, expect, it } from "vitest";

interface FakePlayerOptions {
  classes?: string[];
  videoData?: { video_id?: unknown; isAd?: unknown } | null;
}

function fakeDocument(
  options: { search?: string; player?: FakePlayerOptions | null; barAttributes?: string[] | null } = {}
): Document {
  const { search = "?v=track", player = {}, barAttributes = [] } = options;

  const moviePlayer = player && {
    classList: { contains: (name: string) => (player.classes ?? []).includes(name) },
    getVideoData: () => player.videoData ?? null,
  };
  const playerBar = barAttributes && {
    hasAttribute: (name: string) => barAttributes.includes(name),
  };

  return {
    defaultView: { location: { search } },
    getElementById: (id: string) => (id === "movie_player" ? moviePlayer : null),
    querySelector: (selector: string) => (selector === "ytmusic-player-bar" ? playerBar : null),
  } as unknown as Document;
}

describe("isAdPlaying", () => {
  it("is false during a track, with every signal quiet", () => {
    expect(isAdPlaying(fakeDocument({ player: { videoData: { video_id: "track" } } }))).toBe(false);
  });

  it("is true on the movie player's ad-showing class alone", () => {
    expect(isAdPlaying(fakeDocument({ player: { classes: ["ad-showing"] } }))).toBe(true);
  });

  it("is true on the player bar's is-advertisement attribute alone", () => {
    expect(isAdPlaying(fakeDocument({ barAttributes: ["is-advertisement"] }))).toBe(true);
  });

  it("is true when the player names a track other than the one requested", () => {
    expect(isAdPlaying(fakeDocument({ player: { videoData: { video_id: "ad-creative" } } }))).toBe(true);
  });

  describe("regressions", () => {
    // The bar attribute lagged the class by one sample at every creative
    // change, so either signal alone leaves a window where an ad is captured.
    it("regression: catches the sample where only the class has flipped", () => {
      const doc = fakeDocument({ player: { classes: ["ad-showing"], videoData: { video_id: "track" } } });
      expect(isAdPlaying(doc)).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("is false before the player and the bar have mounted", () => {
      expect(isAdPlaying(fakeDocument({ player: null, barAttributes: null }))).toBe(false);
    });

    it("does not treat an unidentifiable page as an ad", () => {
      expect(isAdPlaying(fakeDocument({ search: "", player: { videoData: { video_id: "track" } } }))).toBe(false);
    });
  });

  describe("invariants", () => {
    it("stays true while any one signal is set", () => {
      const signals: Array<Parameters<typeof fakeDocument>[0]> = [
        { player: { classes: ["ad-showing"] } },
        { barAttributes: ["is-advertisement"] },
        { player: { videoData: { isAd: true, video_id: "track" } } },
      ];
      for (const signal of signals) expect(isAdPlaying(fakeDocument(signal))).toBe(true);
    });
  });
});
