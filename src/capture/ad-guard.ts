// Ad detection signals, taking elements rather than looking them up so they
// stay testable without a DOM. src/capture/ad-state.ts composes them.
//
// Measured over 517 samples on music.youtube.com, 87 during ads and 429 during
// a track: `ad-showing` on #movie_player fired 87/87 with no false positive,
// `is-advertisement` on the player bar 86/87 with no false positive, and the
// `ytp-ad-playing` class this used to read fired 0/87, as did
// getVideoData().isAd, which stayed null throughout. Both live signals are
// kept, since the bar attribute lags the class by one sample at a creative
// change.

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
//
// Whatever plays under a different id is not the track we asked for. This
// catches a preroll that swaps the id, which both DOM signals miss for the
// first sample of a creative change.

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
