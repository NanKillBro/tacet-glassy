import { decideSeparationStart } from "@/orchestrator/separation-gate";
import { describe, expect, it } from "vitest";

describe("decideSeparationStart", () => {
  it("starts when nothing is running", () => {
    expect(decideSeparationStart(null, "DJCB1ZlseJ8")).toBe("start");
  });

  it("supersedes a run for a track the listener has left", () => {
    expect(decideSeparationStart("DJCB1ZlseJ8", "lYBUbBu4W08")).toBe("supersede");
  });

  describe("regressions", () => {
    // Measured: an ad announced a complete capture, then the track announced
    // its own, both under the same videoId. The second call built a second
    // session and the WebGPU EP failed the whole job.
    it("regression: ignores a second capture for the track already separating", () => {
      expect(decideSeparationStart("DJCB1ZlseJ8", "DJCB1ZlseJ8")).toBe("ignore");
    });
  });

  describe("invariants", () => {
    it("never starts a concurrent run while one is in flight", () => {
      const requests = ["DJCB1ZlseJ8", "lYBUbBu4W08", ""];
      for (const running of requests) {
        for (const requested of requests) {
          expect(decideSeparationStart(running, requested)).not.toBe("start");
        }
      }
    });

    it("is the only decision that starts from an idle pipeline", () => {
      expect(decideSeparationStart(null, "")).toBe("start");
    });
  });
});
