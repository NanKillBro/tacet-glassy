import { createCaptureAccumulator } from "@/capture/accumulator";
import { describe, expect, it } from "vitest";

function bytes(length: number, fill = 1): Uint8Array {
  return new Uint8Array(length).fill(fill);
}

function ftypBytes(length = 8): Uint8Array {
  const buffer = new Uint8Array(length);
  buffer.set([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70]);
  return buffer;
}

function moofBytes(length = 8): Uint8Array {
  const buffer = new Uint8Array(length);
  buffer.set([0, 0, 0, 0, 0x6d, 0x6f, 0x6f, 0x66]);
  return buffer;
}

describe("createCaptureAccumulator", () => {
  it("accumulates chunks and reports running totals", () => {
    const accumulator = createCaptureAccumulator(1024);
    accumulator.addChunk("audio/mp4", ftypBytes(20));
    accumulator.addChunk("audio/mp4", moofBytes(30));

    const stats = accumulator.getStats();
    expect(stats.appendCount).toBe(2);
    expect(stats.totalBytes).toBe(50);
    expect(stats.mimeTypes).toEqual(["audio/mp4"]);
    expect(stats.retainedChunkCount).toBe(2);
    expect(stats.hitCap).toBe(false);
  });

  it("tags the leading ftyp chunk as an init segment and later moof chunks as media", () => {
    const accumulator = createCaptureAccumulator(1024);
    accumulator.addChunk("audio/mp4", ftypBytes());
    accumulator.addChunk("audio/mp4", moofBytes());

    const chunks = accumulator.getChunks();
    expect(chunks[0].isInitSegment).toBe(true);
    expect(chunks[1].isInitSegment).toBe(false);
  });

  it("collects every distinct mime type seen", () => {
    const accumulator = createCaptureAccumulator(1024);
    accumulator.addChunk("audio/mp4", bytes(4));
    accumulator.addChunk("audio/webm", bytes(4));
    accumulator.addChunk("audio/mp4", bytes(4));

    expect(accumulator.getStats().mimeTypes.sort()).toEqual(["audio/mp4", "audio/webm"]);
  });

  describe("video id keyed reset", () => {
    it("returns true and clears prior state the first time a video id is set", () => {
      const accumulator = createCaptureAccumulator(1024);
      expect(accumulator.setActiveVideoId("song-a")).toBe(true);
      expect(accumulator.getStats().videoId).toBe("song-a");
    });

    it("returns false and keeps state when the same video id is set again", () => {
      const accumulator = createCaptureAccumulator(1024);
      accumulator.setActiveVideoId("song-a");
      accumulator.addChunk("audio/mp4", bytes(4));

      expect(accumulator.setActiveVideoId("song-a")).toBe(false);
      expect(accumulator.getStats().appendCount).toBe(1);
    });

    it("a track change resets counts, chunks, and the cap flag", () => {
      const accumulator = createCaptureAccumulator(10);
      accumulator.setActiveVideoId("song-a");
      accumulator.addChunk("audio/mp4", bytes(20));
      expect(accumulator.getStats().hitCap).toBe(true);

      const reset = accumulator.setActiveVideoId("song-b");

      expect(reset).toBe(true);
      const stats = accumulator.getStats();
      expect(stats.videoId).toBe("song-b");
      expect(stats.appendCount).toBe(0);
      expect(stats.totalBytes).toBe(0);
      expect(stats.mimeTypes).toEqual([]);
      expect(stats.hitCap).toBe(false);
      expect(accumulator.getChunks()).toEqual([]);
    });
  });

  describe("memory cap", () => {
    it("retains chunks up to and including the exact cap boundary", () => {
      const accumulator = createCaptureAccumulator(10);
      const result = accumulator.addChunk("audio/mp4", bytes(10));

      expect(result).toBe("added");
      expect(accumulator.getStats().hitCap).toBe(false);
      expect(accumulator.getChunks()).toHaveLength(1);
    });

    it("drops a chunk that would push retained bytes past the cap", () => {
      const accumulator = createCaptureAccumulator(10);
      const result = accumulator.addChunk("audio/mp4", bytes(11));

      expect(result).toBe("cap-hit");
      expect(accumulator.getChunks()).toHaveLength(0);
    });

    it("still counts appendCount and totalBytes for chunks dropped by the cap", () => {
      const accumulator = createCaptureAccumulator(10);
      accumulator.addChunk("audio/mp4", bytes(11));

      const stats = accumulator.getStats();
      expect(stats.appendCount).toBe(1);
      expect(stats.totalBytes).toBe(11);
      expect(stats.retainedChunkCount).toBe(0);
    });

    it("reports cap-already-hit on subsequent calls instead of re-triggering cap-hit", () => {
      const accumulator = createCaptureAccumulator(10);
      accumulator.addChunk("audio/mp4", bytes(11));
      const second = accumulator.addChunk("audio/mp4", bytes(1));

      expect(second).toBe("cap-already-hit");
      expect(accumulator.getStats().totalBytes).toBe(12);
    });

    it("does not retain any further chunks once the cap has been hit", () => {
      const accumulator = createCaptureAccumulator(10);
      accumulator.addChunk("audio/mp4", bytes(5));
      accumulator.addChunk("audio/mp4", bytes(5));
      accumulator.addChunk("audio/mp4", bytes(5));

      expect(accumulator.getChunks()).toHaveLength(2);
      expect(accumulator.getStats().hitCap).toBe(true);
    });
  });

  describe("standing down", () => {
    it("drops what it was holding", () => {
      const accumulator = createCaptureAccumulator(1024);
      accumulator.setActiveVideoId("song-a");
      accumulator.addChunk("audio/mp4", ftypBytes());
      accumulator.addChunk("audio/mp4", moofBytes());

      accumulator.standDown();

      expect(accumulator.getChunks()).toHaveLength(0);
      expect(accumulator.getStats().stoodDown).toBe(true);
    });

    it("retains nothing further for the same track", () => {
      const accumulator = createCaptureAccumulator(1024);
      accumulator.setActiveVideoId("song-a");
      accumulator.standDown();

      expect(accumulator.addChunk("audio/mp4", moofBytes())).toBe("stood-down");
      expect(accumulator.getChunks()).toHaveLength(0);
    });

    // The stream stays observable even when none of it is kept, so a stood-down
    // track can still be told apart from one the player never fetched at all.
    it("keeps counting the stream it is no longer keeping", () => {
      const accumulator = createCaptureAccumulator(1024);
      accumulator.setActiveVideoId("song-a");
      accumulator.standDown();
      accumulator.addChunk("audio/mp4", bytes(12));

      const stats = accumulator.getStats();
      expect(stats.appendCount).toBe(1);
      expect(stats.totalBytes).toBe(12);
      expect(stats.retainedChunkCount).toBe(0);
    });

    it("re-arms on a track change", () => {
      const accumulator = createCaptureAccumulator(1024);
      accumulator.setActiveVideoId("song-a");
      accumulator.standDown();
      accumulator.setActiveVideoId("song-b");

      expect(accumulator.getStats().stoodDown).toBe(false);
      expect(accumulator.addChunk("audio/mp4", moofBytes())).toBe("added");
    });

    it("is idempotent", () => {
      const accumulator = createCaptureAccumulator(1024);
      accumulator.setActiveVideoId("song-a");
      accumulator.addChunk("audio/mp4", moofBytes());
      accumulator.standDown();
      accumulator.standDown();

      expect(accumulator.getStats().stoodDown).toBe(true);
      expect(accumulator.getChunks()).toHaveLength(0);
    });
  });

  describe("discarding what was retained", () => {
    // A preroll's bytes reach the accumulator under the track's own videoId, so
    // nothing upstream resets it. Discarding is how a worker throws the ad away
    // and starts over once it notices the media changed length.
    it("drops what it was holding but keeps retaining", () => {
      const accumulator = createCaptureAccumulator(1024);
      accumulator.setActiveVideoId("song-a");
      accumulator.addChunk("audio/mp4", ftypBytes());
      accumulator.discardRetained();

      expect(accumulator.getChunks()).toHaveLength(0);
      expect(accumulator.addChunk("audio/mp4", moofBytes())).toBe("added");
      expect(accumulator.getChunks()).toHaveLength(1);
    });

    it("does not stand the capture down", () => {
      const accumulator = createCaptureAccumulator(1024);
      accumulator.setActiveVideoId("song-a");
      accumulator.discardRetained();

      expect(accumulator.getStats().stoodDown).toBe(false);
    });

    it("clears a hit cap, so the restarted capture has its full budget", () => {
      const accumulator = createCaptureAccumulator(10);
      accumulator.setActiveVideoId("song-a");
      accumulator.addChunk("audio/mp4", bytes(11));
      expect(accumulator.getStats().hitCap).toBe(true);

      accumulator.discardRetained();

      expect(accumulator.getStats().hitCap).toBe(false);
      expect(accumulator.addChunk("audio/mp4", bytes(5))).toBe("added");
    });

    it("leaves the running totals alone, since those describe the stream", () => {
      const accumulator = createCaptureAccumulator(1024);
      accumulator.setActiveVideoId("song-a");
      accumulator.addChunk("audio/mp4", bytes(12));
      accumulator.discardRetained();

      const stats = accumulator.getStats();
      expect(stats.appendCount).toBe(1);
      expect(stats.totalBytes).toBe(12);
      expect(stats.retainedChunkCount).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("addChunk works before any video id has been set", () => {
      const accumulator = createCaptureAccumulator(1024);
      accumulator.addChunk("audio/mp4", bytes(4));

      expect(accumulator.getStats().videoId).toBeNull();
      expect(accumulator.getStats().appendCount).toBe(1);
    });

    it("getStats on a fresh accumulator reports all-zero, non-null-array state", () => {
      const accumulator = createCaptureAccumulator(1024);
      const stats = accumulator.getStats();

      expect(stats).toEqual({
        videoId: null,
        appendCount: 0,
        totalBytes: 0,
        mimeTypes: [],
        retainedChunkCount: 0,
        initSegmentCount: 0,
        hitCap: false,
        stoodDown: false,
      });
    });

    it("handles a zero-length chunk without throwing", () => {
      const accumulator = createCaptureAccumulator(1024);
      expect(() => accumulator.addChunk("audio/mp4", bytes(0))).not.toThrow();
      expect(accumulator.getStats().appendCount).toBe(1);
    });
  });

  describe("invariants", () => {
    it("getChunks returns a snapshot, not a live view into internal state", () => {
      const accumulator = createCaptureAccumulator(1024);
      accumulator.addChunk("audio/mp4", ftypBytes());

      const first = accumulator.getChunks();
      accumulator.addChunk("audio/mp4", moofBytes());
      const second = accumulator.getChunks();

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(2);
    });

    it("initSegmentCount in stats matches the number of tagged chunks in getChunks", () => {
      const accumulator = createCaptureAccumulator(1024);
      accumulator.addChunk("audio/mp4", ftypBytes());
      accumulator.addChunk("audio/mp4", moofBytes());
      accumulator.addChunk("audio/mp4", ftypBytes());

      const chunks = accumulator.getChunks();
      const taggedCount = chunks.filter(chunk => chunk.isInitSegment).length;
      expect(accumulator.getStats().initSegmentCount).toBe(taggedCount);
      expect(taggedCount).toBe(2);
    });
  });
});
