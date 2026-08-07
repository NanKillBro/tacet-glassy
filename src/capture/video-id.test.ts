import { getVideoIdFromSearch } from "@/capture/video-id";
import { describe, expect, it } from "vitest";

describe("getVideoIdFromSearch", () => {
  it("reads the v param off a watch URL's search string", () => {
    expect(getVideoIdFromSearch("?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("reads the v param when other params surround it", () => {
    expect(getVideoIdFromSearch("?list=RD123&v=dQw4w9WgXcQ&index=3")).toBe("dQw4w9WgXcQ");
  });

  describe("edge cases", () => {
    it("returns null when there is no search string at all", () => {
      expect(getVideoIdFromSearch("")).toBeNull();
    });

    it("returns null when v is absent from an otherwise populated query", () => {
      expect(getVideoIdFromSearch("?list=RD123&index=3")).toBeNull();
    });

    it("returns an empty string when v is present but has no value", () => {
      expect(getVideoIdFromSearch("?v=")).toBe("");
    });

    it("works without a leading question mark", () => {
      expect(getVideoIdFromSearch("v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });
  });

  describe("invariants", () => {
    it("is a pure function: identical input produces identical output", () => {
      expect(getVideoIdFromSearch("?v=abc")).toBe(getVideoIdFromSearch("?v=abc"));
    });
  });
});
