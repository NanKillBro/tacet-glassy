import { describe, expect, it } from "vitest";
import {
  isCaptureReadyMessage,
  isCaptureStandDownMessage,
  isCapturedAudioMessage,
  isCapturedAudioUnavailableMessage,
  isRequestCapturedAudioMessage,
} from "@/capture/bridge-protocol";
import type {
  CaptureReadyMessage,
  CaptureStandDownMessage,
  CapturedAudioMessage,
  CapturedAudioUnavailableMessage,
  RequestCapturedAudioMessage,
} from "@/capture/bridge-protocol";

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
    });
  });
});
