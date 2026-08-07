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
}

// hold covers both "correctly engaged" and "cannot act yet": the caller waits.
type EngagementAction = "idle" | "hold" | "rebind" | "engage" | "load";

function decideEngagement(input: EngagementInput): EngagementAction {
  if (!input.hasStems) return "idle";

  if (input.graph === "bound") {
    if (!input.boundElementConnected) return "rebind";
    if (input.target === "other") return "rebind";
    if (input.target === "none") return "hold";
    return input.stemsEngaged ? "hold" : "load";
  }

  if (input.target === "none" || input.acquiring) return "hold";
  return "engage";
}

export { decideEngagement };
export type { EngagementAction, EngagementInput, GraphPresence, TargetPosition };
