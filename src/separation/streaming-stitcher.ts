import { SEGMENT_SAMPLES, STRIDE_SAMPLES } from "@/separation/chunker";
import type { Chunk } from "@/separation/chunker";

const OVERLAP_SAMPLES = SEGMENT_SAMPLES - STRIDE_SAMPLES;

// -- Fade windows -----------------------------------------------------------------

function makeFadeInWindow(): Float32Array {
  const win = new Float32Array(OVERLAP_SAMPLES);
  for (let i = 0; i < OVERLAP_SAMPLES; i++) {
    win[i] = 0.5 * (1 - Math.cos((Math.PI * i) / OVERLAP_SAMPLES));
  }
  return win;
}

function makeFadeOutWindow(fadeIn: Float32Array): Float32Array {
  const win = new Float32Array(OVERLAP_SAMPLES);
  for (let i = 0; i < OVERLAP_SAMPLES; i++) win[i] = 1 - fadeIn[i];
  return win;
}

// -- StreamingStitcher -----------------------------------------------------------------

interface PendingRegion {
  data: Float32Array[];
  length: number;
}

class StreamingStitcher {
  private readonly totalFrames: number;
  private readonly numChannels: number;
  private readonly fadeIn: Float32Array;
  private readonly fadeOut: Float32Array;
  private pending: PendingRegion | null = null;
  private emittedFrames = 0;
  private nextExpectedStart = 0;

  constructor(totalFrames: number, numChannels: number) {
    this.totalFrames = totalFrames;
    this.numChannels = numChannels;
    this.fadeIn = makeFadeInWindow();
    this.fadeOut = makeFadeOutWindow(this.fadeIn);
  }

  get finalisedFrames(): number {
    return this.emittedFrames;
  }

  push(chunk: Chunk): Float32Array[] | null {
    if (chunk.data.length !== this.numChannels) {
      throw new Error(`StreamingStitcher: expected ${this.numChannels} channels, got ${chunk.data.length}`);
    }
    if (chunk.start !== this.nextExpectedStart) {
      throw new Error(
        `StreamingStitcher: chunks pushed out of order, expected chunk starting at ${this.nextExpectedStart}, got ${chunk.start}`
      );
    }
    this.nextExpectedStart += STRIDE_SAMPLES;

    const chunkLength = chunk.end - chunk.start;

    if (this.pending === null) {
      this.pending = {
        data: chunk.data.map(channel => channel.slice(0, chunkLength)),
        length: chunkLength,
      };
      return null;
    }

    const previous = this.pending;
    const coreLength = previous.length - OVERLAP_SAMPLES;
    const output: Float32Array[] = [];

    for (let c = 0; c < this.numChannels; c++) {
      const merged = new Float32Array(previous.length);
      const prevChannel = previous.data[c];
      const curChannel = chunk.data[c];
      merged.set(prevChannel.subarray(0, coreLength));
      for (let k = 0; k < OVERLAP_SAMPLES; k++) {
        merged[coreLength + k] = prevChannel[coreLength + k] * this.fadeOut[k];
      }
      for (let k = 0; k < OVERLAP_SAMPLES; k++) {
        merged[coreLength + k] += curChannel[k] * this.fadeIn[k];
      }
      output.push(merged);
    }

    this.emittedFrames += previous.length;
    this.pending = {
      data: chunk.data.map(channel => channel.slice(OVERLAP_SAMPLES, chunkLength)),
      length: chunkLength - OVERLAP_SAMPLES,
    };

    return output;
  }

  flush(): Float32Array[] | null {
    if (this.pending === null) return null;
    const output = this.pending.data.map(channel => channel.slice());
    this.emittedFrames += this.pending.length;
    this.pending = null;
    return output;
  }
}

export { StreamingStitcher };
