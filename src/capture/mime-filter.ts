const AUDIO_MIME_PREFIX = "audio/";

function isAudioMimeType(mimeType: string): boolean {
  return mimeType.startsWith(AUDIO_MIME_PREFIX);
}

export { AUDIO_MIME_PREFIX, isAudioMimeType };
