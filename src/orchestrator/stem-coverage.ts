// -- Stem coverage -----------------------------------------------------------

const STEM_COVERAGE_TOLERANCE_S = 3;
const MINIMUM_USABLE_COVERAGE = 0.9;

type StemFit = "fits" | "short" | "unusable" | "unknown";

function judgeStemCoverage(stemDurationSeconds: number, trackDurationSeconds: number): StemFit {
  if (!Number.isFinite(trackDurationSeconds) || trackDurationSeconds <= 0) return "unknown";
  if (!Number.isFinite(stemDurationSeconds) || stemDurationSeconds <= 0) return "unusable";
  if (stemDurationSeconds >= trackDurationSeconds - STEM_COVERAGE_TOLERANCE_S) return "fits";
  return stemDurationSeconds / trackDurationSeconds >= MINIMUM_USABLE_COVERAGE ? "short" : "unusable";
}

const OVERRUN_RATIO = 1.25;
const OVERRUN_TOLERANCE_S = 20;

function overrunsTrack(stemDurationSeconds: number, trackDurationSeconds: number): boolean {
  if (!Number.isFinite(stemDurationSeconds) || !Number.isFinite(trackDurationSeconds)) return false;
  if (trackDurationSeconds <= 0) return false;
  if (stemDurationSeconds <= trackDurationSeconds + OVERRUN_TOLERANCE_S) return false;
  return stemDurationSeconds / trackDurationSeconds > OVERRUN_RATIO;
}

// -- What to do about stems that do not cover the track ----------------------

type ShortStemStep = "engage" | "reacquire" | "fail";

function decideShortStems(fit: StemFit, alreadyReacquired: boolean): ShortStemStep {
  if (fit === "fits" || fit === "unknown") return "engage";
  if (!alreadyReacquired) return "reacquire";
  return fit === "short" ? "engage" : "fail";
}

function stemDurationSeconds(frames: number, sampleRate: number): number {
  if (!Number.isFinite(frames) || !Number.isFinite(sampleRate) || sampleRate <= 0) return Number.NaN;
  return frames / sampleRate;
}

export {
  judgeStemCoverage,
  decideShortStems,
  overrunsTrack,
  stemDurationSeconds,
  STEM_COVERAGE_TOLERANCE_S,
  MINIMUM_USABLE_COVERAGE,
  OVERRUN_RATIO,
  OVERRUN_TOLERANCE_S,
};
export type { StemFit, ShortStemStep };
