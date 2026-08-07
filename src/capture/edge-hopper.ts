// The capture loop's decision logic, kept pure so it can be tested without a
// media element.
//
// The player stays PAUSED throughout. Buffering runs anyway, and pausing is
// what stops the player reaching the end of the track and auto-advancing into
// the next one, which silently produced two concatenated songs when this was
// first tried with playbackRate instead. Each poll hops the scrubber to the
// contiguous buffered edge, which pulls the next window; when the edge stops
// moving, a small nudge re-triggers the fetch.

interface HopState {
  bufferedEnd: number;
  cursor: number;
  sliceEnd: number;
  trackDuration: number;
  stalls: number;
}

type HopDecision =
  | { action: "done" }
  | { action: "seek"; to: number; cursor: number }
  | { action: "nudge"; to: number }
  | { action: "wait" }
  | { action: "give-up" };

// The buffered edge lands on segment boundaries, so it overshoots or undershoots
// the requested end by a fraction of a segment. Treating "within 0.6 s" as
// complete avoids a spin waiting for an edge that will never land exactly.
const COMPLETE_EPSILON_S = 0.6;
const ADVANCE_EPSILON_S = 0.3;
const NUDGE_S = 0.1;
const NUDGE_EVERY = 4;
const MAX_STALLS = 70;

// Never seek to the very last frame: reaching the end is what triggers
// "ended" and the autoplay queue.
const END_GUARD_S = 0.1;

function decideHop(state: HopState): HopDecision {
  const { bufferedEnd, cursor, sliceEnd, trackDuration, stalls } = state;
  const ceiling = Math.max(0, trackDuration - END_GUARD_S);

  if (bufferedEnd >= sliceEnd - COMPLETE_EPSILON_S) return { action: "done" };
  if (stalls >= MAX_STALLS) return { action: "give-up" };

  if (bufferedEnd > cursor + ADVANCE_EPSILON_S) {
    return { action: "seek", to: Math.min(bufferedEnd, ceiling), cursor: bufferedEnd };
  }
  if (stalls > 0 && stalls % NUDGE_EVERY === 0) {
    return { action: "nudge", to: Math.min(cursor + NUDGE_S, ceiling) };
  }
  return { action: "wait" };
}

// The player can only begin at a segment boundary at or before the requested
// point, so a slice's real audio starts earlier than it was asked to. Callers
// need that true offset to place decoded PCM correctly; concatenating slices
// blindly misaligns them (measured: 350.6 s captured for a 240.7 s track).
function bufferedRangeStart(ranges: TimeRanges, at: number): number {
  for (let i = 0; i < ranges.length; i++) {
    if (ranges.start(i) <= at + 0.5 && ranges.end(i) >= at) return ranges.start(i);
  }
  return at;
}

function bufferedRangeEnd(ranges: TimeRanges, at: number): number {
  for (let i = 0; i < ranges.length; i++) {
    if (ranges.start(i) <= at + 0.5 && ranges.end(i) >= at) return ranges.end(i);
  }
  return at;
}

export { decideHop, bufferedRangeStart, bufferedRangeEnd, COMPLETE_EPSILON_S, MAX_STALLS };
export type { HopDecision, HopState };
