import { decidePrefetch } from "@/capture/prefetch-gate";
import { describe, expect, it } from "vitest";

describe("decidePrefetch", () => {
  it("starts when nothing is in flight", () => {
    expect(decidePrefetch(null, "abc123")).toBe("start");
  });

  it("reuses the capture already running for this track", () => {
    expect(decidePrefetch("abc123", "abc123")).toBe("reuse");
  });

  describe("regressions", () => {
    // The in-flight promise carried no identity, so skipping mid-capture handed
    // the previous track's audio to the new one, which separated it and cached
    // the result under the new track's key. The listener heard the previous
    // song's instrumental over the current song.
    it("refuses a different track rather than handing over the running capture", () => {
      expect(decidePrefetch("previous", "current")).toBe("refuse");
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
        expect(decidePrefetch(inFlight, requested)).not.toBe("reuse");
      }
    });

    it("is decided entirely by the two ids", () => {
      expect(decidePrefetch("a", "a")).toBe(decidePrefetch("a", "a"));
      expect(decidePrefetch(null, "a")).toBe(decidePrefetch(null, "zzz"));
    });
  });
});
