import { decidePrefetch } from "@/capture/prefetch-gate";
import type { PrefetchRequest } from "@/capture/prefetch-gate";
import { describe, expect, it } from "vitest";

function request(overrides: Partial<PrefetchRequest> = {}): PrefetchRequest {
  return {
    inFlightVideoId: null,
    inFlightIsAhead: false,
    requestedVideoId: "current",
    requestedIsAhead: false,
    ...overrides,
  };
}

describe("decidePrefetch", () => {
  it("starts when nothing is in flight", () => {
    expect(decidePrefetch(request())).toBe("start");
  });

  it("reuses the capture already running for this track", () => {
    expect(decidePrefetch(request({ inFlightVideoId: "current" }))).toBe("reuse");
  });

  it("reuses a warm-ahead the listener has since arrived at", () => {
    expect(decidePrefetch(request({ inFlightVideoId: "current", inFlightIsAhead: true }))).toBe("reuse");
  });

  describe("regressions", () => {
    it("regression: does not hand a running capture to a different track", () => {
      expect(decidePrefetch(request({ inFlightVideoId: "previous" }))).not.toBe("reuse");
    });

    it("regression: takes the slot for the track the listener skipped to", () => {
      expect(decidePrefetch(request({ inFlightVideoId: "previous" }))).toBe("supersede");
    });

    it("regression: drops a stale warm-ahead for the track being played now", () => {
      expect(decidePrefetch(request({ inFlightVideoId: "next", inFlightIsAhead: true }))).toBe("supersede");
    });
  });

  describe("warming ahead", () => {
    it("yields to a capture serving the track being listened to", () => {
      const decision = decidePrefetch(
        request({ inFlightVideoId: "current", requestedVideoId: "next", requestedIsAhead: true })
      );
      expect(decision).toBe("refuse");
    });

    it("replaces an earlier warm-ahead for a track no longer next", () => {
      const decision = decidePrefetch(
        request({
          inFlightVideoId: "stale-next",
          inFlightIsAhead: true,
          requestedVideoId: "next",
          requestedIsAhead: true,
        })
      );
      expect(decision).toBe("supersede");
    });
  });

  describe("invariants", () => {
    it("never reuses across differing ids", () => {
      for (const [inFlight, requested] of [
        ["a", "b"],
        ["b", "a"],
        ["", "a"],
        ["a", ""],
      ]) {
        for (const inFlightIsAhead of [true, false]) {
          for (const requestedIsAhead of [true, false]) {
            const decision = decidePrefetch(
              request({ inFlightVideoId: inFlight, inFlightIsAhead, requestedVideoId: requested, requestedIsAhead })
            );
            expect(decision).not.toBe("reuse");
          }
        }
      }
    });

    it("never leaves the listener's own track waiting on another capture", () => {
      for (const inFlightIsAhead of [true, false]) {
        expect(decidePrefetch(request({ inFlightVideoId: "previous", inFlightIsAhead }))).not.toBe("refuse");
      }
    });

    it("only ever refuses a warm-ahead", () => {
      for (const inFlightIsAhead of [true, false]) {
        for (const requestedIsAhead of [true, false]) {
          const decision = decidePrefetch(request({ inFlightVideoId: "other", inFlightIsAhead, requestedIsAhead }));
          if (decision === "refuse") expect(requestedIsAhead).toBe(true);
        }
      }
    });
  });
});
