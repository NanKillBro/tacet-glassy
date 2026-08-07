// Decides whether loaded stems should be engaged, held as they are, or torn
// off the element they are bound to. Pure, because getting it wrong is not a
// cosmetic bug: a spurious teardown rebuilds the AudioContext, and rebuilding
// it every second wedged YouTube Music's playback two seconds into the track.
//
// The subtle case is "no target". An element reports zero decoded bytes for a
// moment after it is claimed, so the element the stems belong to is regularly
// unidentifiable for one tick. That means "cannot tell right now", never
// "wrong element", and a graph that is already bound must survive it.

type GraphPresence = "none" | "bound";

// Where the element these stems belong to is, relative to the one currently
// bound. "none" is the unidentifiable case above, not an assertion that no
// element exists.
type TargetPosition = "none" | "same" | "other";

interface EngagementInput {
  hasStems: boolean;
  graph: GraphPresence;
  boundElementConnected: boolean;
  target: TargetPosition;
  acquiring: boolean;
}

// hold covers both "correctly engaged, leave it" and "not engaged, cannot act
// yet", since the caller does nothing in either case.
type EngagementAction = "idle" | "hold" | "rebind" | "engage";

function decideEngagement(input: EngagementInput): EngagementAction {
  if (!input.hasStems) return "idle";

  if (input.graph === "bound") {
    if (!input.boundElementConnected) return "rebind";
    return input.target === "other" ? "rebind" : "hold";
  }

  if (input.target === "none" || input.acquiring) return "hold";
  return "engage";
}

export { decideEngagement };
export type { EngagementAction, EngagementInput, GraphPresence, TargetPosition };
