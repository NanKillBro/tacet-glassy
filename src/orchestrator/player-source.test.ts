import { playerStateFromBetterLyrics, playerStateFromOwnBridge } from "@/orchestrator/player-source";
import { describe, expect, it } from "vitest";

// A real blyrics-send-player-time detail, trimmed to the fields read here.
function betterLyricsDetail(overrides: Record<string, unknown> = {}): unknown {
  return {
    currentTime: 26.06,
    videoId: "DJCB1ZlseJ8",
    song: "Show Me How",
    artist: "Men I Trust",
    duration: 215,
    isPlaying: true,
    ...overrides,
  };
}

describe("playerStateFromBetterLyrics", () => {
  it("reads identity and duration out of the sibling's event", () => {
    expect(playerStateFromBetterLyrics(betterLyricsDetail())).toEqual({
      videoId: "DJCB1ZlseJ8",
      durationSeconds: 215,
    });
  });

  describe("edge cases", () => {
    it("refuses a detail that names no video", () => {
      expect(playerStateFromBetterLyrics(betterLyricsDetail({ videoId: "" }))).toBeNull();
      expect(playerStateFromBetterLyrics(betterLyricsDetail({ videoId: undefined }))).toBeNull();
      expect(playerStateFromBetterLyrics(betterLyricsDetail({ videoId: 42 }))).toBeNull();
    });

    it("refuses a player that has not resolved a duration yet", () => {
      expect(playerStateFromBetterLyrics(betterLyricsDetail({ duration: 0 }))).toBeNull();
      expect(playerStateFromBetterLyrics(betterLyricsDetail({ duration: Number.NaN }))).toBeNull();
      expect(playerStateFromBetterLyrics(betterLyricsDetail({ duration: Number.POSITIVE_INFINITY }))).toBeNull();
      expect(playerStateFromBetterLyrics(betterLyricsDetail({ duration: -1 }))).toBeNull();
    });

    it("refuses anything that is not a detail object", () => {
      expect(playerStateFromBetterLyrics(null)).toBeNull();
      expect(playerStateFromBetterLyrics(undefined)).toBeNull();
      expect(playerStateFromBetterLyrics("DJCB1ZlseJ8")).toBeNull();
      expect(playerStateFromBetterLyrics({})).toBeNull();
    });
  });
});

describe("playerStateFromOwnBridge", () => {
  it("reads our own page world's message", () => {
    expect(
      playerStateFromOwnBridge({ type: "blk-player-state", videoId: "DJCB1ZlseJ8", durationSeconds: 215 })
    ).toEqual({ videoId: "DJCB1ZlseJ8", durationSeconds: 215 });
  });

  describe("edge cases", () => {
    it("ignores every other message sharing the bridge", () => {
      expect(playerStateFromOwnBridge({ type: "blk-capture-ready", videoId: "DJCB1ZlseJ8" })).toBeNull();
      expect(playerStateFromOwnBridge({ type: "blk-stop-stems" })).toBeNull();
      expect(playerStateFromOwnBridge(null)).toBeNull();
    });

    it("applies the same gate as the sibling's event", () => {
      expect(playerStateFromOwnBridge({ type: "blk-player-state", videoId: "", durationSeconds: 215 })).toBeNull();
      expect(
        playerStateFromOwnBridge({ type: "blk-player-state", videoId: "DJCB1ZlseJ8", durationSeconds: 0 })
      ).toBeNull();
    });
  });

  describe("invariants", () => {
    it("agrees with the sibling's event for the same track", () => {
      const mine = playerStateFromOwnBridge({
        type: "blk-player-state",
        videoId: "DJCB1ZlseJ8",
        durationSeconds: 215,
      });
      expect(mine).toEqual(playerStateFromBetterLyrics(betterLyricsDetail()));
    });
  });
});
