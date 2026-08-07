import {
  isAudioBridgeMessage,
  isLoadStemsMessage,
  isSetMixLevelMessage,
  isStopStemsMessage,
} from "@/pageworld/protocol";
import type { LoadStemsMessage, SetMixLevelMessage, StopStemsMessage } from "@/pageworld/protocol";
import { describe, expect, it } from "vitest";

describe("audio bridge protocol", () => {
  it("round-trips blk-set-mix-level through structured clone", () => {
    const message: SetMixLevelMessage = { type: "blk-set-mix-level", mixLevel: 1.5 };
    const cloned = structuredClone(message);
    expect(isSetMixLevelMessage(cloned)).toBe(true);
    expect(isAudioBridgeMessage(cloned)).toBe(true);
  });

  it("round-trips blk-load-stems with its buffers transferred, not copied", () => {
    const vocals = [new Float32Array([1, 2, 3]), new Float32Array([4, 5, 6])];
    const instrumental = [new Float32Array([7, 8, 9]), new Float32Array([10, 11, 12])];
    const message: LoadStemsMessage = {
      type: "blk-load-stems",
      videoId: "abc123",
      vocals,
      instrumental,
      sampleRate: 48000,
    };
    const transferList = [...vocals, ...instrumental].map(channel => channel.buffer);

    const cloned = structuredClone(message, { transfer: transferList });

    expect(isLoadStemsMessage(cloned)).toBe(true);
    if (!isLoadStemsMessage(cloned)) throw new Error("unreachable");
    expect(cloned.videoId).toBe("abc123");
    expect(Array.from(cloned.vocals[0])).toEqual([1, 2, 3]);
    expect(Array.from(cloned.instrumental[1])).toEqual([10, 11, 12]);
    expect(cloned.sampleRate).toBe(48000);

    // Transfer, not structured-clone-by-copy: the sender's buffers are
    // detached once ownership moves to the receiving world.
    expect(vocals[0].buffer.byteLength).toBe(0);
    expect(instrumental[1].buffer.byteLength).toBe(0);
  });

  it("round-trips blk-stop-stems", () => {
    const message: StopStemsMessage = { type: "blk-stop-stems" };
    expect(isStopStemsMessage(structuredClone(message))).toBe(true);
  });

  describe("edge cases", () => {
    it("rejects null, primitives, and plain unrelated objects", () => {
      expect(isAudioBridgeMessage(null)).toBe(false);
      expect(isAudioBridgeMessage(undefined)).toBe(false);
      expect(isAudioBridgeMessage("blk-set-mix-level")).toBe(false);
      expect(isAudioBridgeMessage({ foo: "bar" })).toBe(false);
    });

    it("rejects a set-mix-level message with a non-numeric mixLevel", () => {
      expect(isSetMixLevelMessage({ type: "blk-set-mix-level", mixLevel: "1" })).toBe(false);
    });

    it("rejects a load-stems message whose channel arrays are not Float32Array", () => {
      const malformed = {
        type: "blk-load-stems",
        videoId: "abc123",
        vocals: [[1, 2, 3]],
        instrumental: [],
        sampleRate: 48000,
      };
      expect(isLoadStemsMessage(malformed)).toBe(false);
    });

    it("rejects a load-stems message missing sampleRate", () => {
      const malformed = {
        type: "blk-load-stems",
        videoId: "abc123",
        vocals: [new Float32Array()],
        instrumental: [new Float32Array()],
      };
      expect(isLoadStemsMessage(malformed)).toBe(false);
    });

    // Without it the page world cannot tell which track these stems belong to,
    // and binding them to the wrong element is a permanent mistake.
    it("rejects a load-stems message missing videoId", () => {
      const malformed = { type: "blk-load-stems", vocals: [], instrumental: [], sampleRate: 48000 };
      expect(isLoadStemsMessage(malformed)).toBe(false);
    });

    it("an empty channel list is still a valid (if silent) load-stems message", () => {
      const message = { type: "blk-load-stems", videoId: "abc123", vocals: [], instrumental: [], sampleRate: 48000 };
      expect(isLoadStemsMessage(message)).toBe(true);
    });

    it("does not cross-match another message's discriminant", () => {
      const stopMessage: StopStemsMessage = { type: "blk-stop-stems" };
      expect(isSetMixLevelMessage(stopMessage)).toBe(false);
      expect(isLoadStemsMessage(stopMessage)).toBe(false);
    });
  });
});
