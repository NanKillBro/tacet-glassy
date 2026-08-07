import { describe, expect, it } from "vitest";
import { initialKaraokeState, reduceKaraokeState } from "@/orchestrator/karaoke-state";
import type { KaraokeState } from "@/orchestrator/karaoke-state";

describe("initialKaraokeState", () => {
  it("starts waiting-for-capture for the given track, with no progress or reason", () => {
    expect(initialKaraokeState("video-1")).toEqual({
      status: "waiting-for-capture",
      videoId: "video-1",
      stage: null,
      processed: 0,
      total: 0,
      reason: null,
    });
  });
});

describe("track-changed", () => {
  it("resets to waiting-for-capture for a new videoId from any status", () => {
    const engaged: KaraokeState = {
      status: "engaged",
      videoId: "video-1",
      stage: null,
      processed: 10,
      total: 10,
      reason: null,
    };
    expect(reduceKaraokeState(engaged, { type: "track-changed", videoId: "video-2" })).toEqual(
      initialKaraokeState("video-2")
    );
  });

  it("resets from a failed state too", () => {
    const failed: KaraokeState = {
      status: "failed",
      videoId: "video-1",
      stage: null,
      processed: 0,
      total: 0,
      reason: "boom",
    };
    expect(reduceKaraokeState(failed, { type: "track-changed", videoId: "video-2" })).toEqual(
      initialKaraokeState("video-2")
    );
  });

  it("is a no-op for the same videoId, returning the identical state", () => {
    const state = initialKaraokeState("video-1");
    expect(reduceKaraokeState(state, { type: "track-changed", videoId: "video-1" })).toBe(state);
  });
});

describe("capture-ready", () => {
  it("moves waiting-for-capture to ready-to-engage", () => {
    const state = initialKaraokeState("video-1");
    const next = reduceKaraokeState(state, { type: "capture-ready", videoId: "video-1" });
    expect(next.status).toBe("ready-to-engage");
  });

  it("is ignored for a videoId that is not the current track", () => {
    const state = initialKaraokeState("video-1");
    const next = reduceKaraokeState(state, { type: "capture-ready", videoId: "video-2" });
    expect(next).toBe(state);
  });

  it("is ignored once already past waiting-for-capture", () => {
    const ready = reduceKaraokeState(initialKaraokeState("video-1"), {
      type: "capture-ready",
      videoId: "video-1",
    });
    const again = reduceKaraokeState(ready, { type: "capture-ready", videoId: "video-1" });
    expect(again).toBe(ready);
  });
});

describe("engage", () => {
  function readyState(): KaraokeState {
    return reduceKaraokeState(initialKaraokeState("video-1"), { type: "capture-ready", videoId: "video-1" });
  }

  it("moves ready-to-engage to processing", () => {
    const next = reduceKaraokeState(readyState(), { type: "engage", videoId: "video-1" });
    expect(next.status).toBe("processing");
  });

  it("is ignored while still waiting-for-capture", () => {
    const state = initialKaraokeState("video-1");
    const next = reduceKaraokeState(state, { type: "engage", videoId: "video-1" });
    expect(next).toBe(state);
  });

  it("is idempotent once already processing", () => {
    const processing = reduceKaraokeState(readyState(), { type: "engage", videoId: "video-1" });
    const again = reduceKaraokeState(processing, { type: "engage", videoId: "video-1" });
    expect(again).toBe(processing);
  });

  it("is idempotent once already engaged", () => {
    let state = readyState();
    state = reduceKaraokeState(state, { type: "engage", videoId: "video-1" });
    state = reduceKaraokeState(state, { type: "stems-loaded", videoId: "video-1" });
    const again = reduceKaraokeState(state, { type: "engage", videoId: "video-1" });
    expect(again).toBe(state);
  });
});

describe("stage and progress", () => {
  function processingState(): KaraokeState {
    let state = initialKaraokeState("video-1");
    state = reduceKaraokeState(state, { type: "capture-ready", videoId: "video-1" });
    state = reduceKaraokeState(state, { type: "engage", videoId: "video-1" });
    return state;
  }

  it("records the stage while processing", () => {
    const next = reduceKaraokeState(processingState(), { type: "stage", videoId: "video-1", stage: "decoding" });
    expect(next.stage).toBe("decoding");
    expect(next.status).toBe("processing");
  });

  it("records processed and total while processing", () => {
    const next = reduceKaraokeState(processingState(), {
      type: "progress",
      videoId: "video-1",
      processed: 3,
      total: 10,
    });
    expect(next.processed).toBe(3);
    expect(next.total).toBe(10);
  });

  it("is ignored outside of processing", () => {
    const state = initialKaraokeState("video-1");
    const next = reduceKaraokeState(state, { type: "progress", videoId: "video-1", processed: 3, total: 10 });
    expect(next).toBe(state);
  });
});

describe("stems-loaded", () => {
  it("moves processing to engaged and clears any reason", () => {
    let state = initialKaraokeState("video-1");
    state = reduceKaraokeState(state, { type: "capture-ready", videoId: "video-1" });
    state = reduceKaraokeState(state, { type: "engage", videoId: "video-1" });
    const next = reduceKaraokeState(state, { type: "stems-loaded", videoId: "video-1" });
    expect(next.status).toBe("engaged");
    expect(next.reason).toBeNull();
  });

  it("is ignored outside of processing", () => {
    const state = initialKaraokeState("video-1");
    const next = reduceKaraokeState(state, { type: "stems-loaded", videoId: "video-1" });
    expect(next).toBe(state);
  });
});

describe("failed", () => {
  it("moves any status to failed with the given reason, for the current track", () => {
    const state = initialKaraokeState("video-1");
    const next = reduceKaraokeState(state, { type: "failed", videoId: "video-1", reason: "no captured audio" });
    expect(next.status).toBe("failed");
    expect(next.reason).toBe("no captured audio");
  });

  it("fails out of processing too", () => {
    let state = initialKaraokeState("video-1");
    state = reduceKaraokeState(state, { type: "capture-ready", videoId: "video-1" });
    state = reduceKaraokeState(state, { type: "engage", videoId: "video-1" });
    const next = reduceKaraokeState(state, { type: "failed", videoId: "video-1", reason: "separation crashed" });
    expect(next.status).toBe("failed");
  });

  it("is ignored for a stale videoId from a previous track", () => {
    const state = initialKaraokeState("video-1");
    const next = reduceKaraokeState(state, { type: "failed", videoId: "video-0", reason: "stale" });
    expect(next).toBe(state);
  });

  describe("regressions", () => {
    it("a failed state is terminal: engage and capture-ready no longer apply until the track changes", () => {
      const failed = reduceKaraokeState(initialKaraokeState("video-1"), {
        type: "failed",
        videoId: "video-1",
        reason: "boom",
      });
      expect(reduceKaraokeState(failed, { type: "capture-ready", videoId: "video-1" })).toBe(failed);
      expect(reduceKaraokeState(failed, { type: "engage", videoId: "video-1" })).toBe(failed);
    });
  });
});

describe("invariants", () => {
  it("processed and total are always zero immediately after a track change", () => {
    const engaged: KaraokeState = {
      status: "engaged",
      videoId: "video-1",
      stage: null,
      processed: 7,
      total: 7,
      reason: null,
    };
    const next = reduceKaraokeState(engaged, { type: "track-changed", videoId: "video-2" });
    expect(next.processed).toBe(0);
    expect(next.total).toBe(0);
  });

  it("an event for a videoId other than the current one never changes status", () => {
    const state = initialKaraokeState("video-1");
    for (const event of [
      { type: "capture-ready" as const, videoId: "other" },
      { type: "engage" as const, videoId: "other" },
      { type: "stems-loaded" as const, videoId: "other" },
      { type: "failed" as const, videoId: "other", reason: "x" },
    ]) {
      expect(reduceKaraokeState(state, event).status).toBe(state.status);
    }
  });
});
