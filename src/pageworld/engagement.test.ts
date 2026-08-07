import { describe, expect, it } from "vitest";
import { decideEngagement } from "@/pageworld/engagement";
import type { EngagementInput } from "@/pageworld/engagement";

function input(overrides: Partial<EngagementInput> = {}): EngagementInput {
  return {
    hasStems: true,
    graph: "none",
    boundElementConnected: false,
    target: "same",
    acquiring: false,
    stemsEngaged: true,
    ...overrides,
  };
}

describe("decideEngagement", () => {
  it("does nothing without stems", () => {
    expect(decideEngagement(input({ hasStems: false, target: "other" }))).toBe("idle");
  });

  it("engages once the stems' element can be identified", () => {
    expect(decideEngagement(input({ graph: "none", target: "same" }))).toBe("engage");
  });

  it("holds while a build is already in flight", () => {
    expect(decideEngagement(input({ graph: "none", acquiring: true }))).toBe("hold");
  });

  it("holds an engaged graph whose element is still the right one", () => {
    expect(decideEngagement(input({ graph: "bound", boundElementConnected: true, target: "same" }))).toBe("hold");
  });

  it("rebinds when another element turns out to be the stems' element", () => {
    expect(decideEngagement(input({ graph: "bound", boundElementConnected: true, target: "other" }))).toBe("rebind");
  });

  it("rebinds when the element it was bound to has been removed", () => {
    expect(decideEngagement(input({ graph: "bound", boundElementConnected: false, target: "same" }))).toBe("rebind");
  });

  describe("regressions", () => {
    // An element reports zero decoded bytes for a moment after being claimed,
    // so the target is regularly unidentifiable for one tick. Treating that as
    // a mismatch tore the graph down, rebuilt it, produced another such moment,
    // and looped: measured as a rebuild every second with YouTube Music's
    // playback frozen 2.11 seconds into the track.
    it("holds an engaged graph while the target cannot be identified", () => {
      expect(decideEngagement(input({ graph: "bound", boundElementConnected: true, target: "none" }))).toBe("hold");
    });

    it("does not engage against an element that cannot be identified yet", () => {
      expect(decideEngagement(input({ graph: "none", target: "none" }))).toBe("hold");
    });

    // A track change keeps the element and the graph and swaps only the stems.
    // Treating a bound graph as finished meant the first track of a session was
    // the only one that ever engaged, and pausing was the only way out of it.
    it("loads new stems into the graph already bound to their element", () => {
      expect(
        decideEngagement(input({ graph: "bound", boundElementConnected: true, target: "same", stemsEngaged: false }))
      ).toBe("load");
    });

    it("waits rather than loading stems it cannot confirm the element for", () => {
      expect(
        decideEngagement(input({ graph: "bound", boundElementConnected: true, target: "none", stemsEngaged: false }))
      ).toBe("hold");
    });
  });

  describe("invariants", () => {
    it("never engages while a graph is already bound", () => {
      for (const connected of [true, false]) {
        for (const target of ["none", "same", "other"] as const) {
          expect(decideEngagement(input({ graph: "bound", boundElementConnected: connected, target }))).not.toBe(
            "engage"
          );
        }
      }
    });

    it("never acts at all without stems", () => {
      for (const graph of ["none", "bound"] as const) {
        for (const target of ["none", "same", "other"] as const) {
          expect(decideEngagement(input({ hasStems: false, graph, target, boundElementConnected: true }))).toBe("idle");
        }
      }
    });

    // A disconnected element can never be recovered, so the decision cannot
    // depend on where the target is.
    it("always rebinds off an element that has been removed", () => {
      for (const target of ["none", "same", "other"] as const) {
        expect(decideEngagement(input({ graph: "bound", boundElementConnected: false, target }))).toBe("rebind");
      }
    });
  });
});
