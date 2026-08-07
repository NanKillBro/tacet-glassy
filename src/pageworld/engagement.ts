// Decides whether loaded stems engage, hold, or come off the element they are
// bound to. A spurious teardown rebuilds the AudioContext, and rebuilding it
// every second wedges playback, so "no target" means "cannot tell right now"
// and never "wrong element": an element reads zero decoded bytes for a moment
// after being claimed, and a bound graph must survive that.

type GraphPresence = "none" | "bound";

// Relative to the element currently bound. "none" is unidentifiable, not absent.
type TargetPosition = "none" | "same" | "other";

interface EngagementInput {
  hasStems: boolean;
  graph: GraphPresence;
  boundElementConnected: boolean;
  target: TargetPosition;
  acquiring: boolean;
}

// hold covers both "correctly engaged" and "cannot act yet": the caller waits.
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
