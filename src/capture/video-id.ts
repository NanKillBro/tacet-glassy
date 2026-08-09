const VIDEO_ID_PARAM = "v";

function getVideoIdFromSearch(search: string): string | null {
  return new URLSearchParams(search).get(VIDEO_ID_PARAM);
}

export { VIDEO_ID_PARAM, getVideoIdFromSearch };
