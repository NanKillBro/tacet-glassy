import { isAudioMimeType } from "@/capture/mime-filter";
import { describe, expect, it } from "vitest";

describe("isAudioMimeType", () => {
  it("accepts a plain audio mime type", () => {
    expect(isAudioMimeType("audio/mp4")).toBe(true);
  });

  it("accepts an audio mime type with a codecs parameter", () => {
    expect(isAudioMimeType('audio/mp4; codecs="mp4a.40.2"')).toBe(true);
  });

  it("rejects a video mime type", () => {
    expect(isAudioMimeType("video/mp4")).toBe(false);
  });

  it("rejects a video mime type with a codecs parameter", () => {
    expect(isAudioMimeType('video/mp4; codecs="avc1.64001f"')).toBe(false);
  });

  describe("edge cases", () => {
    it("rejects an empty string", () => {
      expect(isAudioMimeType("")).toBe(false);
    });

    it("is case-sensitive: a capitalized prefix does not match", () => {
      expect(isAudioMimeType("Audio/mp4")).toBe(false);
      expect(isAudioMimeType("AUDIO/mp4")).toBe(false);
    });

    it("rejects a mime type that merely contains audio without the prefix", () => {
      expect(isAudioMimeType("x-audio/mp4")).toBe(false);
    });

    it("rejects a bare 'audio' with no slash", () => {
      expect(isAudioMimeType("audio")).toBe(false);
    });

    it("accepts 'audio/' with nothing after the slash", () => {
      expect(isAudioMimeType("audio/")).toBe(true);
    });
  });

  describe("invariants", () => {
    it("is a pure function: identical input produces identical output", () => {
      expect(isAudioMimeType("audio/webm")).toBe(isAudioMimeType("audio/webm"));
    });
  });
});
