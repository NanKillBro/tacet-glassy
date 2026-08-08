import { describe, expect, it } from "vitest";
import { RECONFIRM_DURATION_TOLERANCE_S, decideEngagement, reconfirmAfterEmptied } from "@/pageworld/engagement";
import type { EngagementInput, ReconfirmInput } from "@/pageworld/engagement";

function input(overrides: Partial<EngagementInput> = {}): EngagementInput {
  return {
    hasStems: true,
    graph: "none",
    boundElementConnected: false,
    target: "same",
    acquiring: false,
    stemsEngaged: true,
    stemsAreStale: false,
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

    // Measured: for about a second after a skip the player is on the next track
    // while the previous track's stems are still engaged, and syncToElement
    // restarts them at the new track's position, so the song before plays over
    // this one with the original at gain zero.
    it("releases stems the moment the player names a different track", () => {
      expect(
        decideEngagement(input({ graph: "bound", boundElementConnected: true, target: "none", stemsAreStale: true }))
      ).toBe("release");
    });

    it("releases even while the stems it holds are the engaged ones", () => {
      expect(
        decideEngagement(
          input({ graph: "bound", boundElementConnected: true, stemsEngaged: true, stemsAreStale: true })
        )
      ).toBe("release");
    });

    // A disconnected element can never be recovered, so that outranks it.
    it("still rebinds off a removed element rather than releasing", () => {
      expect(decideEngagement(input({ graph: "bound", boundElementConnected: false, stemsAreStale: true }))).toBe(
        "rebind"
      );
    });

    // Nothing to release when no graph exists, and the element is unknown.
    it("does not release when no graph is bound", () => {
      expect(decideEngagement(input({ graph: "none", target: "none", stemsAreStale: true }))).toBe("hold");
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

describe("reconfirmAfterEmptied", () => {
  const input = (overrides: Partial<ReconfirmInput> = {}): ReconfirmInput => ({
    playerVideoId: "DJCB1ZlseJ8",
    stemsVideoId: "DJCB1ZlseJ8",
    elementDurationSeconds: 215.1,
    stemDurationSeconds: 215.1,
    ...overrides,
  });

  it("confirms the same track reloaded at the same length", () => {
    expect(reconfirmAfterEmptied(input())).toBe("confirmed");
  });

  it("refuses a track the player has moved off", () => {
    expect(reconfirmAfterEmptied(input({ playerVideoId: "lYBUbBu4W08" }))).toBe("unconfirmed");
  });

  describe("regressions", () => {
    // Measured: one emptied on the playing track left lastAction at "release"
    // for as long as it was watched, with the stems loaded and the player
    // naming their own track, because nothing could ever clear the doubt.
    it("regression: lets the current track's stems come back", () => {
      expect(reconfirmAfterEmptied(input())).toBe("confirmed");
    });

    // A preroll keeps the page's videoId, so only the length separates them.
    it("regression: refuses an ad running under the track's own id", () => {
      for (const adSeconds of [6, 20, 90, 133]) {
        expect(reconfirmAfterEmptied(input({ elementDurationSeconds: adSeconds }))).toBe("unconfirmed");
      }
    });

    // For the first moments of a change the player still names the old track
    // while the element has already loaded the next one.
    it("regression: refuses the next track while the player still names the last", () => {
      expect(reconfirmAfterEmptied(input({ elementDurationSeconds: 213 }))).toBe("unconfirmed");
    });
  });

  describe("edge cases", () => {
    it("refuses a player that names nothing yet", () => {
      expect(reconfirmAfterEmptied(input({ playerVideoId: null }))).toBe("unconfirmed");
    });

    it("refuses an element that has not loaded metadata", () => {
      expect(reconfirmAfterEmptied(input({ elementDurationSeconds: Number.NaN }))).toBe("unconfirmed");
      expect(reconfirmAfterEmptied(input({ elementDurationSeconds: 0 }))).toBe("unconfirmed");
      expect(reconfirmAfterEmptied(input({ elementDurationSeconds: Number.POSITIVE_INFINITY }))).toBe("unconfirmed");
    });

    it("allows the drift a re-decode introduces, either way", () => {
      const edge = RECONFIRM_DURATION_TOLERANCE_S;
      expect(reconfirmAfterEmptied(input({ elementDurationSeconds: 215.1 + edge }))).toBe("confirmed");
      expect(reconfirmAfterEmptied(input({ elementDurationSeconds: 215.1 - edge }))).toBe("confirmed");
      expect(reconfirmAfterEmptied(input({ elementDurationSeconds: 215.1 + edge + 0.01 }))).toBe("unconfirmed");
    });
  });

  describe("invariants", () => {
    it("never confirms a track the player is not on, whatever the length", () => {
      for (const duration of [0, 1, 215.1, 1000]) {
        expect(reconfirmAfterEmptied(input({ playerVideoId: "other", elementDurationSeconds: duration }))).toBe(
          "unconfirmed"
        );
      }
    });
  });
});
