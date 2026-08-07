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

// mulberry32, a small deterministic PRNG. Seeded so the noise fixtures below
// are identical across runs, unlike a ramp, which repeats the same value at
// the same relative offset in every chunk and can mask boundary errors.
function makeSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(length: number, seed: number): Float32Array {
  const rand = makeSeededRandom(seed);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = rand() * 2 - 1;
  return out;
}

const BOUNDARY_LENGTHS: number[] = [
  0,
  1,
  STRIDE_SAMPLES - 1,
  STRIDE_SAMPLES,
  STRIDE_SAMPLES + 1,
  SEGMENT_SAMPLES - 1,
  SEGMENT_SAMPLES,
  SEGMENT_SAMPLES + 1,
  SEGMENT_SAMPLES + STRIDE_SAMPLES - 1,
  SEGMENT_SAMPLES + STRIDE_SAMPLES,
  SEGMENT_SAMPLES + STRIDE_SAMPLES + 1,
  SEGMENT_SAMPLES + 2 * STRIDE_SAMPLES - 1,
  SEGMENT_SAMPLES + 2 * STRIDE_SAMPLES,
  SEGMENT_SAMPLES + 2 * STRIDE_SAMPLES + 1,
];

function makeRandomLengths(count: number, max: number, seed: number): number[] {
  const rand = makeSeededRandom(seed);
  const lengths: number[] = [];
  for (let i = 0; i < count; i++) lengths.push(Math.floor(rand() * max));
  return lengths;
}

const SWEEP_LENGTHS: number[] = [...BOUNDARY_LENGTHS, ...makeRandomLengths(50, SEGMENT_SAMPLES * 3, 0xc0ffee)];

// -- Tests -----------------------------------------------------------------

describe("StreamingStitcher", () => {
  describe("bit-identical to batch stitchChunks", () => {
    it.each(SWEEP_LENGTHS)("totalFrames=%i", totalFrames => {
      const channels = [makeNoise(totalFrames, totalFrames * 2 + 1), makeNoise(totalFrames, totalFrames * 2 + 2)];
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
  });

  describe("totalFrames contract", () => {
    it("never emits more than totalFrames when totalFrames undershoots the chunk data", () => {
      const trueLength = SEGMENT_SAMPLES + STRIDE_SAMPLES * 3;
      const totalFrames = trueLength - 500;
      const channels = [makeRamp(trueLength, 0), makeRamp(trueLength, 1)];
      const chunks = Array.from(iterateChunks(channels));

      const stitcher = new StreamingStitcher(totalFrames, channels.length);
      for (const chunk of chunks) {
        stitcher.push(chunk);
        expect(stitcher.finalisedFrames).toBeLessThanOrEqual(totalFrames);
      }
      stitcher.flush();

      expect(stitcher.finalisedFrames).toBe(totalFrames);
    });

    it("throws once a chunk sequence would exceed totalFrames", () => {
      const totalFrames = STRIDE_SAMPLES;
      const channels = [makeRamp(SEGMENT_SAMPLES + STRIDE_SAMPLES * 2, 0)];
      const chunks = Array.from(iterateChunks(channels));
      expect(chunks.length).toBeGreaterThan(2);

      const stitcher = new StreamingStitcher(totalFrames, channels.length);
      stitcher.push(chunks[0]);
      stitcher.push(chunks[1]);
      expect(stitcher.finalisedFrames).toBe(totalFrames);

      expect(() => stitcher.push(chunks[2])).toThrow(/totalFrames/i);
    });

    it("flush pads to totalFrames with silence when no chunks arrive, matching stitchChunks([], totalFrames, numChannels)", () => {
      const totalFrames = 1000;
      const numChannels = 2;
      const batch = stitchChunks([], totalFrames, numChannels);

      const stitcher = new StreamingStitcher(totalFrames, numChannels);
      const result = stitcher.flush();
      if (result === null) throw new Error("expected flush to emit silence");

      expect(result.length).toBe(numChannels);
      for (let c = 0; c < numChannels; c++) {
        expect(Array.from(result[c])).toEqual(Array.from(batch[c]));
      }
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

    it("throws when a chunk's channel is shorter than the chunk length, naming the channel index", () => {
      const stitcher = new StreamingStitcher(1000, 2);
      const shortChunk = { start: 0, end: 500, data: [new Float32Array(500), new Float32Array(400)] };

      expect(() => stitcher.push(shortChunk)).toThrow(/channel 1/);
    });

    it("throws on a short channel in the merge branch instead of storing NaN", () => {
      const totalFrames = SEGMENT_SAMPLES + STRIDE_SAMPLES * 2;
      const channels = [makeRamp(totalFrames, 0)];
      const chunks = Array.from(iterateChunks(channels));
      expect(chunks.length).toBeGreaterThan(1);

      const stitcher = new StreamingStitcher(totalFrames, 1);
      stitcher.push(chunks[0]);

      const chunkLength = chunks[1].end - chunks[1].start;
      const shortChunk = { start: chunks[1].start, end: chunks[1].end, data: [new Float32Array(chunkLength - 1)] };

      expect(() => stitcher.push(shortChunk)).toThrow(/channel 0/);
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
