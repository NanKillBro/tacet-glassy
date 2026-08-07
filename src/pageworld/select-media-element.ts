// Picking the right <video> on music.youtube.com is a known trap: a sibling
// extension injects #bls-video, which sorts first in document order and has
// webkitAudioDecodedByteCount === 0. Selecting by decoded byte count finds
// the element that is actually playing audio; the class-based selector is
// only a fallback for the instant right after a track loads and no bytes
// have decoded yet.

const FALLBACK_ELEMENT_SELECTOR = "video.video-stream.html5-main-video";

interface MediaElementCandidate {
  webkitAudioDecodedByteCount?: number;
  matches(selector: string): boolean;
}

function selectPlaybackElement<T extends MediaElementCandidate>(candidates: T[]): T | null {
  const decoding = candidates.find(candidate => (candidate.webkitAudioDecodedByteCount ?? 0) > 0);
  if (decoding) return decoding;
  return candidates.find(candidate => candidate.matches(FALLBACK_ELEMENT_SELECTOR)) ?? null;
}

export { FALLBACK_ELEMENT_SELECTOR, selectPlaybackElement };
export type { MediaElementCandidate };
