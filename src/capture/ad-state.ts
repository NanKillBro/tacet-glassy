import {
  MOVIE_PLAYER_ELEMENT_ID,
  PLAYER_BAR_SELECTOR,
  isPlayingSomethingElse,
  moviePlayerShowsAd,
  playerBarShowsAd,
} from "@/capture/ad-guard";
import { getVideoIdFromSearch } from "@/capture/video-id";
import { getYtPlayer, readVideoData } from "@/capture/yt-player";

function isAdPlaying(doc: Document): boolean {
  const requested = getVideoIdFromSearch(doc.defaultView?.location.search ?? "");
  if (isPlayingSomethingElse(readVideoData(getYtPlayer(doc)), requested)) return true;
  if (moviePlayerShowsAd(doc.getElementById(MOVIE_PLAYER_ELEMENT_ID))) return true;
  return playerBarShowsAd(doc.querySelector(PLAYER_BAR_SELECTOR));
}

export { isAdPlaying };
