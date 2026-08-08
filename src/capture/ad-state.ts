import {
  MOVIE_PLAYER_ELEMENT_ID,
  PLAYER_BAR_SELECTOR,
  isPlayingSomethingElse,
  moviePlayerShowsAd,
  playerBarShowsAd,
} from "@/capture/ad-guard";
import { getVideoIdFromSearch } from "@/capture/video-id";
import { getYtPlayer, readVideoData } from "@/capture/yt-player";

// The one answer to "is an ad playing right now". Both the capture patch and
// the hidden worker player ask this, and they used to ask it with their own
// near-identical copies, which is how a signal that had stopped firing went
// unnoticed in two places at once.

function isAdPlaying(doc: Document): boolean {
  const requested = getVideoIdFromSearch(doc.defaultView?.location.search ?? "");
  if (isPlayingSomethingElse(readVideoData(getYtPlayer(doc)), requested)) return true;
  if (moviePlayerShowsAd(doc.getElementById(MOVIE_PLAYER_ELEMENT_ID))) return true;
  return playerBarShowsAd(doc.querySelector(PLAYER_BAR_SELECTOR));
}

export { isAdPlaying };
