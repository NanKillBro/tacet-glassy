// -- Restart decision -----------------------------------------------------------

const RESTART_DRIFT_TOLERANCE_S = 0.12;

interface StemRestartInput {
  hasActiveSources: boolean;
  stemPositionSeconds: number;
  playerPositionSeconds: number;
  toleranceSeconds?: number;
}

function shouldRestartStems(input: StemRestartInput): boolean {
  const tolerance = input.toleranceSeconds ?? RESTART_DRIFT_TOLERANCE_S;
  if (!input.hasActiveSources) return true;
  if (!Number.isFinite(input.stemPositionSeconds) || !Number.isFinite(input.playerPositionSeconds)) return true;
  return Math.abs(input.playerPositionSeconds - input.stemPositionSeconds) > tolerance;
}

export { RESTART_DRIFT_TOLERANCE_S, shouldRestartStems };
export type { StemRestartInput };
