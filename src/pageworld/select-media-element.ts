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
