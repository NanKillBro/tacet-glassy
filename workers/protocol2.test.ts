import { describe, expect, it } from "vitest";
import { type TrackPipelineOutboundMessage, isTrackPipelineOutboundMessage } from "./protocol2";

const SAMPLES: Record<TrackPipelineOutboundMessage["type"], TrackPipelineOutboundMessage> = {
  "blk-cache-hit": { type: "blk-cache-hit", videoId: "DJCB1ZlseJ8" },
  "blk-cache-miss": { type: "blk-cache-miss", videoId: "DJCB1ZlseJ8" },
  "blk-track-stage": { type: "blk-track-stage", videoId: "DJCB1ZlseJ8", stage: "separating" },
  "blk-track-progress": { type: "blk-track-progress", videoId: "DJCB1ZlseJ8", processed: 2, total: 9 },
  "blk-stem-chunk": {
    type: "blk-stem-chunk",
    videoId: "DJCB1ZlseJ8",
    stem: "vocals",
    index: 0,
    total: 1,
    data: "AAAA",
  },
  "blk-track-done": { type: "blk-track-done", videoId: "DJCB1ZlseJ8" },
  "blk-track-error": { type: "blk-track-error", videoId: "DJCB1ZlseJ8", code: "unknown", message: "boom" },
};

describe("isTrackPipelineOutboundMessage", () => {
  for (const [type, sample] of Object.entries(SAMPLES)) {
    it(`relays ${type}`, () => {
      expect(isTrackPipelineOutboundMessage(sample)).toBe(true);
    });
  }

  describe("regressions", () => {
    // The guard was hand-written in background.ts and omitted this one. The
    // orchestrator waits for it before acquiring a track, so dropping it in
    // transit meant no track was ever acquired and every separation ran on
    // whatever the listener had happened to buffer.
    it("regression: relays blk-cache-miss", () => {
      expect(isTrackPipelineOutboundMessage({ type: "blk-cache-miss", videoId: "DJCB1ZlseJ8" })).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("refuses messages the relay does not own", () => {
      expect(isTrackPipelineOutboundMessage({ type: "blk-probe-cache", videoId: "DJCB1ZlseJ8" })).toBe(false);
      expect(isTrackPipelineOutboundMessage({ type: "blk-capture-chunk", videoId: "DJCB1ZlseJ8" })).toBe(false);
      expect(isTrackPipelineOutboundMessage({ type: "blk-cache-status" })).toBe(false);
    });

    it("refuses a message of the right type carrying no videoId to route by", () => {
      expect(isTrackPipelineOutboundMessage({ type: "blk-cache-miss" })).toBe(false);
      expect(isTrackPipelineOutboundMessage({ type: "blk-cache-hit", videoId: 42 })).toBe(false);
    });

    it("refuses anything that is not a message", () => {
      expect(isTrackPipelineOutboundMessage(null)).toBe(false);
      expect(isTrackPipelineOutboundMessage(undefined)).toBe(false);
      expect(isTrackPipelineOutboundMessage("blk-cache-miss")).toBe(false);
      expect(isTrackPipelineOutboundMessage({})).toBe(false);
    });
  });
});
