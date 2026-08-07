// Ad detection, mirroring the reference capture extension: while
// #movie_player carries ytp-ad-playing, appendBuffer calls are feeding an ad
// creative, not the track, so the patch must skip them. Takes the element
// rather than looking it up itself so this stays testable without a DOM.

const MOVIE_PLAYER_ELEMENT_ID = "movie_player";
const AD_PLAYING_CLASS = "ytp-ad-playing";

interface ClassListLike {
  contains(className: string): boolean;
}

interface ElementWithClassList {
  classList: ClassListLike;
}

function isAdPlayingElement(moviePlayer: ElementWithClassList | null): boolean {
  return moviePlayer?.classList.contains(AD_PLAYING_CLASS) ?? false;
}

// -- What the player says it is playing --------------------------------------
//
// The class alone is not enough: a preroll ran to completion with
// #movie_player never carrying ytp-ad-playing, and the ad was cached as the
// track. Whatever plays under a different id is not the track we asked for.

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

export { MOVIE_PLAYER_ELEMENT_ID, AD_PLAYING_CLASS, isAdPlayingElement, isPlayingSomethingElse };
export type { ElementWithClassList, PlayerVideoData };
