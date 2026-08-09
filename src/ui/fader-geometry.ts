type GlyphKind = "mic" | "note";
type Pole = 1 | -1;

const TRACK_HEIGHT_PX = 146;
const CLIP_HEIGHT_PX = TRACK_HEIGHT_PX - 6 - 4;
const THUMB_HEIGHT_PX = 18;
const THUMB_INSET_PERCENT = (THUMB_HEIGHT_PX / 2 / CLIP_HEIGHT_PX) * 100;

const FILL_LEADING_RADIUS_PX = 9;
const FILL_TRAILING_RADIUS_PX = 6;

const SHADOW_THROW_PX = 3;

// Below this, the value reads and behaves as exactly centred.
const REST = 0.05;
const DRAG_CENTER_SNAP = 0.07;
const POLE_REACHED_THRESHOLD = 0.97;

const KEY_STEP = 0.05;
const KEY_STEP_SHIFT = 0.2;

const HOLD_MS = 450;
const VIEWPORT_EDGE_PX = 8;
const CARD_GAP_PX = 8;

const LABEL_HIDE_MS = 900;
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
