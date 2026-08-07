import { describe, expect, it } from "vitest";
import { formatDownloadTooltip } from "@/orchestrator/download-tooltip";

describe("formatDownloadTooltip", () => {
  it("shows a rounded percentage mid-download", () => {
    expect(formatDownloadTooltip(0.4699)).toBe(
      "Downloading the track… 47%. This is paced by YouTube's own buffering, so it can be slow."
    );
  });

  describe("edge cases", () => {
    it("shows 0% at the very start", () => {
      expect(formatDownloadTooltip(0)).toBe(
        "Downloading the track… 0%. This is paced by YouTube's own buffering, so it can be slow."
      );
    });

    it("shows 100% once fully buffered", () => {
      expect(formatDownloadTooltip(1)).toBe(
        "Downloading the track… 100%. This is paced by YouTube's own buffering, so it can be slow."
      );
    });

    it("clamps a fraction below 0", () => {
      expect(formatDownloadTooltip(-0.2)).toBe(
        "Downloading the track… 0%. This is paced by YouTube's own buffering, so it can be slow."
      );
    });

    it("clamps a fraction above 1", () => {
      expect(formatDownloadTooltip(1.4)).toBe(
        "Downloading the track… 100%. This is paced by YouTube's own buffering, so it can be slow."
      );
    });

    it("omits the percentage when the duration is unknown (NaN fraction)", () => {
      expect(formatDownloadTooltip(Number.NaN)).toBe(
        "Downloading the track… This is paced by YouTube's own buffering, so it can be slow."
      );
    });

    it("omits the percentage for a non-finite fraction", () => {
      expect(formatDownloadTooltip(Number.POSITIVE_INFINITY)).toBe(
        "Downloading the track… This is paced by YouTube's own buffering, so it can be slow."
      );
    });
  });

  describe("regressions", () => {
    it("always mentions the honest reason, not just a bare percentage", () => {
      expect(formatDownloadTooltip(0.5)).toContain("paced by YouTube's own buffering");
    });
  });
});
