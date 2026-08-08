// Signals chosen by measurement over 517 samples: ad-showing fired 87/87 during
// ads, is-advertisement 86/87, both with no false positive over 429 track
// samples. ytp-ad-playing and getVideoData().isAd fired 0/87.

const MOVIE_PLAYER_ELEMENT_ID = "movie_player";
const AD_SHOWING_CLASS = "ad-showing";
const PLAYER_BAR_SELECTOR = "ytmusic-player-bar";
const PLAYER_BAR_AD_ATTRIBUTE = "is-advertisement";

interface ClassListLike {
  contains(className: string): boolean;
}

interface ElementWithClassList {
  classList: ClassListLike;
}

interface ElementWithAttributes {
  hasAttribute(name: string): boolean;
}

function moviePlayerShowsAd(moviePlayer: ElementWithClassList | null): boolean {
  return moviePlayer?.classList.contains(AD_SHOWING_CLASS) ?? false;
}

function playerBarShowsAd(playerBar: ElementWithAttributes | null): boolean {
  return playerBar?.hasAttribute(PLAYER_BAR_AD_ATTRIBUTE) ?? false;
}

// -- What the player says it is playing --------------------------------------

interface PlayerVideoData {
  video_id?: unknown;
  isAd?: unknown;
}

function isPlayingSomethingElse(videoData: PlayerVideoData | null, requestedVideoId: string | null): boolean {
  if (!videoData) return false;
  if (videoData.isAd === true) return true;
  if (typeof videoData.video_id !== "string" || !requestedVideoId) return false;
  return videoData.video_id !== requestedVideoId;
}

export {
  MOVIE_PLAYER_ELEMENT_ID,
  AD_SHOWING_CLASS,
  PLAYER_BAR_SELECTOR,
  PLAYER_BAR_AD_ATTRIBUTE,
  moviePlayerShowsAd,
  playerBarShowsAd,
  isPlayingSomethingElse,
};
export type { ElementWithClassList, ElementWithAttributes, PlayerVideoData };
