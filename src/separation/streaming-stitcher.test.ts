import { describe, expect, it } from "vitest";
import { iterateChunks, SEGMENT_SAMPLES, STRIDE_SAMPLES, stitchChunks } from "@/separation/chunker";
import { StreamingStitcher } from "@/separation/streaming-stitcher";

// -- Test helpers -----------------------------------------------------------------

function makeRamp(length: number, channelOffset = 0): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = (i + channelOffset * 0.5) / (length || 1);
  return out;
}

function collectStreamed(channels: Float32Array[], totalFrames: number): Float32Array[] {
  const numChannels = channels.length;
  const stitcher = new StreamingStitcher(totalFrames, numChannels);
  const regions: Float32Array[][] = [];

  for (const chunk of iterateChunks(channels)) {
    const region = stitcher.push(chunk);
    if (region) regions.push(region);
  }
  const tail = stitcher.flush();
  if (tail) regions.push(tail);

  const output: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    const totalLength = regions.reduce((sum, region) => sum + region[c].length, 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const region of regions) {
      merged.set(region[c], offset);
      offset += region[c].length;
    }
    output.push(merged);
  }
  return output;
}

const TRACK_LENGTHS: [string, number][] = [
  ["shorter than one segment", Math.floor(SEGMENT_SAMPLES / 2)],
  ["exactly one stride", STRIDE_SAMPLES],
  ["partial final chunk", SEGMENT_SAMPLES + STRIDE_SAMPLES + 12345],
  ["several full chunks", SEGMENT_SAMPLES + STRIDE_SAMPLES * 4],
  ["empty input", 0],
];

// -- Tests -----------------------------------------------------------------

describe("StreamingStitcher", () => {
  describe("bit-identical to batch stitchChunks", () => {
    it.each(TRACK_LENGTHS)("%s (totalFrames=%i)", (_label, totalFrames) => {
      const channels = [makeRamp(totalFrames, 0), makeRamp(totalFrames, 1)];
      const chunks = Array.from(iterateChunks(channels));
      const batch = stitchChunks(chunks, totalFrames, channels.length);
      const streamed = collectStreamed(channels, totalFrames);

      expect(streamed.length).toBe(batch.length);
      for (let c = 0; c < channels.length; c++) {
        expect(Array.from(streamed[c])).toEqual(Array.from(batch[c]));
      }
    });
  });

  describe("invariants", () => {
    it("emits nothing before the second chunk arrives", () => {
      const totalFrames = SEGMENT_SAMPLES + STRIDE_SAMPLES * 2;
      const channels = [makeRamp(totalFrames, 0), makeRamp(totalFrames, 1)];
      const chunks = Array.from(iterateChunks(channels));
      expect(chunks.length).toBeGreaterThan(1);

      const stitcher = new StreamingStitcher(totalFrames, channels.length);
      const result = stitcher.push(chunks[0]);

      expect(result).toBeNull();
      expect(stitcher.finalisedFrames).toBe(0);
    });

    it("emits contiguous, non-overlapping regions with no gaps", () => {
      const totalFrames = SEGMENT_SAMPLES + STRIDE_SAMPLES * 4;
      const channels = [makeRamp(totalFrames, 0), makeRamp(totalFrames, 1)];
      const chunks = Array.from(iterateChunks(channels));

      const stitcher = new StreamingStitcher(totalFrames, channels.length);
      let runningTotal = 0;

      for (const chunk of chunks) {
        const result = stitcher.push(chunk);
        if (result) {
          const [first, ...rest] = result;
          for (const channel of rest) expect(channel.length).toBe(first.length);
          runningTotal += first.length;
        }
        expect(stitcher.finalisedFrames).toBe(runningTotal);
      }

      const tail = stitcher.flush();
      if (tail) runningTotal += tail[0].length;

      expect(stitcher.finalisedFrames).toBe(runningTotal);
      expect(runningTotal).toBe(totalFrames);
    });

    it("keeps finalisedFrames monotonically non-decreasing", () => {
      const totalFrames = SEGMENT_SAMPLES + STRIDE_SAMPLES * 3 + 999;
      const channels = [makeRamp(totalFrames, 0)];
      const chunks = Array.from(iterateChunks(channels));

      const stitcher = new StreamingStitcher(totalFrames, channels.length);
      let previous = stitcher.finalisedFrames;

      for (const chunk of chunks) {
        stitcher.push(chunk);
        expect(stitcher.finalisedFrames).toBeGreaterThanOrEqual(previous);
        previous = stitcher.finalisedFrames;
      }
      stitcher.flush();
      expect(stitcher.finalisedFrames).toBeGreaterThanOrEqual(previous);
    });

    it("emits exactly totalFrames frames in total after flush", () => {
      const totalFrames = SEGMENT_SAMPLES + STRIDE_SAMPLES + 12345;
      const channels = [makeRamp(totalFrames, 0), makeRamp(totalFrames, 1)];
      const chunks = Array.from(iterateChunks(channels));

      const stitcher = new StreamingStitcher(totalFrames, channels.length);
      for (const chunk of chunks) stitcher.push(chunk);
      stitcher.flush();

      expect(stitcher.finalisedFrames).toBe(totalFrames);
    });
  });

  describe("edge cases", () => {
    it("flush() with no chunks pushed returns null", () => {
      const stitcher = new StreamingStitcher(0, 2);
      expect(stitcher.flush()).toBeNull();
      expect(stitcher.finalisedFrames).toBe(0);
    });

    it("flush() called twice returns null the second time", () => {
      const totalFrames = Math.floor(SEGMENT_SAMPLES / 2);
      const channels = [makeRamp(totalFrames, 0)];
      const chunks = Array.from(iterateChunks(channels));

      const stitcher = new StreamingStitcher(totalFrames, channels.length);
      for (const chunk of chunks) stitcher.push(chunk);

      const first = stitcher.flush();
      const second = stitcher.flush();

      expect(first).not.toBeNull();
      expect(second).toBeNull();
      expect(stitcher.finalisedFrames).toBe(totalFrames);
    });

    it("handles mono (1 channel) input bit-identically to batch", () => {
      const totalFrames = SEGMENT_SAMPLES + STRIDE_SAMPLES * 2;
      const channels = [makeRamp(totalFrames, 0)];
      const chunks = Array.from(iterateChunks(channels));
      const batch = stitchChunks(chunks, totalFrames, channels.length);
      const streamed = collectStreamed(channels, totalFrames);

      expect(streamed.length).toBe(1);
      expect(Array.from(streamed[0])).toEqual(Array.from(batch[0]));
    });

    it("handles stereo (2 channel) input bit-identically to batch", () => {
      const totalFrames = SEGMENT_SAMPLES + STRIDE_SAMPLES * 2;
      const channels = [makeRamp(totalFrames, 0), makeRamp(totalFrames, 1)];
      const chunks = Array.from(iterateChunks(channels));
      const batch = stitchChunks(chunks, totalFrames, channels.length);
      const streamed = collectStreamed(channels, totalFrames);

      expect(streamed.length).toBe(2);
      for (let c = 0; c < channels.length; c++) {
        expect(Array.from(streamed[c])).toEqual(Array.from(batch[c]));
      }
    });
  });

  describe("error paths", () => {
    it("throws when a pushed chunk's channel count disagrees with the constructor", () => {
      const totalFrames = Math.floor(SEGMENT_SAMPLES / 2);
      const channels = [makeRamp(totalFrames, 0)];
      const chunks = Array.from(iterateChunks(channels));

      const stitcher = new StreamingStitcher(totalFrames, 2);
      expect(() => stitcher.push(chunks[0])).toThrow(/channel/i);
    });

    it("throws when chunks are pushed out of order", () => {
      const totalFrames = SEGMENT_SAMPLES + STRIDE_SAMPLES * 2;
      const channels = [makeRamp(totalFrames, 0)];
      const chunks = Array.from(iterateChunks(channels));
      expect(chunks.length).toBeGreaterThan(2);

      const stitcher = new StreamingStitcher(totalFrames, channels.length);
      stitcher.push(chunks[0]);
      expect(() => stitcher.push(chunks[2])).toThrow(/order/i);
    });
  });
});
