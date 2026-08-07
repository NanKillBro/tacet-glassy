import { STRIDE_SAMPLES } from "@/separation/chunker";

// StreamingStitcher tracks no external offset: it always starts a fresh run
// at frame 0. Resuming a partial separation therefore means re-running
// inference starting at the chunk that was still "pending" (not yet emitted)
// when the previous run stopped, then feeding it into a fresh stitcher as if
// it were chunk 0. This computes which chunk that is from a cached
// framesDone, and the frame count that is safely already committed.

interface ResumePoint {
  resumeChunkIndex: number;
  committedFrames: number;
}

function computeResumeChunkIndex(framesDone: number): ResumePoint {
  if (!Number.isFinite(framesDone) || framesDone < 0) {
    throw new Error(`resume: framesDone must be a non-negative finite number, got ${framesDone}`);
  }

  const resumeChunkIndex = Math.floor(framesDone / STRIDE_SAMPLES);
  return { resumeChunkIndex, committedFrames: resumeChunkIndex * STRIDE_SAMPLES };
}

export { computeResumeChunkIndex };
export type { ResumePoint };
