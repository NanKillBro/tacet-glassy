// music.youtube.com watch pages carry the track's video id as the ?v= query
// param, same as regular YouTube, even though navigation between tracks is
// an SPA transition rather than a full page load. Reading it fresh off
// location.search on every capture call is how the accumulator notices a
// track change without a separate navigation listener.

const VIDEO_ID_PARAM = "v";

function getVideoIdFromSearch(search: string): string | null {
  return new URLSearchParams(search).get(VIDEO_ID_PARAM);
}

export { VIDEO_ID_PARAM, getVideoIdFromSearch };
