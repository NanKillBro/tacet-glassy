import { describe, expect, it } from "vitest";
import { MAX_RETAINED_CAPTURES, videoIdsToRelease } from "@/capture/prefetch-retention";

describe("videoIdsToRelease", () => {
  it("releases nothing while the held captures fit", () => {
    expect(videoIdsToRelease(["a"])).toEqual([]);
    expect(videoIdsToRelease(["a", "b"])).toEqual([]);
  });

  it("releases the oldest once a third capture is held", () => {
    expect(videoIdsToRelease(["a", "b", "c"])).toEqual(["a"]);
  });

  it("releases every capture past the newest two", () => {
    expect(videoIdsToRelease(["a", "b", "c", "d", "e"])).toEqual(["a", "b", "c"]);
  });

  it("keeps the listened track and the one warmed ahead of it", () => {
    expect(MAX_RETAINED_CAPTURES).toBe(2);
    const released = videoIdsToRelease(["previous", "listening", "next"]);
    expect(released).toEqual(["previous"]);
    expect(released).not.toContain("listening");
    expect(released).not.toContain("next");
  });

  describe("edge cases", () => {
    it("releases nothing when nothing is held", () => {
      expect(videoIdsToRelease([])).toEqual([]);
    });

    it("releases everything when nothing may be kept", () => {
      expect(videoIdsToRelease(["a", "b"], 0)).toEqual(["a", "b"]);
    });

    it("treats a negative keep as zero rather than slicing from the end", () => {
      expect(videoIdsToRelease(["a", "b"], -5)).toEqual(["a", "b"]);
    });

    it("honours a custom keep", () => {
      expect(videoIdsToRelease(["a", "b", "c", "d"], 3)).toEqual(["a"]);
    });
  });

  describe("invariants", () => {
    it("never releases the newest entry", () => {
      for (let held = 1; held <= 8; held++) {
        const ids = Array.from({ length: held }, (_, index) => `id-${index}`);
        expect(videoIdsToRelease(ids)).not.toContain(ids[ids.length - 1]);
      }
    });

    it("leaves exactly the keep count behind once it is exceeded", () => {
      for (let held = 3; held <= 8; held++) {
        const ids = Array.from({ length: held }, (_, index) => `id-${index}`);
        expect(ids.length - videoIdsToRelease(ids).length).toBe(MAX_RETAINED_CAPTURES);
      }
    });

    it("does not mutate what it is given", () => {
      const ids = ["a", "b", "c"];
      videoIdsToRelease(ids);
      expect(ids).toEqual(["a", "b", "c"]);
    });
  });
});
