// Decides whether loaded stems engage, hold, or come off the element they are
// bound to. A spurious teardown rebuilds the AudioContext, and rebuilding it
// every second wedges playback, so "no target" means "cannot tell right now"
// and never "wrong element": the player reports no track at all while it is
// loading one or running an ad, and a bound graph must survive that.

type GraphPresence = "none" | "bound";

// Relative to the element currently bound. "none" is unidentifiable, not absent.
type TargetPosition = "none" | "same" | "other";

interface EngagementInput {
  hasStems: boolean;
  graph: GraphPresence;
  boundElementConnected: boolean;
  target: TargetPosition;
  acquiring: boolean;
  // Whether the graph already holds the stems in hand. A track change keeps the
  // element and the graph and replaces only these.
  stemsEngaged: boolean;
  // Positive evidence that the loaded stems are no longer this track's: the
  // player named a different one, or the element they were bound to was emptied
  // and reloaded. Unlike target "none", which only means the answer is
  // unavailable this tick, either of these is a fact.
  stemsAreStale: boolean;
}

// hold covers both "correctly engaged" and "cannot act yet": the caller waits.
// release hands the audio back but keeps the graph, because the element can
// only ever be claimed once and tearing it down would forfeit that claim.
type EngagementAction = "idle" | "hold" | "rebind" | "engage" | "load" | "release";

function decideEngagement(input: EngagementInput): EngagementAction {
  if (!input.hasStems) return "idle";

  if (input.graph === "bound") {
    if (!input.boundElementConnected) return "rebind";
    // Ahead of every other test: stems for a track the player has left have to
    // stop being audible whether or not anything has arrived to replace them.
    // Measured: the player reports no track at all for the first ~500ms of a
    // change, so waiting for it to name the next one leaves the previous song
    // audible over the start of this one.
    if (input.stemsAreStale) return "release";
    if (input.target === "other") return "rebind";
    if (input.target === "none") return "hold";
    return input.stemsEngaged ? "hold" : "load";
  }

  if (input.target === "none" || input.acquiring) return "hold";
  return "engage";
}

// -- Recovering from an emptied element --------------------------------------
//
// "emptied" says the media went away, never whether the track did, so it puts
// the stems in doubt rather than condemning them. The duration test is what the
// videoId cannot do alone: a preroll keeps the page's videoId, and a track
// change briefly reports the old id against the new element.

const RECONFIRM_DURATION_TOLERANCE_S = 2;

type Reconfirmation = "confirmed" | "unconfirmed";

interface ReconfirmInput {
  playerVideoId: string | null;
  stemsVideoId: string;
  elementDurationSeconds: number;
  stemDurationSeconds: number;
}

function reconfirmAfterEmptied(input: ReconfirmInput): Reconfirmation {
  if (input.playerVideoId === null || input.playerVideoId !== input.stemsVideoId) return "unconfirmed";
  if (!Number.isFinite(input.elementDurationSeconds) || input.elementDurationSeconds <= 0) return "unconfirmed";
  const drift = Math.abs(input.elementDurationSeconds - input.stemDurationSeconds);
  return drift <= RECONFIRM_DURATION_TOLERANCE_S ? "confirmed" : "unconfirmed";
}

export { decideEngagement, reconfirmAfterEmptied, RECONFIRM_DURATION_TOLERANCE_S };
export type { EngagementAction, EngagementInput, GraphPresence, TargetPosition, Reconfirmation, ReconfirmInput };
