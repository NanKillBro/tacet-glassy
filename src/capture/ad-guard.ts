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

export { MOVIE_PLAYER_ELEMENT_ID, AD_PLAYING_CLASS, isAdPlayingElement };
export type { ElementWithClassList };
