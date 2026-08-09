import { STRIDE_SAMPLES } from "@/separation/chunker";

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
