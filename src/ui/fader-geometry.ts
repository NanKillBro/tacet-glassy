// Pure geometry and value math ported from the singAlong()/createSingAlong()
// functions in docs/mocks/2026-08-07-singalong-fader-v3.html and
// 2026-08-07-singalong-mounts.html (better-lyrics repo). No DOM: fader.ts
// applies these numbers to actual style properties.
//
// Two value domains, kept separate throughout: `v` is the logical value the
// user has set (drag, keys, poles), used for the commit/label/mix-level
// side. `shown` is the springed, clamped, currently-animating position used
// for the per-frame paint (thumb, fill, glyph fraction).

type GlyphKind = "mic" | "note";
type Pole = 1 | -1;

// Track 146, minus 3px of track padding and 2px of well padding at each end,
// leaves 136 of travel. The handle is 18px tall, so its centre stops 9px
// from either end of that, which is 9/136 as a percentage.
const TRACK_HEIGHT_PX = 146;
const CLIP_HEIGHT_PX = TRACK_HEIGHT_PX - 6 - 4;
const THUMB_HEIGHT_PX = 18;
const THUMB_INSET_PERCENT = (THUMB_HEIGHT_PX / 2 / CLIP_HEIGHT_PX) * 100;

const FILL_LEADING_RADIUS_PX = 9;
const FILL_TRAILING_RADIUS_PX = 6;

const SHADOW_THROW_PX = 3;

// Below this, the value reads and behaves as exactly centred.
const REST = 0.05;
// A drag release close to centre snaps to it. Distinct from REST: this is
// the pointer's own dead zone, not the commit-time rounding.
const DRAG_CENTER_SNAP = 0.07;
const POLE_REACHED_THRESHOLD = 0.97;

const KEY_STEP = 0.05;
const KEY_STEP_SHIFT = 0.2;

const HOLD_MS = 450;
const VIEWPORT_EDGE_PX = 8;
const CARD_GAP_PX = 8;

const LABEL_HIDE_MS = 900;
// transitionend does not fire in a hidden tab, so the outgoing word is also
// removed on a plain timeout as a fallback.
const LABEL_EXIT_FALLBACK_MS = 400;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// -- Commit side: the logical value the user has set -------------------------

interface CommitFrame {
  effectiveValue: number;
  label: string;
  mixLevel: number;
  poleReached: Record<Pole, boolean>;
}

function computeCommit(v: number): CommitFrame {
  const effectiveValue = Math.abs(v) <= REST ? 0 : v;
  return {
    effectiveValue,
    label: labelForValue(effectiveValue),
    mixLevel: mixLevelFromValue(effectiveValue),
    poleReached: {
      1: effectiveValue >= POLE_REACHED_THRESHOLD,
      [-1]: effectiveValue <= -POLE_REACHED_THRESHOLD,
    },
  };
}

// One subject throughout, so the words say what the control actually does.
function labelForValue(v: number): string {
  if (v <= -POLE_REACHED_THRESHOLD) return "Karaoke";
  if (v < -REST) return "Vocals down";
  if (v > REST) return "Vocals up";
  return "Original";
}

// k: 0 to 2, where 1 is the original mix untouched, 0 is full vocal
// removal, 2 is vocals boosted. Never wired to audio here, just the shape
// of the value the control emits.
function mixLevelFromValue(v: number): number {
  return v + 1;
}

function valueFromPointerOffset(clientY: number, trackTop: number, trackHeight: number): number {
  const raw = 1 - 2 * ((clientY - trackTop) / trackHeight);
  const clamped = clamp(raw, -1, 1);
  return Math.abs(clamped) <= DRAG_CENTER_SNAP ? 0 : clamped;
}

function stepValue(v: number, direction: 1 | -1, big: boolean): number {
  const step = big ? KEY_STEP_SHIFT : KEY_STEP;
  return clamp(v + direction * step, -1, 1);
}

// -- Paint side: the springed, visible position -------------------------------

interface PaintFrame {
  shown: number;
  thumbCenterPercent: number;
  fillTopPercent: number;
  fillHeightPercent: number;
  fillBorderRadius: string;
  shadowYPx: number;
  glyphKind: GlyphKind;
  glyphFraction: number;
}

function computePaintFrame(x: number): PaintFrame {
  const shown = clamp(x, -1, 1);
  const centre = 50 - shown * (50 - THUMB_INSET_PERCENT);
  const up = shown >= 0;

  // The fill runs to the handle's OUTER edge, so it reads as one continuous
  // bar with the handle riding on it, and both ends derive from the
  // handle's own position, never from a second multiplier.
  const outer = centre + (up ? -THUMB_INSET_PERCENT : THUMB_INSET_PERCENT);
  const span = Math.abs(50 - outer);
  const covered = (span * CLIP_HEIGHT_PX) / 100 < THUMB_HEIGHT_PX;

  const fillBorderRadius = up
    ? `${FILL_LEADING_RADIUS_PX}px ${FILL_LEADING_RADIUS_PX}px ${FILL_TRAILING_RADIUS_PX}px ${FILL_TRAILING_RADIUS_PX}px`
    : `${FILL_TRAILING_RADIUS_PX}px ${FILL_TRAILING_RADIUS_PX}px ${FILL_LEADING_RADIUS_PX}px ${FILL_LEADING_RADIUS_PX}px`;

  return {
    shown,
    thumbCenterPercent: centre,
    fillTopPercent: up ? outer : 50,
    fillHeightPercent: covered ? 0 : span,
    fillBorderRadius,
    shadowYPx: shown * SHADOW_THROW_PX,
    glyphKind: shown < -REST ? "note" : "mic",
    glyphFraction: Math.round(Math.abs(shown) * 20) / 20,
  };
}

export {
  TRACK_HEIGHT_PX,
  CLIP_HEIGHT_PX,
  THUMB_HEIGHT_PX,
  THUMB_INSET_PERCENT,
  FILL_LEADING_RADIUS_PX,
  FILL_TRAILING_RADIUS_PX,
  SHADOW_THROW_PX,
  REST,
  DRAG_CENTER_SNAP,
  POLE_REACHED_THRESHOLD,
  KEY_STEP,
  KEY_STEP_SHIFT,
  HOLD_MS,
  VIEWPORT_EDGE_PX,
  CARD_GAP_PX,
  LABEL_HIDE_MS,
  LABEL_EXIT_FALLBACK_MS,
  computeCommit,
  labelForValue,
  mixLevelFromValue,
  valueFromPointerOffset,
  stepValue,
  computePaintFrame,
};
export type { GlyphKind, Pole, CommitFrame, PaintFrame };
