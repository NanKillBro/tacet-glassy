// Drives the fader button's disabled/tooltip state (src/contents/fader-control.ts)
// through capture, cache lookup or separation, and playback engagement for
// exactly one track at a time. Every event but track-changed is scoped to
// the videoId it names: a stale event for a track the user has since left
// is dropped rather than corrupting the state of the track now playing,
// which is how a cancelled separation cannot race a fresh one into the
// wrong track's progress bar.
//
// "failed" is terminal for its track. There is no retry affordance from
// this state (see src/contents/fader-control.ts for why: the fader control
// itself is off limits, and disabling the button with an honest tooltip is
// the safety requirement), so only a track change recovers.

type KaraokeStatus = "waiting-for-capture" | "ready-to-engage" | "processing" | "engaged" | "failed";

interface KaraokeState {
  status: KaraokeStatus;
  videoId: string;
  stage: string | null;
  processed: number;
  total: number;
  reason: string | null;
}

type KaraokeEvent =
  | { type: "track-changed"; videoId: string }
  | { type: "capture-ready"; videoId: string }
  | { type: "engage"; videoId: string }
  | { type: "stage"; videoId: string; stage: string }
  | { type: "progress"; videoId: string; processed: number; total: number }
  | { type: "stems-loaded"; videoId: string }
  | { type: "failed"; videoId: string; reason: string };

function initialKaraokeState(videoId: string): KaraokeState {
  return { status: "waiting-for-capture", videoId, stage: null, processed: 0, total: 0, reason: null };
}

function reduceKaraokeState(state: KaraokeState, event: KaraokeEvent): KaraokeState {
  if (event.type === "track-changed") {
    return event.videoId === state.videoId ? state : initialKaraokeState(event.videoId);
  }

  if (event.videoId !== state.videoId) return state;

  switch (event.type) {
    case "capture-ready":
      return state.status === "waiting-for-capture" ? { ...state, status: "ready-to-engage" } : state;

    case "engage":
      return state.status === "ready-to-engage" ? { ...state, status: "processing" } : state;

    case "stage":
      return state.status === "processing" ? { ...state, stage: event.stage } : state;

    case "progress":
      return state.status === "processing" ? { ...state, processed: event.processed, total: event.total } : state;

    case "stems-loaded":
      return state.status === "processing" ? { ...state, status: "engaged", reason: null } : state;

    case "failed":
      return { ...state, status: "failed", reason: event.reason };

    default:
      return state;
  }
}

export { initialKaraokeState, reduceKaraokeState };
export type { KaraokeState, KaraokeStatus, KaraokeEvent };
