import {
  CLIP_HEIGHT_PX,
  DRAG_CENTER_SNAP,
  POLE_REACHED_THRESHOLD,
  THUMB_INSET_PERCENT,
  TRACK_HEIGHT_PX,
  computeCommit,
  computePaintFrame,
  labelForValue,
  mixLevelFromValue,
  stepValue,
  valueFromPointerOffset,
} from "@/ui/fader-geometry";
import { describe, expect, it } from "vitest";

describe("geometry constants", () => {
  it("pins the concentric measurements exactly as specified", () => {
    expect(TRACK_HEIGHT_PX).toBe(146);
    expect(CLIP_HEIGHT_PX).toBe(136);
    // 9 / 136 * 100, the handle's half-height as a percentage of travel.
    expect(THUMB_INSET_PERCENT).toBeCloseTo(6.617647058823529, 9);
  });
});

describe("labelForValue", () => {
  it("happy paths", () => {
    expect(labelForValue(0)).toBe("Original");
    expect(labelForValue(0.5)).toBe("Vocals up");
    expect(labelForValue(-0.5)).toBe("Vocals down");
    expect(labelForValue(-1)).toBe("Karaoke");
  });

  describe("edge cases", () => {
    it("the extreme name only exists on the negative end, never the positive", () => {
      expect(labelForValue(1)).toBe("Vocals up");
      expect(labelForValue(0.99)).toBe("Vocals up");
    });

    it("boundary at exactly -0.97 is Karaoke, just above it is not", () => {
      expect(labelForValue(-0.97)).toBe("Karaoke");
      expect(labelForValue(-0.9699)).toBe("Vocals down");
    });

    it("boundary at exactly -REST reads as Original, not Vocals down", () => {
      expect(labelForValue(-0.05)).toBe("Original");
      expect(labelForValue(-0.0501)).toBe("Vocals down");
    });

    it("boundary at exactly REST reads as Original, not Vocals up", () => {
      expect(labelForValue(0.05)).toBe("Original");
      expect(labelForValue(0.0501)).toBe("Vocals up");
    });
  });
});

describe("computeCommit", () => {
  it("happy paths", () => {
    expect(computeCommit(0)).toMatchObject({ effectiveValue: 0, label: "Original", mixLevel: 1 });
    expect(computeCommit(1)).toMatchObject({ effectiveValue: 1, label: "Vocals up", mixLevel: 2 });
    expect(computeCommit(-1)).toMatchObject({ effectiveValue: -1, label: "Karaoke", mixLevel: 0 });
  });

  describe("edge cases", () => {
    it("rounds anything within REST of centre down to exactly 0", () => {
      expect(computeCommit(0.03).effectiveValue).toBe(0);
      expect(computeCommit(-0.03).effectiveValue).toBe(0);
      expect(computeCommit(0.05).effectiveValue).toBe(0);
    });

    it("pole reached is inclusive at exactly 0.97 in each direction, and never both at once", () => {
      expect(computeCommit(0.97).poleReached[1]).toBe(true);
      expect(computeCommit(0.9699).poleReached[1]).toBe(false);
      expect(computeCommit(-0.97).poleReached[-1]).toBe(true);
      expect(computeCommit(0.97).poleReached[-1]).toBe(false);
      expect(computeCommit(-0.97).poleReached[1]).toBe(false);
    });
  });
});

describe("mixLevelFromValue", () => {
  it("maps -1..1 onto the 0..2 contract the control emits, 1 is untouched", () => {
    expect(mixLevelFromValue(-1)).toBe(0);
    expect(mixLevelFromValue(0)).toBe(1);
    expect(mixLevelFromValue(1)).toBe(2);
    expect(mixLevelFromValue(0.5)).toBe(1.5);
  });
});

describe("valueFromPointerOffset", () => {
  const trackTop = 100;
  const trackHeight = 146;

  it("happy paths: top of the track is +1, bottom is -1, middle is 0", () => {
    expect(valueFromPointerOffset(trackTop, trackTop, trackHeight)).toBe(1);
    expect(valueFromPointerOffset(trackTop + trackHeight, trackTop, trackHeight)).toBe(-1);
    expect(valueFromPointerOffset(trackTop + trackHeight / 2, trackTop, trackHeight)).toBe(0);
  });

  describe("edge cases", () => {
    it("clamps to the travel range past either end", () => {
      expect(valueFromPointerOffset(trackTop - 500, trackTop, trackHeight)).toBe(1);
      expect(valueFromPointerOffset(trackTop + trackHeight + 500, trackTop, trackHeight)).toBe(-1);
    });

    it("snaps to exactly 0 inside the drag dead zone, distinct from REST", () => {
      const y = trackTop + trackHeight * ((1 - DRAG_CENTER_SNAP / 2) / 2);
      expect(valueFromPointerOffset(y, trackTop, trackHeight)).toBe(0);
    });

    it("does not snap just outside the dead zone", () => {
      const y = trackTop + trackHeight * ((1 - DRAG_CENTER_SNAP - 0.01) / 2);
      expect(valueFromPointerOffset(y, trackTop, trackHeight)).not.toBe(0);
    });
  });
});

describe("stepValue", () => {
  it("happy paths", () => {
    expect(stepValue(0, 1, false)).toBeCloseTo(0.05, 10);
    expect(stepValue(0, -1, false)).toBeCloseTo(-0.05, 10);
    expect(stepValue(0, 1, true)).toBeCloseTo(0.2, 10);
    expect(stepValue(0, -1, true)).toBeCloseTo(-0.2, 10);
  });

  describe("edge cases", () => {
    it("clamps at the travel limits instead of overshooting", () => {
      expect(stepValue(0.98, 1, true)).toBe(1);
      expect(stepValue(-0.98, -1, true)).toBe(-1);
      expect(stepValue(1, 1, false)).toBe(1);
      expect(stepValue(-1, -1, false)).toBe(-1);
    });
  });
});

describe("computePaintFrame", () => {
  it("happy paths", () => {
    const centre = computePaintFrame(0);
    expect(centre.thumbCenterPercent).toBeCloseTo(50, 9);
    expect(centre.shadowYPx).toBe(0);
    expect(centre.glyphKind).toBe("mic");
    expect(centre.glyphFraction).toBe(0);

    const top = computePaintFrame(1);
    expect(top.thumbCenterPercent).toBeCloseTo(THUMB_INSET_PERCENT, 9);
    expect(top.glyphKind).toBe("mic");
    expect(top.glyphFraction).toBe(1);

    const bottom = computePaintFrame(-1);
    expect(bottom.thumbCenterPercent).toBeCloseTo(100 - THUMB_INSET_PERCENT, 9);
    expect(bottom.glyphKind).toBe("note");
    expect(bottom.glyphFraction).toBe(1);
  });

  describe("edge cases", () => {
    it("clamps a springed value that has overshot past the travel range", () => {
      expect(computePaintFrame(1.09)).toEqual(computePaintFrame(1));
      expect(computePaintFrame(-1.4)).toEqual(computePaintFrame(-1));
    });

    it("the fill stays hidden until the handle has travelled roughly its own half-height from centre", () => {
      expect(computePaintFrame(0).fillHeightPercent).toBe(0);
      expect(computePaintFrame(0.1).fillHeightPercent).toBe(0);
      expect(computePaintFrame(0.2).fillHeightPercent).toBeGreaterThan(0);
    });

    it("the glyph swap happens exactly at -REST on the shown value, not at 0", () => {
      expect(computePaintFrame(-0.05).glyphKind).toBe("mic");
      expect(computePaintFrame(-0.0501).glyphKind).toBe("note");
    });
  });

  describe("regressions", () => {
    it("the fill's visible edge nearest the travel end always coincides exactly with the handle's own edge", () => {
      let checked = 0;
      for (let i = 0; i <= 400; i++) {
        const shown = -1 + (2 * i) / 400;
        const frame = computePaintFrame(shown);
        if (frame.fillHeightPercent === 0) continue;
        checked++;
        const handleTopEdge = frame.thumbCenterPercent - THUMB_INSET_PERCENT;
        const handleBottomEdge = frame.thumbCenterPercent + THUMB_INSET_PERCENT;
        const fillFarEdge = frame.shown >= 0 ? frame.fillTopPercent : frame.fillTopPercent + frame.fillHeightPercent;
        const handleEdge = frame.shown >= 0 ? handleTopEdge : handleBottomEdge;
        expect(Math.abs(fillFarEdge - handleEdge)).toBeLessThan(1e-9);
      }
      expect(checked).toBeGreaterThan(0);
    });

    it("never produces a negative fill height", () => {
      for (let i = 0; i <= 200; i++) {
        const shown = -1 + (2 * i) / 200;
        expect(computePaintFrame(shown).fillHeightPercent).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("invariants", () => {
    it("is symmetric: mirroring the input mirrors the thumb position around centre", () => {
      for (const v of [0.1, 0.3, 0.6, 0.9, 1]) {
        const positive = computePaintFrame(v);
        const negative = computePaintFrame(-v);
        expect(positive.thumbCenterPercent).toBeCloseTo(100 - negative.thumbCenterPercent, 9);
      }
    });

    it("is a pure function with no shared state between calls", () => {
      const a = computePaintFrame(0.4);
      const b = computePaintFrame(0.4);
      expect(a).toEqual(b);
    });
  });
});

describe("shared threshold constants stay distinct on purpose", () => {
  it("DRAG_CENTER_SNAP and the pole-reached threshold are not the REST constant", () => {
    expect(DRAG_CENTER_SNAP).toBe(0.07);
    expect(POLE_REACHED_THRESHOLD).toBe(0.97);
  });
});
