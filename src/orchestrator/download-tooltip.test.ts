import { describe, expect, it } from "vitest";
import { HIDDEN_PLAYER_LABEL, LISTENER_PLAYBACK_LABEL, describeDownload } from "@/orchestrator/download-tooltip";

describe("describeDownload", () => {
  it("carries the fraction through as a percentage the card can render", () => {
    expect(describeDownload(0.4699, "listener-playback")).toEqual({
      label: LISTENER_PLAYBACK_LABEL,
      percent: 0.4699,
    });
  });

  describe("edge cases", () => {
    it("keeps the exact bounds", () => {
      expect(describeDownload(0).percent).toBe(0);
      expect(describeDownload(1).percent).toBe(1);
    });

    it("clamps a fraction outside the unit interval", () => {
      expect(describeDownload(-0.2).percent).toBe(0);
      expect(describeDownload(1.4).percent).toBe(1);
    });

    // null is "no number yet", which the card shows as an unquantified step.
    // Zero would read as stalled.
    it("reports no percentage when the duration is unknown", () => {
      expect(describeDownload(Number.NaN).percent).toBeNull();
      expect(describeDownload(Number.POSITIVE_INFINITY).percent).toBeNull();
    });
  });

  describe("regressions", () => {
    // The two paths are paced by different things, and the card claiming the
    // listener's own buffering was responsible while a hidden player did the
    // work is how the mechanism came to look broken.
    it("distinguishes the hidden player from the listener's own playback", () => {
      expect(describeDownload(0.5, "hidden-player").label).toBe(HIDDEN_PLAYER_LABEL);
      expect(describeDownload(0.5, "listener-playback").label).toBe(LISTENER_PLAYBACK_LABEL);
      expect(HIDDEN_PLAYER_LABEL).not.toBe(LISTENER_PLAYBACK_LABEL);
    });

    it("defaults to the slower path rather than promising the faster one", () => {
      expect(describeDownload(0.5).label).toBe(LISTENER_PLAYBACK_LABEL);
    });
  });

  describe("invariants", () => {
    it("always names one of the two known paths", () => {
      for (const source of ["hidden-player", "listener-playback"] as const) {
        expect([HIDDEN_PLAYER_LABEL, LISTENER_PLAYBACK_LABEL]).toContain(describeDownload(0.5, source).label);
      }
    });

    // The label is a step name, never a sentence: the card is one line and its
    // motion rolls that line, so the ellipsis is the card's to add.
    it("leaves punctuation to the card", () => {
      for (const label of [HIDDEN_PLAYER_LABEL, LISTENER_PLAYBACK_LABEL]) {
        expect(label).not.toMatch(/[.…]$/);
      }
    });
  });
});
