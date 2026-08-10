import { PLAYER_BAR_GAP_PX, cardGapFor } from "@/ui/card-anchor";
import { describe, expect, it } from "vitest";

const DOCK_CARD_GAP = 8;
const DOCK_TOOLTIP_GAP = 14;

describe("cardGapFor", () => {
  it("keeps the dock's own gap when the control is not in the player bar", () => {
    expect(cardGapFor(false, DOCK_CARD_GAP)).toBe(DOCK_CARD_GAP);
    expect(cardGapFor(false, DOCK_TOOLTIP_GAP)).toBe(DOCK_TOOLTIP_GAP);
  });

  it("uses the player bar gap in the player bar, whatever the dock would have used", () => {
    expect(cardGapFor(true, DOCK_CARD_GAP)).toBe(PLAYER_BAR_GAP_PX);
    expect(cardGapFor(true, DOCK_TOOLTIP_GAP)).toBe(PLAYER_BAR_GAP_PX);
  });

  describe("invariants", () => {
    it("clears the player bar's top edge without floating away from it", () => {
      expect(PLAYER_BAR_GAP_PX).toBeGreaterThanOrEqual(4);
      expect(PLAYER_BAR_GAP_PX).toBeLessThanOrEqual(8);
    });

    it("never returns a negative gap", () => {
      for (const dockGap of [0, 8, 14, 40]) {
        expect(cardGapFor(true, dockGap)).toBeGreaterThan(0);
        expect(cardGapFor(false, dockGap)).toBeGreaterThanOrEqual(0);
      }
    });

    it("is decided by the host alone, not by the dock gap", () => {
      const gaps = [0, 8, 14, 40].map(dockGap => cardGapFor(true, dockGap));
      expect(new Set(gaps).size).toBe(1);
    });
  });
});
