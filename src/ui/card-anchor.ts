// -- Card anchor ---------------------------------------------------------------

const PLAYER_BAR_SELECTOR = "ytmusic-player-bar";
const DOCK_PILL_SELECTOR = ".blyrics-dock__inner";
const PLAYER_BAR_GAP_PX = 6;

interface CardAnchor {
  element: HTMLElement;
  gap: number;
}

function cardGapFor(inPlayerBar: boolean, dockGap: number): number {
  return inPlayerBar ? PLAYER_BAR_GAP_PX : dockGap;
}

function isInPlayerBar(trigger: Element): boolean {
  return trigger.closest(PLAYER_BAR_SELECTOR) !== null && trigger.closest(DOCK_PILL_SELECTOR) === null;
}

function resolveCardAnchor(trigger: HTMLElement, fallback: HTMLElement, dockGap: number): CardAnchor {
  const inPlayerBar = isInPlayerBar(trigger);
  const bar = inPlayerBar ? trigger.closest<HTMLElement>(PLAYER_BAR_SELECTOR) : null;
  return { element: bar ?? fallback, gap: cardGapFor(inPlayerBar, dockGap) };
}

export { DOCK_PILL_SELECTOR, PLAYER_BAR_GAP_PX, PLAYER_BAR_SELECTOR, cardGapFor, isInPlayerBar, resolveCardAnchor };
export type { CardAnchor };
