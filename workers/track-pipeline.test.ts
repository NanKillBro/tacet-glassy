import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { bytesToBase64 } from "../src/relay/base64.js";
import type { CaptureChunkMessage, TrackPipelineOutboundMessage } from "./protocol2.js";
import type { SeparationHost } from "./separation-host.js";
import { TrackPipeline } from "./track-pipeline.js";

// Covers the wiring rather than the decision: decideSeparationStart is tested
// on its own, and what broke in the browser was a pipeline that never asked it.

const posted: TrackPipelineOutboundMessage[] = [];
let cancelCount = 0;

function fakeSeparationHost(): SeparationHost {
  return {
    cancel(): void {
      cancelCount++;
    },
    async init(): Promise<void> {},
    async process(): Promise<void> {},
    dispose(): void {},
  } as unknown as SeparationHost;
}

function captureChunk(videoId: string): CaptureChunkMessage {
  return {
    type: "blk-capture-chunk",
    videoId,
    mimeType: "audio/webm",
    index: 0,
    total: 1,
    data: bytesToBase64(new Uint8Array([1, 2, 3, 4])),
  };
}

// Every run() opens with this stage, so counting it counts runs started.
function runsStartedFor(videoId: string): number {
  return posted.filter(
    message => message.type === "blk-track-stage" && message.videoId === videoId && message.stage === "checking-cache"
  ).length;
}

beforeEach(() => {
  posted.length = 0;
  cancelCount = 0;
  indexedDB = new IDBFactory();
  globalThis.chrome = {
    runtime: {
      sendMessage: async (message: TrackPipelineOutboundMessage) => {
        posted.push(message);
        return undefined;
      },
    },
  } as unknown as typeof chrome;
});

describe("TrackPipeline separation gating", () => {
  it("starts a separation for a completed capture", async () => {
    const pipeline = new TrackPipeline(fakeSeparationHost(), () => 250 * 1024 * 1024);
    pipeline.handleCaptureChunk(captureChunk("DJCB1ZlseJ8"));
    await Promise.resolve();

    expect(runsStartedFor("DJCB1ZlseJ8")).toBe(1);
  });

  describe("regressions", () => {
    // Measured: an ad announced a complete capture and the track announced its
    // own, both under the same videoId, so two runs overlapped and the WebGPU
    // EP failed the whole job with "another WebGPU EP inference session is
    // being created". The videoId check alone let both through.
    it("regression: ignores a second capture for the track already separating", async () => {
      const pipeline = new TrackPipeline(fakeSeparationHost(), () => 250 * 1024 * 1024);
      pipeline.handleCaptureChunk(captureChunk("DJCB1ZlseJ8"));
      pipeline.handleCaptureChunk(captureChunk("DJCB1ZlseJ8"));
      await Promise.resolve();

      expect(runsStartedFor("DJCB1ZlseJ8")).toBe(1);
    });
  });

  it("supersedes a run the listener has moved off", async () => {
    const pipeline = new TrackPipeline(fakeSeparationHost(), () => 250 * 1024 * 1024);
    pipeline.handleCaptureChunk(captureChunk("DJCB1ZlseJ8"));
    pipeline.handleCaptureChunk(captureChunk("lYBUbBu4W08"));
    await Promise.resolve();

    expect(cancelCount).toBeGreaterThan(0);
    expect(runsStartedFor("lYBUbBu4W08")).toBe(1);
  });

  it("takes a new capture once the previous run has settled", async () => {
    const pipeline = new TrackPipeline(fakeSeparationHost(), () => 250 * 1024 * 1024);
    pipeline.handleCaptureChunk(captureChunk("DJCB1ZlseJ8"));
    // Long enough for the first run to reject on decode, which Node cannot do.
    await new Promise(resolve => setTimeout(resolve, 50));
    pipeline.handleCaptureChunk(captureChunk("DJCB1ZlseJ8"));
    await Promise.resolve();

    expect(runsStartedFor("DJCB1ZlseJ8")).toBe(2);
  });

  describe("invariants", () => {
    it("never runs two separations at once, however many captures arrive", async () => {
      const pipeline = new TrackPipeline(fakeSeparationHost(), () => 250 * 1024 * 1024);
      for (let index = 0; index < 5; index++) pipeline.handleCaptureChunk(captureChunk("DJCB1ZlseJ8"));
      await Promise.resolve();

      expect(runsStartedFor("DJCB1ZlseJ8")).toBe(1);
    });
  });
});
