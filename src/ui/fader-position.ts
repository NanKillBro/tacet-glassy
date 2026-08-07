// Pure placement math for the fader card, split out of fader-geometry.ts
// (which stays as it is, see CLAUDE.md) because this is about where the
// card sits relative to the viewport, not how the track's own value
// behaves.
//
// Mirrors positionSourceMenu in better-lyrics' src/modules/ui/lyricsDock/
// controls.ts, with one deliberate deviation: centred on the trigger
// instead of left-aligned. That function positions a wide dropdown under a
// text label; a 68px card under a 28px button reads visibly off-centre
// under the same rule. The 8px viewport clamp and the data-position-driven
// flip are otherwise verbatim.

import { CARD_GAP_PX, VIEWPORT_EDGE_PX } from "@/ui/fader-geometry";

interface TriggerRect {
  left: number;
  width: number;
}

interface AnchorRect {
  top: number;
  bottom: number;
}

interface MenuSize {
  width: number;
  height: number;
}

interface Viewport {
  width: number;
  height: number;
}

interface CardPosition {
  left: number;
  top: string;
  bottom: string;
  opensDown: boolean;
}

// The dock flips the card above itself once it is pinned near the top of
// the page (data-position starting with "top"). The player bar has no dock
// ancestor at all, so its data-position is always null, which reads as
// opens-up here without a separate host flag.
function opensDownFor(dataPosition: string | null): boolean {
  return (dataPosition ?? "").startsWith("top");
}

function computeCardPosition(
  triggerRect: TriggerRect,
  anchorRect: AnchorRect,
  menuSize: MenuSize,
  viewport: Viewport,
  dataPosition: string | null
): CardPosition {
  const opensDown = opensDownFor(dataPosition);
  const centred = triggerRect.left + triggerRect.width / 2 - menuSize.width / 2;
  const maxLeft = viewport.width - menuSize.width - VIEWPORT_EDGE_PX;
  const left = Math.min(Math.max(VIEWPORT_EDGE_PX, centred), Math.max(VIEWPORT_EDGE_PX, maxLeft));

  return {
    left,
    top: opensDown ? `${anchorRect.bottom + CARD_GAP_PX}px` : "",
    bottom: opensDown ? "" : `${viewport.height - anchorRect.top + CARD_GAP_PX}px`,
    opensDown,
  };
}

export { computeCardPosition, opensDownFor };
export type { TriggerRect, AnchorRect, MenuSize, Viewport, CardPosition };
