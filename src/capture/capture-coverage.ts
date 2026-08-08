// -- Capture coverage --------------------------------------------------------

const COVERAGE_TOLERANCE_S = 3;

type CaptureVerdict = "complete" | "short" | "unusable";

interface CaptureCoverage {
  reachedSeconds: number;
  trackDurationSeconds: number;
  byteLength: number;
}

function judgeCapture(coverage: CaptureCoverage): CaptureVerdict {
  if (coverage.byteLength <= 0) return "unusable";
  if (!Number.isFinite(coverage.trackDurationSeconds) || coverage.trackDurationSeconds <= 0) return "unusable";
  if (!Number.isFinite(coverage.reachedSeconds)) return "short";
  return coverage.reachedSeconds >= coverage.trackDurationSeconds - COVERAGE_TOLERANCE_S ? "complete" : "short";
}

function missingSeconds(coverage: CaptureCoverage): number {
  if (!Number.isFinite(coverage.trackDurationSeconds) || !Number.isFinite(coverage.reachedSeconds)) return 0;
  return Math.max(0, coverage.trackDurationSeconds - coverage.reachedSeconds);
}

// -- Retrying a short capture ------------------------------------------------

const MAX_CAPTURE_ATTEMPTS = 3;

type CaptureNextStep = "retry" | "give-up";

function decideRetry(attemptsSoFar: number): CaptureNextStep {
  return attemptsSoFar < MAX_CAPTURE_ATTEMPTS ? "retry" : "give-up";
}

export { judgeCapture, missingSeconds, decideRetry, COVERAGE_TOLERANCE_S, MAX_CAPTURE_ATTEMPTS };
export type { CaptureCoverage, CaptureVerdict, CaptureNextStep };
