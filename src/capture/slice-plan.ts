// Splits a track into contiguous slices, one per hidden worker player.
//
// Measured on a 240.7 s track: one paused player edge-hopping the whole track
// runs at 0.94x realtime and one played at 16x runs at 2.7x, because YouTube
// paces segment delivery per session rather than by bandwidth. Four independent
// player sessions, each owning a quarter, reached 4.91x. The slice count is
// therefore the speed dial, bounded by how many YouTube players the machine can
// afford to run at once.

interface SlicePlan {
  index: number;
  fromSeconds: number;
  toSeconds: number;
}

const DEFAULT_WORKER_COUNT = 4;

// Below this, a slice costs more in player startup (measured ~2.6 s to first
// usable duration) than it saves in transfer, so short tracks use fewer workers.
const MIN_SLICE_SECONDS = 30;

function workerCountFor(durationSeconds: number, maxWorkers: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
  const affordable = Math.floor(durationSeconds / MIN_SLICE_SECONDS);
  return Math.max(1, Math.min(Math.max(1, Math.floor(maxWorkers)), affordable || 1));
}

function planSlices(durationSeconds: number, maxWorkers: number = DEFAULT_WORKER_COUNT): SlicePlan[] {
  const count = workerCountFor(durationSeconds, maxWorkers);
  if (count === 0) return [];

  const span = durationSeconds / count;
  return Array.from({ length: count }, (_, index) => ({
    index,
    fromSeconds: index * span,
    // The final slice takes the exact duration rather than a computed multiple,
    // so floating point drift can never leave a sliver of the track unclaimed.
    toSeconds: index === count - 1 ? durationSeconds : (index + 1) * span,
  }));
}

export { planSlices, workerCountFor, DEFAULT_WORKER_COUNT, MIN_SLICE_SECONDS };
export type { SlicePlan };
