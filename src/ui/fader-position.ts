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

function opensDownFor(dataPosition: string | null): boolean {
  return (dataPosition ?? "").startsWith("top");
}

function computeCardPosition(
  triggerRect: TriggerRect,
  anchorRect: AnchorRect,
  menuSize: MenuSize,
  viewport: Viewport,
  dataPosition: string | null,
  gap: number = CARD_GAP_PX
): CardPosition {
  const opensDown = opensDownFor(dataPosition);
  const centred = triggerRect.left + triggerRect.width / 2 - menuSize.width / 2;
  const maxLeft = viewport.width - menuSize.width - VIEWPORT_EDGE_PX;
  const left = Math.min(Math.max(VIEWPORT_EDGE_PX, centred), Math.max(VIEWPORT_EDGE_PX, maxLeft));

  return {
    left,
    top: opensDown ? `${anchorRect.bottom + gap}px` : "",
    bottom: opensDown ? "" : `${viewport.height - anchorRect.top + gap}px`,
    opensDown,
  };
}

export { computeCardPosition, opensDownFor };
export type { TriggerRect, AnchorRect, MenuSize, Viewport, CardPosition };
