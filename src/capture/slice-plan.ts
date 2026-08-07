// Splits a track into contiguous slices, one per hidden worker player.
//
// The slice count is not the speed dial it was once thought to be. A single
// player set to playbackRate 16 on the ELEMENT buffered a whole 245.9 s track
// in 18 s, which is 13.7x realtime, so one worker is plenty and the parallel
// path only adds the mid-track seeks that make workers stall. See
// slice-runner.ts for why the rate has to be set on the element and never
// through YouTube's player API.

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

// A single worker covering everything, with no duration needed up front. The
// duration the opener can see belongs to whatever is on screen right now, which
// during a preroll is the ad: planning against it produced a 20 s "track" that
// reported complete. The worker clamps this to the duration it measures for
// itself once the real track is up, so an over-long end is safe and an
// under-long one is not.
const OPEN_ENDED_SECONDS = 86_400;

function planWholeTrack(): SlicePlan[] {
  return [{ index: 0, fromSeconds: 0, toSeconds: OPEN_ENDED_SECONDS }];
}

export { planSlices, planWholeTrack, workerCountFor, DEFAULT_WORKER_COUNT, MIN_SLICE_SECONDS, OPEN_ENDED_SECONDS };
export type { SlicePlan };
