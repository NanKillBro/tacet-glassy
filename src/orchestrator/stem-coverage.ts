// -- Stem coverage -----------------------------------------------------------

const STEM_COVERAGE_TOLERANCE_S = 3;

type StemFit = "fits" | "short" | "unknown";

function judgeStemCoverage(stemDurationSeconds: number, trackDurationSeconds: number): StemFit {
  if (!Number.isFinite(trackDurationSeconds) || trackDurationSeconds <= 0) return "unknown";
  if (!Number.isFinite(stemDurationSeconds) || stemDurationSeconds <= 0) return "short";
  return stemDurationSeconds >= trackDurationSeconds - STEM_COVERAGE_TOLERANCE_S ? "fits" : "short";
}

function stemDurationSeconds(frames: number, sampleRate: number): number {
  if (!Number.isFinite(frames) || !Number.isFinite(sampleRate) || sampleRate <= 0) return Number.NaN;
  return frames / sampleRate;
}

export { judgeStemCoverage, stemDurationSeconds, STEM_COVERAGE_TOLERANCE_S };
export type { StemFit };
