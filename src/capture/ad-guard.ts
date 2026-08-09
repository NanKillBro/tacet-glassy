const MOVIE_PLAYER_ELEMENT_ID = "movie_player";
const PLAYER_BAR_SELECTOR = "ytmusic-player-bar";
const PLAYER_BAR_AD_ATTRIBUTE = "is-advertisement";

interface ElementWithAttributes {
  hasAttribute(name: string): boolean;
}

function playerBarShowsAd(playerBar: ElementWithAttributes | null): boolean {
  return playerBar?.hasAttribute(PLAYER_BAR_AD_ATTRIBUTE) ?? false;
}

export { MOVIE_PLAYER_ELEMENT_ID, PLAYER_BAR_SELECTOR, PLAYER_BAR_AD_ATTRIBUTE, playerBarShowsAd };
export type { ElementWithAttributes };
