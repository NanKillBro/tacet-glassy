// Filters SourceBuffer MIME types down to audio, the only track this spike
// cares about. A plain YouTube Music song is audio-only, but an official
// music video adds a video/* SourceBuffer alongside it; this predicate is
// how the patch keeps one and ignores the other.

const AUDIO_MIME_PREFIX = "audio/";

function isAudioMimeType(mimeType: string): boolean {
  return mimeType.startsWith(AUDIO_MIME_PREFIX);
}

export { AUDIO_MIME_PREFIX, isAudioMimeType };
