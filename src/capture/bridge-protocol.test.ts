import { describe, expect, it } from "vitest";
import {
  isCaptureReadyMessage,
  isCaptureStandDownMessage,
  isRequestPrefetchMessage,
  isCapturedAudioMessage,
  isCapturedAudioUnavailableMessage,
  isRequestCapturedAudioMessage,
  isSliceCapturedMessage,
} from "@/capture/bridge-protocol";
import type {
  CaptureReadyMessage,
  CaptureStandDownMessage,
  RequestPrefetchMessage,
  CapturedAudioMessage,
  CapturedAudioUnavailableMessage,
  RequestCapturedAudioMessage,
  SliceCapturedMessage,
} from "@/capture/bridge-protocol";

function sliceCaptured(overrides: Partial<SliceCapturedMessage> = {}): Record<string, unknown> {
  return {
    type: "blk-slice-captured",
    videoId: "abc123",
    index: 0,
    startSeconds: 0,
    reachedSeconds: 215.1,
    trackDurationSeconds: 215.1,
    mimeType: "audio/webm",
    bytes: new Uint8Array([1, 2, 3, 4]).buffer,
    ...overrides,
  };
}

describe("capture bridge protocol", () => {
  it("round-trips blk-request-captured-audio through structured clone", () => {
    const message: RequestCapturedAudioMessage = { type: "blk-request-captured-audio", videoId: "abc123" };
    expect(isRequestCapturedAudioMessage(structuredClone(message))).toBe(true);
  });

  it("round-trips blk-captured-audio with its buffer transferred, not copied", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const message: CapturedAudioMessage = {
      type: "blk-captured-audio",
      videoId: "abc123",
      mimeType: "audio/webm",
      bytes,
    };

    const cloned = structuredClone(message, { transfer: [bytes] });

    expect(isCapturedAudioMessage(cloned)).toBe(true);
    if (!isCapturedAudioMessage(cloned)) throw new Error("unreachable");
    expect(Array.from(new Uint8Array(cloned.bytes))).toEqual([1, 2, 3, 4]);
    expect(bytes.byteLength).toBe(0);
  });

  it("round-trips blk-captured-audio-unavailable", () => {
    const message: CapturedAudioUnavailableMessage = {
      type: "blk-captured-audio-unavailable",
      videoId: "abc123",
      reason: "no chunks captured for this track",
    };
    expect(isCapturedAudioUnavailableMessage(structuredClone(message))).toBe(true);
  });

  it("round-trips blk-capture-ready", () => {
    const message: CaptureReadyMessage = { type: "blk-capture-ready", videoId: "abc123" };
    expect(isCaptureReadyMessage(structuredClone(message))).toBe(true);
  });

  it("round-trips blk-request-prefetch", () => {
    const message: RequestPrefetchMessage = { type: "blk-request-prefetch", videoId: "abc123" };
    expect(isRequestPrefetchMessage(structuredClone(message))).toBe(true);
  });

  it("round-trips blk-capture-stand-down", () => {
    const message: CaptureStandDownMessage = { type: "blk-capture-stand-down", videoId: "abc123" };
    expect(isCaptureStandDownMessage(structuredClone(message))).toBe(true);
  });

  describe("edge cases", () => {
    it("rejects null, primitives, and unrelated objects", () => {
      expect(isRequestCapturedAudioMessage(null)).toBe(false);
      expect(isRequestCapturedAudioMessage(undefined)).toBe(false);
      expect(isRequestCapturedAudioMessage("blk-request-captured-audio")).toBe(false);
      expect(isRequestCapturedAudioMessage({ foo: "bar" })).toBe(false);
    });

    it("rejects a request message missing videoId", () => {
      expect(isRequestCapturedAudioMessage({ type: "blk-request-captured-audio" })).toBe(false);
    });

    it("does not confuse a prefetch request with a request for captured audio", () => {
      expect(isRequestPrefetchMessage({ type: "blk-request-prefetch" })).toBe(false);
      expect(isRequestPrefetchMessage({ type: "blk-request-captured-audio", videoId: "abc123" })).toBe(false);
      expect(isRequestCapturedAudioMessage({ type: "blk-request-prefetch", videoId: "abc123" })).toBe(false);
    });

    it("rejects a stand-down message missing videoId, and does not confuse it with capture-ready", () => {
      expect(isCaptureStandDownMessage({ type: "blk-capture-stand-down" })).toBe(false);
      expect(isCaptureStandDownMessage({ type: "blk-capture-ready", videoId: "abc123" })).toBe(false);
      expect(isCaptureReadyMessage({ type: "blk-capture-stand-down", videoId: "abc123" })).toBe(false);
    });

    it("rejects a captured-audio message whose bytes are not an ArrayBuffer", () => {
      const malformed = { type: "blk-captured-audio", videoId: "abc123", mimeType: "audio/webm", bytes: [1, 2, 3] };
      expect(isCapturedAudioMessage(malformed)).toBe(false);
    });

    it("rejects an unavailable message missing a reason", () => {
      expect(isCapturedAudioUnavailableMessage({ type: "blk-captured-audio-unavailable", videoId: "abc123" })).toBe(
        false
      );
    });

    it("does not cross-match another message's discriminant", () => {
      const readyMessage: CaptureReadyMessage = { type: "blk-capture-ready", videoId: "abc123" };
      expect(isRequestCapturedAudioMessage(readyMessage)).toBe(false);
      expect(isCapturedAudioMessage(readyMessage)).toBe(false);
      expect(isCapturedAudioUnavailableMessage(readyMessage)).toBe(false);
      expect(isSliceCapturedMessage(readyMessage)).toBe(false);
    });
  });

  describe("blk-slice-captured", () => {
    it("round-trips through structured clone", () => {
      expect(isSliceCapturedMessage(structuredClone(sliceCaptured()))).toBe(true);
    });

    it("accepts a slice that stopped short, since refusing it is the opener's job", () => {
      expect(isSliceCapturedMessage(sliceCaptured({ reachedSeconds: 55 }))).toBe(true);
    });

    it("rejects a slice that does not say how far it reached", () => {
      const { reachedSeconds: _reached, ...withoutReach } = sliceCaptured();
      expect(isSliceCapturedMessage(withoutReach)).toBe(false);

      const { trackDurationSeconds: _duration, ...withoutDuration } = sliceCaptured();
      expect(isSliceCapturedMessage(withoutDuration)).toBe(false);
    });

    it("rejects coverage numbers that are not numbers", () => {
      expect(isSliceCapturedMessage(sliceCaptured({ reachedSeconds: "215" as unknown as number }))).toBe(false);
      expect(isSliceCapturedMessage(sliceCaptured({ trackDurationSeconds: null as unknown as number }))).toBe(false);
    });
  });
});
