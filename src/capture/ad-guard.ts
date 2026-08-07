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

// -- What the player says it is playing ----------------------------------------
//
// The class above is not enough on music.youtube.com. Measured live: a preroll
// ran to completion with #movie_player never carrying ytp-ad-playing, so the ad
// was captured, announced as the track, separated and cached under the track's
// own videoId. The player's own getVideoData() is unambiguous: it reports the
// ad's identity while the ad is on screen, and the requested track's afterwards.
//
// The videoId comparison is the load-bearing half, and it is worth having on
// its own terms: whatever is playing under a different id is not the track that
// was asked for, ad or otherwise.

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
