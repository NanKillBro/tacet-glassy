// -- Settled duration --------------------------------------------------------

const DURATION_AGREEMENT_S = 1;

function settledTrackDuration(elementDurationSeconds: number, clockDurationSeconds: number): number | null {
  if (!Number.isFinite(elementDurationSeconds) || elementDurationSeconds <= 0) return null;
  if (!Number.isFinite(clockDurationSeconds) || clockDurationSeconds <= 0) return elementDurationSeconds;
  if (elementDurationSeconds + DURATION_AGREEMENT_S < clockDurationSeconds) return null;
  return elementDurationSeconds;
}

export { DURATION_AGREEMENT_S, settledTrackDuration };
