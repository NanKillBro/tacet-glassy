import { PLAYER_BAR_SELECTOR, playerBarShowsAd } from "@/capture/ad-guard";

function isAdPlaying(doc: Document): boolean {
  return playerBarShowsAd(doc.querySelector(PLAYER_BAR_SELECTOR));
}

export { isAdPlaying };
